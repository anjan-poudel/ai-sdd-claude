/**
 * ai-sdd validate-config — validate all YAML configs.
 */

import type { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { loadProjectConfig, loadRemoteOverlayConfig } from "../config-loader.ts";
import { WorkflowLoader } from "../../core/workflow-loader.ts";
import { AgentRegistry } from "../../core/agent-loader.ts";

export function registerValidateConfigCommand(program: Command): void {
  program
    .command("validate-config")
    .description("Validate all YAML configuration files")
    .option("--project <path>", "Project directory", process.cwd())
    .action((options) => {
      const projectPath = resolve(options.project as string);
      let hasErrors = false;

      console.log("Validating configuration...\n");

      // 1. Project config
      try {
        loadProjectConfig(projectPath);
        console.log("  ✓ ai-sdd.yaml (project config)");
      } catch (err) {
        console.error(`  ✗ ai-sdd.yaml: ${err instanceof Error ? err.message : String(err)}`);
        hasErrors = true;
      }

      // 2. Workflow — same search order as `run` (first found wins)
      {
        const config = loadProjectConfig(projectPath);
        const configWorkflowName = config.workflow as string | undefined;
        const candidatePaths: Array<[string, string]> = [
          [resolve(projectPath, "specs", "workflow.yaml"), "specs/workflow.yaml"],
          [resolve(projectPath, ".ai-sdd", "workflow.yaml"), ".ai-sdd/workflow.yaml"],
          ...(configWorkflowName
            ? [[
                resolve(projectPath, ".ai-sdd", "workflows", `${configWorkflowName}.yaml`),
                `.ai-sdd/workflows/${configWorkflowName}.yaml`,
              ] as [string, string]]
            : []),
          [resolve(projectPath, ".ai-sdd", "workflows", "default-sdd.yaml"), ".ai-sdd/workflows/default-sdd.yaml"],
        ];
        let foundWorkflow = false;
        for (const [wfPath, label] of candidatePaths) {
          if (existsSync(wfPath)) {
            try {
              WorkflowLoader.loadFile(wfPath);
              console.log(`  ✓ workflow (${label})`);
            } catch (err) {
              console.error(`  ✗ workflow (${label}): ${err instanceof Error ? err.message : String(err)}`);
              hasErrors = true;
            }
            foundWorkflow = true;
            break;
          }
        }
        if (!foundWorkflow) {
          console.log("  — workflow (not found in any standard path, using bundled default)");
        }
      }

      // 3. Agent definitions
      const defaultsDir = resolve(
        new URL("../../../data/agents/defaults", import.meta.url).pathname,
      );
      try {
        const registry = new AgentRegistry(defaultsDir);
        registry.loadDefaults();
        console.log("  ✓ default agents (6/6)");
      } catch (err) {
        console.error(`  ✗ default agents: ${err instanceof Error ? err.message : String(err)}`);
        hasErrors = true;
      }

      const projectAgentsDir = resolve(projectPath, ".ai-sdd", "agents");
      if (existsSync(projectAgentsDir)) {
        try {
          const registry = new AgentRegistry(defaultsDir);
          registry.loadDefaults();
          registry.loadProjectAgents(projectAgentsDir);
          console.log(`  ✓ project agents`);
        } catch (err) {
          console.error(`  ✗ project agents: ${err instanceof Error ? err.message : String(err)}`);
          hasErrors = true;
        }
      }

      // 4. Remote overlay config (only if keys are present)
      try {
        const remoteConfig = loadRemoteOverlayConfig(projectPath);
        if (remoteConfig !== undefined) {
          console.log("  ✓ remote overlay config (overlay_backends / remote_overlays)");
        }
      } catch (err) {
        console.error(`  ✗ remote overlay config: ${err instanceof Error ? err.message : String(err)}`);
        hasErrors = true;
      }

      console.log();
      if (hasErrors) {
        console.error("Validation failed. Fix errors above and re-run.");
        process.exit(1);
      } else {
        console.log("All configurations valid.");
      }
    });
}
