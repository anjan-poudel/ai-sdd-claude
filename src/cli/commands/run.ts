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
import { MockAdapter } from "../../adapters/mock-adapter.ts";
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
      //   1. .ai-sdd/workflow.yaml        (explicit single-file, backward compat)
      //   2. .ai-sdd/workflows/default-sdd.yaml  (copied by ai-sdd init)
      //   3. bundled framework default
      const workflowPath = resolve(projectPath, ".ai-sdd", "workflow.yaml");
      const initCopiedPath = resolve(projectPath, ".ai-sdd", "workflows", "default-sdd.yaml");
      const bundledDefaultPath = resolve(
        new URL("../../../data/workflows/default-sdd.yaml", import.meta.url).pathname,
      );
      const wfPath = existsSync(workflowPath)  ? workflowPath
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

      // Adapter (Phase 1: use mock unless adapter.type configured)
      const adapter = new MockAdapter();

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
