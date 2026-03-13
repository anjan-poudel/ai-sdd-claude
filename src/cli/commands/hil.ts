/**
 * ai-sdd hil — HIL queue management commands.
 */

import type { Command } from "commander";
import { resolve } from "path";
import { HilQueue } from "../../overlays/hil/hil-queue.ts";
import { StateManager } from "../../core/state-manager.ts";
import { WorkflowLoader } from "../../core/workflow-loader.ts";
import { existsSync } from "fs";
import { resolveSession } from "../../core/session-resolver.ts";

export function registerHilCommand(program: Command): void {
  const hil = program
    .command("hil")
    .description("Manage human-in-the-loop (HIL) queue")
    .option("--feature <name>", "Feature/session name");

  // hil list
  hil
    .command("list")
    .description("List PENDING HIL items")
    .option("--json", "Output as JSON array (for MCP/agent consumption)")
    .option("--project <path>", "Project directory", process.cwd())
    .action((options) => {
      const projectPath = resolve(options.project as string);
      const featureName = hil.opts().feature as string | undefined;
      const session = resolveSession({ projectPath, featureName });
      const queue = new HilQueue(session.hilQueuePath);

      const items = queue.list("PENDING");

      if (options.json) {
        console.log(JSON.stringify({ pending_hil_items: items }, null, 2));
        return;
      }

      if (items.length === 0) {
        console.log("No pending HIL items.");
        return;
      }

      console.log(`\n${items.length} pending HIL item(s):\n`);
      for (const item of items) {
        console.log(`  ID:      ${item.id}`);
        console.log(`  Task:    ${item.task_id}`);
        console.log(`  Reason:  ${item.reason}`);
        console.log(`  Created: ${item.created_at}`);
        console.log();
      }
    });

  // hil show <id>
  hil
    .command("show <id>")
    .description("Show details of a HIL item")
    .option("--project <path>", "Project directory", process.cwd())
    .action((id: string, options) => {
      const projectPath = resolve(options.project as string);
      const featureName = hil.opts().feature as string | undefined;
      const session = resolveSession({ projectPath, featureName });
      const queue = new HilQueue(session.hilQueuePath);

      const item = queue.get(id);
      if (!item) {
        console.error(`HIL item '${id}' not found.`);
        process.exit(1);
      }

      console.log(JSON.stringify(item, null, 2));
    });

  // hil resolve <id>  (also aliased as hil approve <id>)
  const resolveAction = (id: string, options: Record<string, unknown>) => {
    const projectPath = resolve(options.project as string);
    const featureName = hil.opts().feature as string | undefined;
    const session = resolveSession({ projectPath, featureName });
    const queue = new HilQueue(session.hilQueuePath);

    const item = queue.resolve(id, options.notes as string | undefined);

    // Also advance the task from HIL_PENDING → RUNNING in workflow state so that
    // the next `ai-sdd run` picks it up correctly even if the engine process has exited.
    // (ISSUE-005: hil resolve didn't update workflow state when engine was dead.)
    let workflowName = "workflow";
    if (session.workflowPath && existsSync(session.workflowPath)) {
      try {
        const wf = WorkflowLoader.loadFile(session.workflowPath);
        workflowName = wf.config.name;
      } catch { /* malformed yaml — fall back */ }
    }
    const stateManager = new StateManager(session.stateDir, workflowName, projectPath);
    try {
      stateManager.load();
      const taskState = stateManager.getTaskState(item.task_id);
      if (taskState.status === "HIL_PENDING") {
        stateManager.transition(item.task_id, "RUNNING", {});
        console.log(`Workflow state advanced: '${item.task_id}' HIL_PENDING → RUNNING.`);
      }
    } catch {
      // State file missing or task not found — engine will handle it on next run.
    }

    console.log(`HIL item '${id}' resolved. Task '${item.task_id}' will resume on next 'ai-sdd run'.`);
  };

  hil
    .command("resolve <id>")
    .description("Resolve (approve) a HIL item")
    .option("--notes <text>", "Optional notes")
    .option("--project <path>", "Project directory", process.cwd())
    .action(resolveAction);

  // approve is an alias for resolve (ISSUE-008)
  hil
    .command("approve <id>")
    .description("Approve a HIL item (alias for resolve)")
    .option("--notes <text>", "Optional notes")
    .option("--project <path>", "Project directory", process.cwd())
    .action(resolveAction);

  // hil reject <id>
  hil
    .command("reject <id>")
    .description("Reject a HIL item (task will fail)")
    .option("--reason <text>", "Rejection reason")
    .option("--project <path>", "Project directory", process.cwd())
    .action((id: string, options) => {
      const projectPath = resolve(options.project as string);
      const featureName = hil.opts().feature as string | undefined;
      const session = resolveSession({ projectPath, featureName });
      const queue = new HilQueue(session.hilQueuePath);

      const item = queue.reject(id, options.reason as string | undefined);
      console.log(`HIL item '${id}' rejected. Task '${item.task_id}' will fail.`);
    });
}
