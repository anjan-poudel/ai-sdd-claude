/**
 * McpClientWrapper — wraps @modelcontextprotocol/sdk Client for overlay invocations.
 * All MCP SDK calls are confined to this class; SDK types do not leak to callers.
 */
import type { ResolvedBackendConfig } from "../../config/remote-overlay-schema.ts";

export class McpTimeoutError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `MCP tool call '${toolName}' timed out after ${timeoutMs}ms. ` +
      `Increase timeout_ms in overlay_backends config if the remote is slow.`
    );
    this.name = "McpTimeoutError";
  }
}

export class McpNotConnectedError extends Error {
  constructor(public readonly backendId: string) {
    super(
      `McpClientWrapper for backend '${backendId}' is not connected. ` +
      `Call connect() before invoking callTool().`
    );
    this.name = "McpNotConnectedError";
  }
}

/** Reserved for future use. Not raised in this release. */
export class McpSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpSchemaError";
  }
}

type SdkClient = {
  connect(transport: unknown): Promise<void>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
};

/**
 * Extract the plain value from an MCP SDK callTool response envelope.
 * The SDK wraps responses in `{ content: Array<{ type: "text", text: string } | ...> }`.
 * We extract the first content item; if text, parse as JSON; otherwise return as-is.
 */
function unwrapSdkResponse(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === "object" &&
    "content" in (raw as Record<string, unknown>)
  ) {
    const content = (raw as { content: unknown[] }).content;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0] as { type: string; text?: string; data?: unknown };
      if (first.type === "text" && typeof first.text === "string") {
        try {
          return JSON.parse(first.text);
        } catch {
          return first.text;
        }
      }
      if (first.type === "json" && "data" in first) {
        return first.data;
      }
      return first;
    }
  }
  return raw;
}

export class McpClientWrapper {
  private _connected = false;
  private _client: SdkClient | null = null;
  private readonly backendId: string;

  constructor(private readonly config: ResolvedBackendConfig & { runtime: "mcp" }) {
    this.backendId = config.command[0] ?? "unknown";
    // Validate transport at construction time, not deferred to connect()
    if (config.transport !== "stdio") {
      throw new TypeError(
        `McpClientWrapper: unsupported transport '${config.transport}'. ` +
        `Only 'stdio' is supported in this release.`
      );
    }
  }

  get isConnected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

    const [command, ...args] = this.config.command;
    const mergedEnv = this.config.env
      ? { ...process.env, ...this.config.env } as Record<string, string>
      : undefined;

    const transport = new StdioClientTransport({
      command: command!,
      args,
      ...(mergedEnv !== undefined && { env: mergedEnv }),
    });

    const client = new Client(
      { name: "ai-sdd", version: "1" },
      { capabilities: {} },
    );

    await client.connect(transport);
    this._client = client as unknown as SdkClient;
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this._connected || !this._client) {
      return; // no-op
    }
    await this._client.close();
    this._connected = false;
    this._client = null;
  }

  async callTool(toolName: string, input: unknown): Promise<unknown> {
    if (!this._connected || !this._client) {
      throw new McpNotConnectedError(this.backendId);
    }

    const timeout = this.config.timeout_ms ?? 5000;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new McpTimeoutError(toolName, timeout)), timeout)
    );

    const callPromise = (this._client as SdkClient).callTool({
      name: toolName,
      arguments: input as Record<string, unknown>,
    });

    const raw = await Promise.race([callPromise, timeoutPromise]);
    return unwrapSdkResponse(raw);
  }
}
