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
import { buildOverlayChain } from "../../overlays/composition-rules.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";
import { loadProjectConfig } from "../config-loader.ts";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run or resume a workflow")
    .option("--resume", "Resume from last persisted state")
    .option("--task <id>", "Run specific task and its unmet dependencies")
    .option("--dry-run", "Print execution plan without making LLM calls")
    .option("--step", "Pause after each task group")
    .option("--project <path>", "Project directory", process.cwd())
    .action(async (options) => {
      const projectPath = resolve(options.project as string);

      if (!existsSync(projectPath)) {
        console.error(`Project directory not found: ${projectPath}`);
        process.exit(1);
      }

      const config = loadProjectConfig(projectPath);

      // Load workflow — search order:
      //   1. .ai-sdd/workflow.yaml                          (explicit single-file, backward compat)
      //   2. .ai-sdd/workflows/<config.workflow>.yaml       (config.workflow name, if set)
      //   3. .ai-sdd/workflows/default-sdd.yaml            (copied by ai-sdd init)
      //   4. bundled framework default
      const workflowPath = resolve(projectPath, ".ai-sdd", "workflow.yaml");
      const configWorkflowName = config.workflow as string | undefined;
      const configWorkflowPath = configWorkflowName
        ? resolve(projectPath, ".ai-sdd", "workflows", `${configWorkflowName}.yaml`)
        : null;
      const initCopiedPath = resolve(projectPath, ".ai-sdd", "workflows", "default-sdd.yaml");
      const bundledDefaultPath = resolve(
        new URL("../../../data/workflows/default-sdd.yaml", import.meta.url).pathname,
      );
      const wfPath = existsSync(workflowPath) ? workflowPath
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
      const overlayChain = buildOverlayChain({
        hil: new HilOverlay(
          {
            enabled: config.overlays?.hil?.enabled ?? true,
            poll_interval_ms: (config.overlays?.hil?.poll_interval_seconds ?? 5) * 1000,
            notify: config.overlays?.hil?.notify,
          },
          hilQueuePath,
          emitter,
        ),
        policy_gate: new PolicyGateOverlay(outputsDir, emitter),
        review: new ReviewOverlay(emitter, { enabled: false }),
        paired: new PairedOverlay(emitter, { enabled: false }),
        confidence: new ConfidenceOverlay(emitter),
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
          max_concurrent_tasks: config.engine?.max_concurrent_tasks,
          cost_budget_per_run_usd: config.engine?.cost_budget_per_run_usd,
          cost_enforcement: config.engine?.cost_enforcement,
        },
        overlayChain,
      );

      const result = await engine.run({
        dry_run: options.dryRun as boolean,
        step: options.step as boolean,
        resume: options.resume as boolean,
        target_task: options.task as string | undefined,
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
