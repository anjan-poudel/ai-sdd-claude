/**
 * ai-sdd validate-config — validate all YAML configs.
 */

import type { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { loadProjectConfig } from "../config-loader.ts";
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

      // 2. Workflow
      const workflowPath = resolve(projectPath, ".ai-sdd", "workflow.yaml");
      if (existsSync(workflowPath)) {
        try {
          WorkflowLoader.loadFile(workflowPath);
          console.log("  ✓ workflow.yaml");
        } catch (err) {
          console.error(`  ✗ workflow.yaml: ${err instanceof Error ? err.message : String(err)}`);
          hasErrors = true;
        }
      } else {
        console.log("  — workflow.yaml (not found, using default)");
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

      console.log();
      if (hasErrors) {
        console.error("Validation failed. Fix errors above and re-run.");
        process.exit(1);
      } else {
        console.log("All configurations valid.");
      }
    });
}
