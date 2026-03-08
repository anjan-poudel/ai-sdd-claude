/**
 * MCP server — delegates all tool calls to ai-sdd CLI via subprocess.
 * ~100 lines; 6 MCP tools.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawnSync } from "child_process";
import type { SpawnSyncOptions } from "child_process";

export interface McpServerOptions {
  project_path: string;
}

const TOOLS = [
  {
    name: "get_next_task",
    description: "Get the next ready task(s) from the workflow",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_workflow_status",
    description: "Get the current workflow execution status",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "complete_task",
    description: "Mark a task as completed with its output artifact",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID to complete" },
        output_path: { type: "string", description: "Output file path" },
        content: { type: "string", description: "Output artifact content" },
        contract: { type: "string", description: "Artifact contract name (optional)" },
      },
      required: ["task_id", "output_path", "content"],
    },
  },
  {
    name: "list_hil_items",
    description: "List pending HIL (human-in-the-loop) items",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "resolve_hil",
    description: "Resolve (approve) a HIL item",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "HIL item ID" },
        notes: { type: "string", description: "Approval notes (optional)" },
      },
      required: ["id"],
    },
  },
  {
    name: "reject_hil",
    description: "Reject a HIL item",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "HIL item ID" },
        reason: { type: "string", description: "Rejection reason (optional)" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_constitution",
    description: "Get the merged project constitution",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID for scoped constitution (optional)" },
      },
      required: [],
    },
  },
];

function runCli(
  args: string[],
  projectPath: string,
  input?: string,
): { stdout: string; stderr: string; exitCode: number } {
  const opts: SpawnSyncOptions = {
    cwd: projectPath,
    encoding: "utf-8",
    input,
  };
  // Use bun to run the CLI directly
  const result = spawnSync("ai-sdd", args, opts);
  return {
    stdout: (result.stdout as string) ?? "",
    stderr: (result.stderr as string) ?? "",
    exitCode: result.status ?? 1,
  };
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const server = new Server(
    { name: "ai-sdd", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const projectArg = ["--project", options.project_path];

    switch (name) {
      case "get_next_task": {
        const result = runCli(["status", "--next", "--json", ...projectArg], options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "get_workflow_status": {
        const result = runCli(["status", "--json", ...projectArg], options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "complete_task": {
        const { task_id, output_path, content, contract } = args as {
          task_id: string;
          output_path: string;
          content: string;
          contract?: string;
        };

        // Write content to a temp file
        const tmpFile = `/tmp/ai-sdd-mcp-${Date.now()}.tmp`;
        const { writeFileSync, unlinkSync } = await import("fs");
        writeFileSync(tmpFile, content, "utf-8");

        try {
          const cliArgs = [
            "complete-task",
            "--task", task_id,
            "--output-path", output_path,
            "--content-file", tmpFile,
            ...projectArg,
          ];
          if (contract) cliArgs.push("--contract", contract);

          const result = runCli(cliArgs, options.project_path);
          return {
            content: [{
              type: "text",
              text: result.exitCode === 0
                ? result.stdout
                : `Error: ${result.stderr || result.stdout}`,
            }],
          };
        } finally {
          try { unlinkSync(tmpFile); } catch { /* ignore */ }
        }
      }

      case "list_hil_items": {
        const result = runCli(["hil", "list", ...projectArg], options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "resolve_hil": {
        const { id, notes } = args as { id: string; notes?: string };
        const cliArgs = ["hil", "resolve", id, ...projectArg];
        if (notes) cliArgs.push("--notes", notes);
        const result = runCli(cliArgs, options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "reject_hil": {
        const { id, reason } = args as { id: string; reason?: string };
        const cliArgs = ["hil", "reject", id, ...projectArg];
        if (reason) cliArgs.push("--reason", reason);
        const result = runCli(cliArgs, options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "get_constitution": {
        const { task_id } = args as { task_id?: string };
        const cliArgs = ["constitution", ...projectArg];
        if (task_id) cliArgs.push("--task", task_id);
        const result = runCli(cliArgs, options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`ai-sdd MCP server started (stdio transport)\n`);
}
