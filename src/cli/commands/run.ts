/**
 * ai-sdd run — execute or resume a workflow.
 */

import type { Command } from "commander";
import { resolve, join } from "path";
import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { WorkflowLoader } from "../../core/workflow-loader.ts";
import { AgentRegistry } from "../../core/agent-loader.ts";
import { StateManager } from "../../core/state-manager.ts";
import { ConstitutionResolver } from "../../constitution/resolver.ts";
import { createManifestWriter } from "../../constitution/manifest-writer.ts";
import { Engine } from "../../core/engine.ts";
import { createAdapter } from "../../adapters/factory.ts";
import { HilOverlay } from "../../overlays/hil/hil-overlay.ts";
import { PolicyGateOverlay } from "../../overlays/policy-gate/gate-overlay.ts";
import { ReviewOverlay } from "../../overlays/review/review-overlay.ts";
import { PairedOverlay } from "../../overlays/paired/paired-overlay.ts";
import { ConfidenceOverlay } from "../../overlays/confidence/confidence-overlay.ts";
import { TraceabilityOverlay } from "../../overlays/traceability/traceability-overlay.ts";
import { buildProviderChain } from "../../overlays/registry.ts";
import { resolveBackendTools } from "../../overlays/mcp/mcp-client.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";
import { loadRemoteOverlayConfig } from "../config-loader.ts";
import { resolveSession, setActiveSession, ensureSessionDirs } from "../../core/session-resolver.ts";
import { DefaultCollaborationAdapterFactory } from "../../collaboration/core/adapter-factory.ts";
import { DefaultAsCodeSyncEngine } from "../../collaboration/core/sync-engine.ts";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run or resume a workflow")
    .option("--resume", "Resume from last persisted state")
    .option("--task <id>", "Run specific task and its unmet dependencies")
    .option("--dry-run", "Print execution plan without making LLM calls")
    .option("--step", "Pause after each task group")
    .option("--workflow <name>", "Workflow name (loads .ai-sdd/workflows/<name>.yaml)")
    .option("--feature <name>", "Feature name (loads specs/<name>/workflow.yaml)")
    .option(
      "--standards <paths>",
      "Comma-separated paths to coding standards files (relative to project, or 'none' to disable)",
    )
    .option("--project <path>", "Project directory", process.cwd())
    .action(async (options) => {
      const projectPath = resolve(options.project as string);

      if (!existsSync(projectPath)) {
        console.error(`Project directory not found: ${projectPath}`);
        process.exit(1);
      }

      const featureName = options.feature as string | undefined;
      const cliWorkflowName = options.workflow as string | undefined;

      // Resolve session — centralizes all path computation
      const session = resolveSession({
        projectPath,
        featureName,
        workflowName: cliWorkflowName,
      });
      const config = session.config;

      // Auto-switch active session when --feature is provided
      if (featureName && !session.isLegacy) {
        setActiveSession(projectPath, featureName);
      }

      // Ensure session directories exist
      if (!session.isLegacy) {
        ensureSessionDirs(session.sessionDir);
      }

      // ── PID lock (ISSUE-006) ─────────────────────────────────────────────
      // Prevent two engine processes from writing workflow-state.json concurrently.
      const pidFile = join(session.sessionDir, "engine.pid");
      if (existsSync(pidFile)) {
        const existingPid = parseInt(readFileSync(pidFile, "utf-8"), 10);
        // Check if the process is actually alive.
        let alive = false;
        try { process.kill(existingPid, 0); alive = true; } catch { /* not running */ }
        if (alive) {
          console.error(
            `[ai-sdd] Another engine process is already running (PID ${existingPid}).\n` +
            `  Wait for it to finish, or kill it manually:\n` +
            `    kill ${existingPid}\n` +
            `  Then remove the lock file:\n` +
            `    rm ${pidFile}`,
          );
          process.exit(1);
        }
        // Stale PID file — previous run was killed uncleanly. Remove and continue.
        console.warn(`[ai-sdd] Removing stale PID file (PID ${existingPid} is no longer running).`);
        unlinkSync(pidFile);
      }
      writeFileSync(pidFile, String(process.pid), "utf-8");
      const cleanupPid = () => { try { unlinkSync(pidFile); } catch { /* already gone */ } };
      process.on("exit", cleanupPid);
      process.on("SIGINT", () => { cleanupPid(); process.exit(130); });
      process.on("SIGTERM", () => { cleanupPid(); process.exit(143); });

      if (session.isLegacy) {
        console.warn(
          `[ai-sdd] Legacy .ai-sdd/state/ layout detected. ` +
          `Consider re-running: ai-sdd init --tool <name>`,
        );
      }

      // Validate workflow path
      const wfPath = session.workflowPath;
      if (!wfPath) {
        console.error(
          `No workflow found. Create .ai-sdd/workflow.yaml or run: ai-sdd init`,
        );
        process.exit(1);
      }

      // Validate CLI-specified paths exist (stricter than first-found-wins)
      if (cliWorkflowName) {
        const cliWorkflowPath = resolve(projectPath, ".ai-sdd", "workflows", `${cliWorkflowName}.yaml`);
        if (!existsSync(cliWorkflowPath)) {
          console.error(`Workflow not found: ${cliWorkflowPath}`);
          process.exit(1);
        }
      }
      if (featureName) {
        const featureWorkflowPath = resolve(projectPath, "specs", featureName, "workflow.yaml");
        if (!cliWorkflowName && !existsSync(featureWorkflowPath)) {
          console.error(`Feature workflow not found: ${featureWorkflowPath}`);
          process.exit(1);
        }
      }

      const workflow = WorkflowLoader.loadFile(wfPath);

      // Load agents from all resolved directories
      const agentRegistry = new AgentRegistry(
        session.agentsDirs[0] ?? resolve(
          new URL("../../../data/agents/defaults", import.meta.url).pathname,
        ),
      );
      agentRegistry.loadDefaults();
      for (const dir of session.agentsDirs.slice(1)) {
        agentRegistry.loadProjectAgents(dir);
      }

      // State manager — uses session-resolved state directory
      const stateManager = new StateManager(session.stateDir, workflow.config.name, projectPath);
      // Always load persisted state if it exists — auto-resume is the correct default.
      // StateManager.load() is idempotent: if no state file exists it stays fresh.
      // The --resume flag is kept for backward compatibility but is now a no-op.
      stateManager.load();

      // Resolve standards paths: --standards CLI flag > config.standards.paths > auto-discover
      const standardsArg = options.standards as string | undefined;
      const standardsPaths: string[] | undefined = standardsArg === "none"
        ? []                                                   // explicit disable
        : standardsArg !== undefined
          ? standardsArg.split(",").map((p) => p.trim()).filter(Boolean) // CLI paths
          : config.standards?.paths;                           // config (undefined = auto-discover)

      // Constitution
      const constitutionResolver = new ConstitutionResolver({
        project_path: projectPath,
        strict_parse: config.constitution?.strict_parse ?? true,
        ...(standardsPaths !== undefined && { standards_paths: standardsPaths }),
        standards_strict: config.standards?.strict ?? false,
      });

      // Manifest writer
      const manifestWriter = createManifestWriter(projectPath);

      // Observability
      const runId = crypto.randomUUID();
      const emitter = new ObservabilityEmitter({
        run_id: runId,
        workflow_id: workflow.config.name,
        log_level: config.observability?.log_level ?? "INFO",
      });

      // ── Progress printer ────────────────────────────────────────────────────
      // Translates emitter events into human-readable stdout lines so operators
      // can see what is happening without parsing JSON logs.
      const taskStartTimes = new Map<string, number>();
      emitter.on((event) => {
        const d = event.data as Record<string, unknown>;
        const ts = new Date(event.timestamp).toLocaleTimeString();
        switch (event.type) {
          case "workflow.started":
            console.log(`\n[${ts}] workflow: ${String(d["workflow_name"])} | ` +
              `${String(d["task_count"])} tasks | adapter: ${String(d["adapter_type"])}`);
            break;
          case "task.started":
            taskStartTimes.set(String(d["task_id"]), Date.now());
            console.log(`[${ts}] ▶ ${String(d["task_id"])} — starting (agent: ${String(d["agent"])}, iter: ${String(d["iteration"])})`);
            break;
          case "task.completed": {
            const elapsed = taskStartTimes.has(String(d["task_id"]))
              ? `${((Date.now() - taskStartTimes.get(String(d["task_id"]))!) / 1000).toFixed(1)}s`
              : String(d["duration_ms"]) + "ms";
            taskStartTimes.delete(String(d["task_id"]));
            const tokens = d["tokens_used"] as Record<string, number> | undefined;
            const tokenStr = tokens ? ` | tokens: ${tokens["total"] ?? "—"}` : "";
            console.log(`[${ts}] ✓ ${String(d["task_id"])} — completed (${elapsed}${tokenStr})`);
            break;
          }
          case "task.failed":
            taskStartTimes.delete(String(d["task_id"]));
            console.error(`[${ts}] ✗ ${String(d["task_id"])} — FAILED: ${String(d["error"] ?? "")}`);
            break;
          case "task.rework":
            console.warn(`[${ts}] ↺ ${String(d["task_id"])} — needs rework (iter ${String(d["iteration"])}): ${String(d["feedback"] ?? "").slice(0, 120)}`);
            break;
          case "task.hil_pending":
            console.log(`[${ts}] ⏸ ${String(d["task_id"])} — HIL pending (id: ${String(d["hil_id"])}) — run: ai-sdd hil list`);
            break;
          case "task.hil_resuming":
            console.log(`[${ts}] ▶ ${String(d["task_id"])} — resuming from HIL`);
            break;
          case "hil.created":
            console.log(`[${ts}]   HIL item created: ${String(d["hil_id"])} — ${String(d["reason"] ?? "")}`);
            break;
          case "context.warning":
            console.warn(`[${ts}] ⚠  ${String(d["task_id"])} — context ${String(d["percent_used"])}% full (threshold: ${String(d["threshold_pct"])}%)`);
            break;
          case "cost.warning":
            console.warn(`[${ts}] ⚠  cost $${String(d["current_cost_usd"])} approaching budget $${String(d["budget_usd"])}`);
            break;
          case "confidence.regenerating":
            console.warn(`[${ts}] ↻ ${String(d["task_id"])} — low confidence (${String(d["score"])}), regenerating (attempt ${String(d["attempt"])})`);
            break;
          case "confidence.retries_exhausted":
            console.warn(`[${ts}] ⚠  ${String(d["task_id"])} — confidence retries exhausted, escalating`);
            break;
          case "workflow.completed":
            console.log(`[${ts}] workflow done — ${String(d["tasks_completed"])} completed, ${String(d["tasks_failed"])} failed in ${String(d["duration_ms"])}ms\n`);
            break;
        }
      });

      // Adapter — instantiated from config.adapter.type
      const adapter = createAdapter({
        type: config.adapter?.type ?? "mock",
        ...config.adapter,
      });

      // Overlay chain — built from project config in locked order
      // Paths come from session resolver
      const hilQueuePath = session.hilQueuePath;
      const outputsDir = session.outputsDir;
      let remoteConfig = loadRemoteOverlayConfig(projectPath);

      // Probe remote overlay backend availability and apply env-var disables.
      // AI_SDD_DISABLE_REMOTE_OVERLAYS=true  → skip all remote overlays
      // AI_SDD_DISABLE_OVERLAY_<NAME>=true   → skip a specific overlay (NAME uppercased)
      if (remoteConfig?.remote_overlays) {
        const disableAll = process.env.AI_SDD_DISABLE_REMOTE_OVERLAYS === "true";
        const prunedOverlays: typeof remoteConfig.remote_overlays = {};
        for (const [name, cfg] of Object.entries(remoteConfig.remote_overlays)) {
          const disableEnvKey = `AI_SDD_DISABLE_OVERLAY_${name.toUpperCase().replace(/-/g, "_")}`;
          if (disableAll || process.env[disableEnvKey] === "true") {
            console.warn(`[ai-sdd] Remote overlay '${name}' disabled via environment variable.`);
            continue;
          }
          if (!cfg.enabled) {
            prunedOverlays[name] = cfg;
            continue;
          }
          // Probe backend command availability.
          // Checks all absolute/relative path args in the command array (e.g. node script.js).
          const backendName = cfg.backend;
          const backend = remoteConfig.overlay_backends?.[backendName];
          if (backend) {
            const missingPath = backend.command.find(
              (arg) => (arg.startsWith("/") || arg.startsWith(".")) && !existsSync(arg),
            );
            if (missingPath !== undefined) {
              console.warn(
                `[ai-sdd] Remote overlay '${name}' unavailable: path not found: ${missingPath}. ` +
                `Skipping. Set enabled: false in ai-sdd.yaml to suppress this warning.`,
              );
              continue;
            }
          }
          prunedOverlays[name] = cfg;
        }
        remoteConfig = { ...remoteConfig, remote_overlays: prunedOverlays };
      }

      // Auto-discover overlay tool names for backends that have no explicit tool: set.
      // Connects to each backend, calls tools/list, and matches the overlay fingerprint.
      let resolvedTools: Map<string, string> | undefined;
      if (remoteConfig) {
        resolvedTools = await resolveBackendTools(remoteConfig);
      }

      const hilNotify = config.overlays?.hil?.notify;
      const providerChain = buildProviderChain({
        localOverlays: {
          hil: new HilOverlay(
            {
              enabled: config.overlays?.hil?.enabled ?? true,
              poll_interval_ms: (config.overlays?.hil?.poll_interval_seconds ?? 5) * 1000,
              ...(hilNotify !== undefined && { notify: hilNotify }),
            },
            hilQueuePath,
            emitter,
          ),
          policy_gate: new PolicyGateOverlay(outputsDir, emitter),
          review: new ReviewOverlay(emitter, { enabled: false }, adapter, session.reviewLogsDir),
          paired: new PairedOverlay(emitter, { enabled: false }, adapter, session.pairSessionsDir),
          traceability: new TraceabilityOverlay(emitter, {}, adapter),
          confidence: new ConfidenceOverlay(emitter, {}, adapter),
        },
        ...(remoteConfig !== undefined && { remoteConfig }),
        ...(resolvedTools !== undefined && { resolvedBackendTools: resolvedTools }),
        emitter,
      });

      // Engine
      const engine = new Engine(
        workflow,
        stateManager,
        agentRegistry,
        adapter,
        constitutionResolver,
        manifestWriter,
        emitter,
        {
          ...(config.engine?.max_concurrent_tasks !== undefined && { max_concurrent_tasks: config.engine.max_concurrent_tasks }),
          ...(config.engine?.cost_budget_per_run_usd !== undefined && { cost_budget_per_run_usd: config.engine.cost_budget_per_run_usd }),
          ...(config.engine?.cost_enforcement !== undefined && { cost_enforcement: config.engine.cost_enforcement }),
          ...(config.engine?.max_context_tokens !== undefined && { max_context_tokens: config.engine.max_context_tokens }),
          ...(config.engine?.context_warning_threshold_pct !== undefined && { context_warning_threshold_pct: config.engine.context_warning_threshold_pct }),
          ...(config.engine?.context_hil_threshold_pct !== undefined && { context_hil_threshold_pct: config.engine.context_hil_threshold_pct }),
        },
        providerChain,
      );

      // ── Collaboration adapter wiring ────────────────────────────────────────
      // The collaboration section in ai-sdd.yaml declares Slack/Confluence/Jira/GitHub
      // adapters. Wire them up as post-task / on-failure engine hooks here so they
      // fire on every natural task completion (not just manual state repairs).
      const collabConfig = config.collaboration;
      console.debug("[ai-sdd:collab] collaboration config:", JSON.stringify(collabConfig ?? null));

      if (collabConfig?.enabled !== false && collabConfig?.adapters) {
        const adaptersCfg = {
          notification:  collabConfig.adapters.notification  ?? "mock",
          document:      collabConfig.adapters.document      ?? "mock",
          task_tracking: collabConfig.adapters.task_tracking ?? "mock",
          code_review:   collabConfig.adapters.code_review   ?? "mock",
        };
        console.debug("[ai-sdd:collab] building adapter factory with:", JSON.stringify(adaptersCfg));

        const collabFactory = new DefaultCollaborationAdapterFactory(adaptersCfg);

        // Validate credentials early — warn but don't abort on missing creds.
        const credResult = collabFactory.validateCredentials();
        if (!credResult.ok) {
          console.warn(
            `[ai-sdd:collab] Credential validation failed — collaboration hooks disabled.\n  ${credResult.error.message}`,
          );
        } else {
          console.debug("[ai-sdd:collab] credentials OK — registering post-task hooks");

          const notifAdapter = collabFactory.getNotificationAdapter();
          const docAdapter   = collabFactory.getDocumentAdapter();

          // Slack notification hook — post every completed task to notify_channel.
          const slackChannel = collabConfig.slack?.notify_channel;
          if (slackChannel && adaptersCfg.notification === "slack") {
            engine.hooks.onPostTask("*", async (ctx) => {
              console.debug(`[ai-sdd:collab] post_task hook fired for ${ctx.task_id} — posting Slack notification`);
              const notifResult = await notifAdapter.postNotification(slackChannel, {
                title:   `Task completed: ${ctx.task_id}`,
                task_id: ctx.task_id,
                body:    `Status: COMPLETED | Workflow: ${ctx.workflow_id}`,
              });
              if (!notifResult.ok) {
                console.warn(`[ai-sdd:collab] Slack post failed for ${ctx.task_id}: ${notifResult.error.message}`);
              } else {
                console.debug(`[ai-sdd:collab] Slack notification sent for ${ctx.task_id} (ts: ${notifResult.value.id})`);
              }
            });

            // Also notify on failure.
            engine.hooks.onFailure("*", async (ctx) => {
              console.debug(`[ai-sdd:collab] on_failure hook fired for ${ctx.task_id} — posting Slack notification`);
              const notifResult = await notifAdapter.postNotification(slackChannel, {
                title:   `Task FAILED: ${ctx.task_id}`,
                task_id: ctx.task_id,
                body:    `Error: ${ctx.error?.message ?? "unknown"} | Workflow: ${ctx.workflow_id}`,
              });
              if (!notifResult.ok) {
                console.warn(`[ai-sdd:collab] Slack failure notification failed for ${ctx.task_id}: ${notifResult.error.message}`);
              }
            });
          } else {
            console.debug(`[ai-sdd:collab] Slack hook skipped — notify_channel: ${String(slackChannel)}, adapter: ${adaptersCfg.notification}`);
          }

          // Confluence document hook — publish task output as a Confluence page.
          const confluenceSpaceKey    = collabConfig.confluence?.space_key;
          const confluenceParentTitle = collabConfig.confluence?.parent_page_title ?? "ai-sdd Artifacts";
          if (confluenceSpaceKey && adaptersCfg.document === "confluence") {
            engine.hooks.onPostTask("*", async (ctx) => {
              console.debug(`[ai-sdd:collab] post_task hook (confluence) fired for ${ctx.task_id}`);
              const title   = `[ai-sdd] ${ctx.task_id}`;
              const content = `Task: \`${ctx.task_id}\` | Workflow: ${ctx.workflow_id} | Status: COMPLETED`;
              const pubResult = await docAdapter.createPage(
                confluenceSpaceKey,
                confluenceParentTitle,
                title,
                content,
              );
              if (!pubResult.ok) {
                console.warn(`[ai-sdd:collab] Confluence publish failed for ${ctx.task_id}: ${pubResult.error.message}`);
              } else {
                console.debug(`[ai-sdd:collab] Confluence page published for ${ctx.task_id}: ${pubResult.value.url}`);
              }
            });
          } else {
            console.debug(`[ai-sdd:collab] Confluence hook skipped — space_key: ${String(confluenceSpaceKey)}, adapter: ${adaptersCfg.document}`);
          }

          // Jira/GitHub task-tracking sync hook — update issue status on completion.
          const jiraProjectKey = collabConfig.jira?.project_key;
          if (jiraProjectKey && (adaptersCfg.task_tracking === "jira" || adaptersCfg.task_tracking === "github")) {
            const syncEng        = new DefaultAsCodeSyncEngine(jiraProjectKey);
            const trackerAdapter = collabFactory.getTaskTrackingAdapter();
            // Pre-run sync: push all workflow tasks to the tracker (creates missing issues).
            console.debug("[ai-sdd:collab] running pre-run task-tracking sync");
            try {
              const syncReport = await syncEng.sync(workflow, trackerAdapter);
              console.debug(
                `[ai-sdd:collab] pre-run sync complete — created: ${syncReport.created}, updated: ${syncReport.updated}, unchanged: ${syncReport.unchanged}, errors: ${syncReport.errors.length}`,
              );
              if (syncReport.errors.length > 0) {
                for (const e of syncReport.errors) {
                  console.warn(`[ai-sdd:collab] sync error for ${e.task_id}: ${e.error.message}`);
                }
              }
            } catch (e) {
              console.warn(`[ai-sdd:collab] pre-run sync threw: ${String(e)}`);
            }

            // Post-task hook: transition the corresponding issue to Done.
            engine.hooks.onPostTask("*", async (ctx) => {
              console.debug(`[ai-sdd:collab] post_task hook (task-tracking) fired for ${ctx.task_id}`);
              const mappings = syncEng.getMappings();
              const mapping  = mappings.find(m => m.task_id === ctx.task_id);
              if (!mapping) {
                console.debug(`[ai-sdd:collab] no tracker mapping found for ${ctx.task_id} — skipping transition`);
                return;
              }
              const transResult = await trackerAdapter.transitionTask(
                { provider: trackerAdapter.provider, key: mapping.issue_key, id: mapping.issue_key, url: "" },
                "Done",
              );
              if (!transResult.ok) {
                console.warn(`[ai-sdd:collab] tracker transition failed for ${ctx.task_id} (${mapping.issue_key}): ${transResult.error.message}`);
              } else {
                console.debug(`[ai-sdd:collab] tracker issue ${mapping.issue_key} transitioned to Done`);
              }
            });
          } else {
            console.debug(`[ai-sdd:collab] task-tracking hook skipped — project_key: ${String(jiraProjectKey)}, adapter: ${adaptersCfg.task_tracking}`);
          }
        }
      } else {
        console.debug(`[ai-sdd:collab] collaboration disabled or no adapters configured (enabled: ${String(collabConfig?.enabled)}, adapters: ${JSON.stringify(collabConfig?.adapters ?? null)})`);
      }

      const targetTask = options.task as string | undefined;
      const result = await engine.run({
        dry_run: options.dryRun as boolean,
        step: options.step as boolean,
        resume: options.resume as boolean,
        ...(targetTask !== undefined && { target_task: targetTask }),
      });

      console.log(`\nWorkflow complete:`);
      console.log(`  Completed: ${result.completed.length} tasks`);
      console.log(`  Failed:    ${result.failed.length} tasks`);
      console.log(`  Skipped:   ${result.skipped.length} tasks`);
      console.log(`  Duration:  ${result.duration_ms}ms`);
      console.log(`  Cost:      $${result.total_cost_usd.toFixed(4)}`);

      if (result.failed.length > 0) {
        process.exit(1);
      }
    });
}
