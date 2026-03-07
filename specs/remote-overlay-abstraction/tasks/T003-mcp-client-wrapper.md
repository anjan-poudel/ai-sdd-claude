# T003 — McpClientWrapper

## Metadata
- **ID**: T003
- **FR/NFR**: FR-003, NFR-001, NFR-002, NFR-004
- **Owner**: developer
- **Depends on**: T001, T007
- **Estimate**: M (2-4h)

## Context

`McpOverlayProvider` (T004) needs to communicate with remote MCP servers over stdio. All MCP SDK calls must be confined to a single wrapper class so that:
1. The SDK's types do not leak into the rest of the codebase.
2. Timeout enforcement is centralized in one place.
3. Tests can use a mock wrapper without a real MCP server.

The MCP SDK version already in `package.json` is `@modelcontextprotocol/sdk@^1.0.4`. No new dependency is added. The wrapper uses `StdioClientTransport` and `Client` from the SDK, with stdio transport only (SSE is out of scope).

**Important**: Before implementing, inspect the installed SDK's `CallToolResult` type to determine the correct response unwrapping. The SDK wraps tool responses in an envelope — the implementation must extract the correct content field. A fixture test must capture this behavior to prevent schema drift.

## Files to create/modify

- `src/overlays/mcp/mcp-client.ts` — create — `McpClientWrapper` class + error classes
- `tests/overlays/mcp/mcp-client.test.ts` — create — lifecycle + timeout + fixture tests

## Implementation spec

### `src/overlays/mcp/mcp-client.ts`

```typescript
// Custom error classes with actionable messages
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

export class McpSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpSchemaError";
  }
}

export class McpClientWrapper {
  private _connected = false;
  private _client: /* SDK Client type */ unknown = null;

  constructor(private readonly config: ResolvedBackendConfig & { runtime: "mcp" }) {
    // Validate transport at construction time, not deferred to connect()
    if (config.transport !== "stdio") {
      throw new TypeError(
        `McpClientWrapper: unsupported transport '${config.transport}'. ` +
        `Only 'stdio' is supported in this release.`
      );
    }
  }

  async connect(): Promise<void>;
  async disconnect(): Promise<void>;
  async callTool(toolName: string, input: unknown): Promise<unknown>;
  get isConnected(): boolean;
}
```

**`connect()` implementation:**
1. Import `Client` and `StdioClientTransport` from `@modelcontextprotocol/sdk`.
2. Build `StdioClientTransport` from `config.command` (first element = executable, rest = args) and `config.env` merged with `process.env` (overlay, not replace).
3. Instantiate `Client` with a client info object (name: `"ai-sdd"`, version: `"1"` or from package.json).
4. Call `client.connect(transport)`.
5. Set `this._connected = true`.

**`callTool()` implementation:**
1. If `!this._connected`, throw `McpNotConnectedError(config.command[0])`.
2. `timeout = this.config.timeout_ms ?? 5000`.
3. Use `Promise.race`:
   ```typescript
   const timeoutPromise = new Promise<never>((_, reject) =>
     setTimeout(() => reject(new McpTimeoutError(toolName, timeout)), timeout)
   );
   const callPromise = this._client.callTool({ name: toolName, arguments: input as Record<string, unknown> });
   const raw = await Promise.race([callPromise, timeoutPromise]);
   ```
4. Extract content from the SDK envelope. **Implementation note**: inspect `CallToolResult` in `@modelcontextprotocol/sdk`. At version `^1.0.4`, the result is likely `{ content: Array<{ type: "text", text: string } | { type: "json", data: unknown }> }`. Extract the first content item. If `type === "text"`, parse as JSON. If `type === "json"`, return `data` directly. If neither, return the raw text string.
5. Return the extracted plain value (no SDK types).

**`disconnect()` implementation:**
1. If `!this._connected`, return (no-op, no throw).
2. Call `this._client.close()`.
3. Set `this._connected = false`.

**Key constraints:**
- Use `import.meta.url` not `__dirname`.
- No `require()` calls.
- No `any` types — use SDK's exported types for internal fields, but the public API signatures must be plain TypeScript.

## Tests to write

**File**: `tests/overlays/mcp/mcp-client.test.ts`

Use an in-process mock MCP server or a test double for `McpClientWrapper`. Do NOT make real network connections in tests.

Required test cases:

1. `callTool` before `connect()` throws `McpNotConnectedError` — assert `error.name === "McpNotConnectedError"` and message includes "Call connect() first"
2. Successful `connect()` + `callTool` with mock server — returns unwrapped plain value; assert no SDK types in return value shape
3. `callTool` timeout: configure `timeout_ms: 100`, mock server that never responds; assert rejects with `McpTimeoutError` within 150ms (100 + 50ms tolerance); assert `error.timeoutMs === 100`
4. `disconnect()` after tool call — `isConnected === false`; subsequent `callTool` throws `McpNotConnectedError`
5. `disconnect()` when not connected — no-op, no throw
6. Transport `"sse"` at construction — throws `TypeError` with message naming `"sse"` as unsupported
7. **External schema fixture** (required by CLAUDE.md §4): assert that the SDK's `CallToolResult` response shape matches the unwrapping logic implemented. Capture a real response shape from `@modelcontextprotocol/sdk@1.0.4` as a fixture file at `tests/overlays/mcp/fixtures/mcp-call-tool-result.json`. The test imports this fixture and asserts the unwrapping returns the expected content. This fixture prevents schema drift if the SDK is upgraded.

**Fixture format** (create `tests/overlays/mcp/fixtures/mcp-call-tool-result.json`):
```json
{
  "sdk_version": "1.0.4",
  "sample_response": { ... captured from real SDK ... },
  "expected_unwrapped": { ... what callTool should return ... }
}
```

**Config-to-behavior test** (required by CLAUDE.md §1):
8. `timeout_ms: 200` config → timer fires at ≤250ms; `timeout_ms: 500` config → timer does not fire at 250ms. Assert that changing the config field changes the timeout behavior.

## Acceptance criteria

- [ ] `src/overlays/mcp/mcp-client.ts` exists and exports `McpClientWrapper`, `McpTimeoutError`, `McpNotConnectedError`, `McpSchemaError`
- [ ] `callTool` before `connect()` throws `McpNotConnectedError` with actionable message
- [ ] `callTool` timeout rejects with `McpTimeoutError` within `timeout_ms + 50ms`
- [ ] `disconnect()` when not connected is a no-op (no throw)
- [ ] Transport `"sse"` at construction throws `TypeError` naming `"sse"`
- [ ] No MCP SDK types in public API return values
- [ ] `tests/overlays/mcp/fixtures/mcp-call-tool-result.json` exists as external schema fixture
- [ ] `bun run typecheck` exits 0
- [ ] All existing 177 tests still pass
