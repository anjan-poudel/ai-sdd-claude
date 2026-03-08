/**
 * ai-sdd status — show workflow execution status.
 */

import type { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { StateManager } from "../../core/state-manager.ts";
import { WorkflowLoader } from "../../core/workflow-loader.ts";
import { loadProjectConfig } from "../config-loader.ts";
import type { TaskStatus } from "../../types/index.ts";

/** Resolve the workflow name using the same search order as the run command. */
function resolveWorkflowName(
  projectPath: string,
  configWorkflowName?: string,
  cliWorkflowName?: string,
): string {
  const cliPath = cliWorkflowName
    ? resolve(projectPath, ".ai-sdd", "workflows", `${cliWorkflowName}.yaml`)
    : null;
  const wfPaths = [
    ...(cliPath ? [cliPath] : []),
    resolve(projectPath, ".ai-sdd", "workflow.yaml"),
    ...(configWorkflowName
      ? [resolve(projectPath, ".ai-sdd", "workflows", `${configWorkflowName}.yaml`)]
      : []),
    resolve(projectPath, ".ai-sdd", "workflows", "default-sdd.yaml"),
  ];
  for (const p of wfPaths) {
    if (existsSync(p)) {
      try {
        const wf = WorkflowLoader.loadFile(p);
        return wf.config.name;
      } catch {
        // Malformed YAML — skip
      }
    }
  }
  // Fall back to the name stored in the state file (load() will override the constructor value)
  return "workflow";
}

const STATUS_SYMBOLS: Record<TaskStatus, string> = {
  PENDING: "○",
  RUNNING: "◉",
  COMPLETED: "✓",
  NEEDS_REWORK: "↺",
  HIL_PENDING: "⏳",
  FAILED: "✗",
  CANCELLED: "⊘",
};

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show workflow execution status")
    .option("--json", "Output full workflow state as JSON")
    .option("--next", "Output next ready tasks (use with --json for MCP)")
    .option("--metrics", "Include cost/token/duration per task")
    .option("--workflow <name>", "Workflow name (loads .ai-sdd/workflows/<name>.yaml)")
    .option("--project <path>", "Project directory", process.cwd())
    .action((options) => {
      const projectPath = resolve(options.project as string);
      const stateDir = resolve(projectPath, ".ai-sdd", "state");

      const config = loadProjectConfig(projectPath);
      const workflowName = resolveWorkflowName(
        projectPath,
        config.workflow as string | undefined,
        options.workflow as string | undefined,
      );
      const stateManager = new StateManager(stateDir, workflowName, projectPath);
      try {
        stateManager.load();
      } catch {
        console.error("No workflow state found. Run: ai-sdd run");
        process.exit(1);
      }

      const state = stateManager.getState();

      if (options.json) {
        if (options.next) {
          // --next --json: return tasks that are PENDING AND have all dependencies COMPLETED.
          // Load the workflow to build the dependency map.
          const wfSearchPaths = [
            resolve(projectPath, "specs", "workflow.yaml"),
            resolve(projectPath, ".ai-sdd", "workflow.yaml"),
            ...(options.workflow
              ? [resolve(projectPath, ".ai-sdd", "workflows", `${options.workflow as string}.yaml`)]
              : []),
            resolve(projectPath, ".ai-sdd", "workflows", "default-sdd.yaml"),
          ];
          let dependsOn: Record<string, string[]> = {};
          for (const p of wfSearchPaths) {
            if (existsSync(p)) {
              try {
                const wf = WorkflowLoader.loadFile(p);
                for (const [id, task] of wf.tasks) {
                  dependsOn[id] = task.depends_on ?? [];
                }
                break;
              } catch {
                // Malformed — try next path
              }
            }
          }

          const ready = Object.entries(state.tasks)
            .filter(([id, s]) => {
              if (s.status !== "PENDING") return false;
              const deps = dependsOn[id] ?? [];
              return deps.every((dep) => state.tasks[dep]?.status === "COMPLETED");
            })
            .map(([id, s]) => ({ id, ...s }));
          console.log(JSON.stringify({ ready_tasks: ready }, null, 2));
        } else {
          console.log(JSON.stringify(state, null, 2));
        }
        return;
      }

      // Human-readable table
      console.log(`\nWorkflow: ${state.workflow}`);
      console.log(`Project:  ${state.project}`);
      console.log(`Started:  ${state.started_at}`);
      console.log(`Updated:  ${state.updated_at}`);
      console.log();

      const tasks = Object.entries(state.tasks);
      const maxIdLen = Math.max(...tasks.map(([id]) => id.length), 10);

      console.log(
        `${"Task".padEnd(maxIdLen)}  Status       Iter  Completed`,
      );
      console.log("─".repeat(maxIdLen + 40));

      for (const [id, taskState] of tasks) {
        const symbol = STATUS_SYMBOLS[taskState.status];
        const statusStr = `${symbol} ${taskState.status}`.padEnd(15);
        const iterStr = String(taskState.iterations).padStart(4);
        const completedStr = taskState.completed_at
          ? taskState.completed_at.substring(0, 10)
          : "—";
        console.log(`${id.padEnd(maxIdLen)}  ${statusStr}  ${iterStr}  ${completedStr}`);
      }

      const completed = tasks.filter(([, s]) => s.status === "COMPLETED").length;
      const failed = tasks.filter(([, s]) => s.status === "FAILED").length;
      const pending = tasks.filter(([, s]) => s.status === "PENDING").length;
      const cancelled = tasks.filter(([, s]) => s.status === "CANCELLED").length;

      console.log("\n" + "─".repeat(maxIdLen + 40));
      console.log(`Total: ${tasks.length} | ✓ ${completed} | ✗ ${failed} | ○ ${pending} | ⊘ ${cancelled}`);
    });
}
