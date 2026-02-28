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

const STATUS_SYMBOLS: Record<TaskStatus, string> = {
  PENDING: "○",
  RUNNING: "◉",
  COMPLETED: "✓",
  NEEDS_REWORK: "↺",
  HIL_PENDING: "⏳",
  FAILED: "✗",
};

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show workflow execution status")
    .option("--json", "Output full workflow state as JSON")
    .option("--next", "Output next ready tasks (use with --json for MCP)")
    .option("--metrics", "Include cost/token/duration per task")
    .option("--project <path>", "Project directory", process.cwd())
    .action((options) => {
      const projectPath = resolve(options.project as string);
      const stateDir = resolve(projectPath, ".ai-sdd", "state");

      const stateManager = new StateManager(stateDir, "workflow", projectPath);
      try {
        stateManager.load();
      } catch {
        console.error("No workflow state found. Run: ai-sdd run");
        process.exit(1);
      }

      const state = stateManager.getState();

      if (options.json) {
        if (options.next) {
          // --next --json: return ready tasks
          const ready = Object.entries(state.tasks)
            .filter(([, s]) => s.status === "PENDING")
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

      console.log("\n" + "─".repeat(maxIdLen + 40));
      console.log(`Total: ${tasks.length} | ✓ ${completed} | ✗ ${failed} | ○ ${pending}`);
    });
}
