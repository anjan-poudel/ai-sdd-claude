/**
 * ai-sdd run — execute or resume a workflow.
 */

import type { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
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
