/**
 * ai-sdd serve --mcp — start the MCP server.
 */

import type { Command } from "commander";
import { resolve } from "path";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the ai-sdd MCP server (stdio transport)")
    .option("--mcp", "Start as MCP server (required)")
    .option("--project <path>", "Project directory", process.cwd())
    .action(async (options) => {
      if (!options.mcp) {
        console.error("Use: ai-sdd serve --mcp");
        process.exit(1);
      }

      const projectPath = resolve(options.project as string);

      const { startMcpServer } = await import("../../integration/mcp-server/server.ts");
      await startMcpServer({ project_path: projectPath });
    });
}
