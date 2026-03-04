/**
 * ai-sdd hil — HIL queue management commands.
 */

import type { Command } from "commander";
import { resolve } from "path";
import { HilQueue } from "../../overlays/hil/hil-queue.ts";
import { loadProjectConfig } from "../config-loader.ts";

export function registerHilCommand(program: Command): void {
  const hil = program
    .command("hil")
    .description("Manage human-in-the-loop (HIL) queue");

  // hil list
  hil
    .command("list")
    .description("List PENDING HIL items")
    .option("--json", "Output as JSON array (for MCP/agent consumption)")
    .option("--project <path>", "Project directory", process.cwd())
    .action((options) => {
      const projectPath = resolve(options.project as string);
      const config = loadProjectConfig(projectPath);
      const queuePath = resolve(projectPath, config.overlays?.hil?.queue_path ?? ".ai-sdd/state/hil/");
      const queue = new HilQueue(queuePath);

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
      const config = loadProjectConfig(projectPath);
      const queuePath = resolve(projectPath, config.overlays?.hil?.queue_path ?? ".ai-sdd/state/hil/");
      const queue = new HilQueue(queuePath);

      const item = queue.get(id);
      if (!item) {
        console.error(`HIL item '${id}' not found.`);
        process.exit(1);
      }

      console.log(JSON.stringify(item, null, 2));
    });

  // hil resolve <id>
  hil
    .command("resolve <id>")
    .description("Resolve (approve) a HIL item")
    .option("--notes <text>", "Optional notes")
    .option("--project <path>", "Project directory", process.cwd())
    .action((id: string, options) => {
      const projectPath = resolve(options.project as string);
      const config = loadProjectConfig(projectPath);
      const queuePath = resolve(projectPath, config.overlays?.hil?.queue_path ?? ".ai-sdd/state/hil/");
      const queue = new HilQueue(queuePath);

      const item = queue.resolve(id, options.notes as string | undefined);
      console.log(`HIL item '${id}' resolved. Task '${item.task_id}' will resume.`);
    });

  // hil reject <id>
  hil
    .command("reject <id>")
    .description("Reject a HIL item (task will fail)")
    .option("--reason <text>", "Rejection reason")
    .option("--project <path>", "Project directory", process.cwd())
    .action((id: string, options) => {
      const projectPath = resolve(options.project as string);
      const config = loadProjectConfig(projectPath);
      const queuePath = resolve(projectPath, config.overlays?.hil?.queue_path ?? ".ai-sdd/state/hil/");
      const queue = new HilQueue(queuePath);

      const item = queue.reject(id, options.reason as string | undefined);
      console.log(`HIL item '${id}' rejected. Task '${item.task_id}' will fail.`);
    });
}
