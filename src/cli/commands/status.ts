/**
 * ai-sdd status — show workflow execution status.
 */

import type { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { StateManager } from "../../core/state-manager.ts";
import { WorkflowLoader } from "../../core/workflow-loader.ts";
import type { TaskStatus } from "../../types/index.ts";
import { resolveSession } from "../../core/session-resolver.ts";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

const STATUS_SYMBOLS: Record<TaskStatus, string> = {
  PENDING:           "○",
  RUNNING:           "◉",
  COMPLETED:         "✓",
  NEEDS_REWORK:      "↺",
  HIL_PENDING:       "⏳",
  FAILED:            "✗",
  CANCELLED:         "⊘",
  AWAITING_APPROVAL: "⏳",
  APPROVED:          "✓",
  DOING:             "◉",
};

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show workflow execution status")
    .option("--json", "Output full workflow state as JSON")
    .option("--next", "Output next ready tasks (use with --json for MCP)")
    .option("--metrics", "Include cost/token/duration per task")
    .option("--workflow <name>", "Workflow name (loads .ai-sdd/workflows/<name>.yaml)")
    .option("--feature <name>", "Feature/session name")
    .option("--project <path>", "Project directory", process.cwd())
    .action((options) => {
      const projectPath = resolve(options.project as string);

      const session = resolveSession({
        projectPath,
        featureName: options.feature as string | undefined,
        workflowName: options.workflow as string | undefined,
      });

      // Resolve workflow name for StateManager
      let workflowName = "workflow";
      if (session.workflowPath && existsSync(session.workflowPath)) {
        try {
          const wf = WorkflowLoader.loadFile(session.workflowPath);
          workflowName = wf.config.name;
        } catch {
          // Malformed YAML — fall back
        }
      }

      const stateManager = new StateManager(session.stateDir, workflowName, projectPath);
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
          let dependsOn: Record<string, string[]> = {};
          if (session.workflowPath && existsSync(session.workflowPath)) {
            try {
              const wf = WorkflowLoader.loadFile(session.workflowPath);
              for (const [id, task] of wf.tasks) {
                dependsOn[id] = task.depends_on ?? [];
              }
            } catch {
              // Malformed — skip dependency filtering
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
      const showMetrics = Boolean(options.metrics);

      const header = showMetrics
        ? `${"Task".padEnd(maxIdLen)}  Status       Iter  Completed   Tokens      Cost`
        : `${"Task".padEnd(maxIdLen)}  Status       Iter  Completed`;
      const ruleLen = showMetrics ? maxIdLen + 58 : maxIdLen + 40;

      console.log(header);
      console.log("─".repeat(ruleLen));

      for (const [id, taskState] of tasks) {
        const symbol = STATUS_SYMBOLS[taskState.status];
        const statusStr = `${symbol} ${taskState.status}`.padEnd(15);
        const iterStr = String(taskState.iterations).padStart(4);
        const completedStr = taskState.completed_at
          ? taskState.completed_at.substring(0, 10)
          : "—";
        if (showMetrics) {
          const dur = taskState.started_at && taskState.completed_at
            ? formatDuration(Date.parse(taskState.completed_at) - Date.parse(taskState.started_at))
            : "—";
          const tokens = taskState.tokens_used
            ? String(taskState.tokens_used.total).padStart(8)
            : "       —";
          const cost = taskState.cost_usd !== undefined
            ? `$${taskState.cost_usd.toFixed(4)}`.padStart(9)
            : "        —";
          console.log(`${id.padEnd(maxIdLen)}  ${statusStr}  ${iterStr}  ${completedStr}  ${dur.padEnd(5)}  ${tokens}  ${cost}`);
        } else {
          console.log(`${id.padEnd(maxIdLen)}  ${statusStr}  ${iterStr}  ${completedStr}`);
        }
      }

      const completed = tasks.filter(([, s]) => s.status === "COMPLETED").length;
      const failed = tasks.filter(([, s]) => s.status === "FAILED").length;
      const pending = tasks.filter(([, s]) => s.status === "PENDING").length;
      const cancelled = tasks.filter(([, s]) => s.status === "CANCELLED").length;

      console.log("\n" + "─".repeat(ruleLen));

      if (showMetrics) {
        const totalTokens = tasks.reduce((sum, [, s]) => sum + (s.tokens_used?.total ?? 0), 0);
        const totalCost = tasks.reduce((sum, [, s]) => sum + (s.cost_usd ?? 0), 0);
        console.log(`Total: ${tasks.length} | ✓ ${completed} | ✗ ${failed} | ○ ${pending} | ⊘ ${cancelled} | tokens: ${totalTokens} | cost: $${totalCost.toFixed(4)}`);
      } else {
        console.log(`Total: ${tasks.length} | ✓ ${completed} | ✗ ${failed} | ○ ${pending} | ⊘ ${cancelled}`);
      }
    });
}
