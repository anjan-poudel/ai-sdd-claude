/**
 * MCP server — delegates all tool calls to ai-sdd CLI via subprocess.
 * 10 MCP tools including session management.
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

const FEATURE_PROP = {
  feature: { type: "string", description: "Feature/session name (optional — uses active session if omitted)" },
} as const;

const TOOLS = [
  {
    name: "get_next_task",
    description: "Get the next ready task(s) from the workflow",
    inputSchema: { type: "object", properties: { ...FEATURE_PROP }, required: [] },
  },
  {
    name: "get_workflow_status",
    description: "Get the current workflow execution status",
    inputSchema: { type: "object", properties: { ...FEATURE_PROP }, required: [] },
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
        ...FEATURE_PROP,
      },
      required: ["task_id", "output_path", "content"],
    },
  },
  {
    name: "list_hil_items",
    description: "List pending HIL (human-in-the-loop) items",
    inputSchema: { type: "object", properties: { ...FEATURE_PROP }, required: [] },
  },
  {
    name: "resolve_hil",
    description: "Resolve (approve) a HIL item",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "HIL item ID" },
        notes: { type: "string", description: "Approval notes (optional)" },
        ...FEATURE_PROP,
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
        ...FEATURE_PROP,
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
        ...FEATURE_PROP,
      },
      required: [],
    },
  },
  {
    name: "list_sessions",
    description: "List all workflow sessions",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_active_session",
    description: "Get the currently active session name",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "switch_session",
    description: "Switch to a different workflow session",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Session name to switch to" },
      },
      required: ["name"],
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

/** Build --feature arg array if feature name is provided. */
function featureArgs(args: Record<string, unknown>): string[] {
  const feature = args.feature as string | undefined;
  return feature ? ["--feature", feature] : [];
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
        const result = runCli(
          ["status", "--next", "--json", ...featureArgs(args as Record<string, unknown>), ...projectArg],
          options.project_path,
        );
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "get_workflow_status": {
        const result = runCli(
          ["status", "--json", ...featureArgs(args as Record<string, unknown>), ...projectArg],
          options.project_path,
        );
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "complete_task": {
        const { task_id, output_path, content, contract, feature } = args as {
          task_id: string;
          output_path: string;
          content: string;
          contract?: string;
          feature?: string;
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
          if (feature) cliArgs.push("--feature", feature);

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
        const fArgs = featureArgs(args as Record<string, unknown>);
        const result = runCli(["hil", ...fArgs, "list", ...projectArg], options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "resolve_hil": {
        const { id, notes } = args as { id: string; notes?: string; feature?: string };
        const fArgs = featureArgs(args as Record<string, unknown>);
        const cliArgs = ["hil", ...fArgs, "resolve", id, ...projectArg];
        if (notes) cliArgs.push("--notes", notes);
        const result = runCli(cliArgs, options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "reject_hil": {
        const { id, reason } = args as { id: string; reason?: string; feature?: string };
        const fArgs = featureArgs(args as Record<string, unknown>);
        const cliArgs = ["hil", ...fArgs, "reject", id, ...projectArg];
        if (reason) cliArgs.push("--reason", reason);
        const result = runCli(cliArgs, options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "get_constitution": {
        const { task_id, feature } = args as { task_id?: string; feature?: string };
        const cliArgs = ["constitution", ...projectArg];
        if (task_id) cliArgs.push("--task", task_id);
        if (feature) cliArgs.push("--feature", feature);
        const result = runCli(cliArgs, options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "list_sessions": {
        const result = runCli(["sessions", "list", "--json", ...projectArg], options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "get_active_session": {
        const result = runCli(["sessions", "active", "--json", ...projectArg], options.project_path);
        return { content: [{ type: "text", text: result.stdout || result.stderr }] };
      }

      case "switch_session": {
        const { name: sessionName } = args as { name: string };
        const result = runCli(["sessions", "switch", sessionName, ...projectArg], options.project_path);
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
