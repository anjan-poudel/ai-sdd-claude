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
import { buildProviderChain } from "../../overlays/registry.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";
import { loadProjectConfig, loadRemoteOverlayConfig } from "../config-loader.ts";

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
    .option("--project <path>", "Project directory", process.cwd())
    .action(async (options) => {
      const projectPath = resolve(options.project as string);

      if (!existsSync(projectPath)) {
        console.error(`Project directory not found: ${projectPath}`);
        process.exit(1);
      }

      const config = loadProjectConfig(projectPath);

      // Load workflow — search order (first match wins):
      //   0. --workflow <name>                               (CLI flag, highest priority)
      //   1. specs/<feature>/workflow.yaml                  (--feature flag)
      //   2. specs/workflow.yaml                            (greenfield — workflow lives with specs)
      //   3. .ai-sdd/workflow.yaml                          (explicit single-file, backward compat)
      //   4. .ai-sdd/workflows/<config.workflow>.yaml       (config.workflow name, if set)
      //   5. .ai-sdd/workflows/default-sdd.yaml            (copied by ai-sdd init)
      //   6. bundled framework default
      const cliWorkflowName = options.workflow as string | undefined;
      const cliWorkflowPath = cliWorkflowName
        ? resolve(projectPath, ".ai-sdd", "workflows", `${cliWorkflowName}.yaml`)
        : null;
      const featureName = options.feature as string | undefined;
      const featureWorkflowPath = featureName
        ? resolve(projectPath, "specs", featureName, "workflow.yaml")
        : null;
      const specsWorkflowPath = resolve(projectPath, "specs", "workflow.yaml");
      const workflowPath = resolve(projectPath, ".ai-sdd", "workflow.yaml");
      const configWorkflowName = config.workflow as string | undefined;
      const configWorkflowPath = configWorkflowName
        ? resolve(projectPath, ".ai-sdd", "workflows", `${configWorkflowName}.yaml`)
        : null;
      const initCopiedPath = resolve(projectPath, ".ai-sdd", "workflows", "default-sdd.yaml");
      const bundledDefaultPath = resolve(
        new URL("../../../data/workflows/default-sdd.yaml", import.meta.url).pathname,
      );

      if (cliWorkflowPath && !existsSync(cliWorkflowPath)) {
        console.error(`Workflow not found: ${cliWorkflowPath}`);
        process.exit(1);
      }

      if (featureWorkflowPath && !existsSync(featureWorkflowPath)) {
        console.error(`Feature workflow not found: ${featureWorkflowPath}`);
        process.exit(1);
      }

      const wfPath = (cliWorkflowPath && existsSync(cliWorkflowPath)) ? cliWorkflowPath
                   : (featureWorkflowPath && existsSync(featureWorkflowPath)) ? featureWorkflowPath
                   : existsSync(specsWorkflowPath) ? specsWorkflowPath
                   : existsSync(workflowPath) ? workflowPath
                   : (configWorkflowPath && existsSync(configWorkflowPath)) ? configWorkflowPath
                   : existsSync(initCopiedPath) ? initCopiedPath
                   : existsSync(bundledDefaultPath) ? bundledDefaultPath
                   : null;

      if (!wfPath) {
        console.error(
          `No workflow found. Create .ai-sdd/workflow.yaml or run: ai-sdd init`,
        );
        process.exit(1);
      }

      const workflow = WorkflowLoader.loadFile(wfPath);

      // Load agents
      const defaultsDir = resolve(
        new URL("../../../data/agents/defaults", import.meta.url).pathname,
      );
      const agentRegistry = new AgentRegistry(defaultsDir);
      agentRegistry.loadDefaults();

      const projectAgentsDir = resolve(projectPath, ".ai-sdd", "agents");
      if (existsSync(projectAgentsDir)) {
        agentRegistry.loadProjectAgents(projectAgentsDir);
      }

      // State manager
      const stateDir = resolve(projectPath, ".ai-sdd", "state");
      const stateManager = new StateManager(stateDir, workflow.config.name, projectPath);
      if (options.resume) {
        stateManager.load();
      }

      // Constitution
      const constitutionResolver = new ConstitutionResolver({
        project_path: projectPath,
        strict_parse: config.constitution?.strict_parse ?? true,
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
      const hilQueuePath = resolve(
        projectPath,
        config.overlays?.hil?.queue_path ?? ".ai-sdd/state/hil/",
      );
      const outputsDir = resolve(projectPath, ".ai-sdd", "outputs");
      const remoteConfig = loadRemoteOverlayConfig(projectPath);
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
          review: new ReviewOverlay(emitter, { enabled: false }),
          paired: new PairedOverlay(emitter, { enabled: false }),
          confidence: new ConfidenceOverlay(emitter),
        },
        ...(remoteConfig !== undefined && { remoteConfig }),
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
