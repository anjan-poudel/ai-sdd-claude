# FR-003: McpClientWrapper and MCP Overlay Protocol

## Metadata
- **Area:** MCP Transport
- **Priority:** MUST
- **Source:** constitution.md — Deliverables; `src/overlays/mcp/mcp-client.ts` (McpClientWrapper); `src/types/overlay-protocol.ts` (OverlayInvokeInput, OverlayInvokeOutput)

## Description

The system must provide a `McpClientWrapper` class at `src/overlays/mcp/mcp-client.ts` that
encapsulates the entire connection lifecycle and tool-call mechanics for a single remote MCP
backend. `McpOverlayProvider` must delegate all MCP SDK operations to this wrapper; no MCP SDK
types or imports may appear in `McpOverlayProvider` directly.

### `McpClientWrapper` responsibilities

1. Accept a `ResolvedBackendConfig & { runtime: "mcp" }` at construction time.
2. Validate that `config.transport` is `"stdio"` at construction time — not deferred to `connect()`. Construction must throw a `TypeError` naming unsupported transports (e.g., `"sse"`).
3. Expose `connect(): Promise<void>` — spawns the stdio subprocess and establishes the MCP session using `@modelcontextprotocol/sdk`.
4. Expose `disconnect(): Promise<void>` — cleanly closes the connection. Must be a no-op if not connected.
5. Expose `callTool(toolName: string, input: unknown): Promise<unknown>` — sends an MCP tool call and returns the unwrapped response value. Must unwrap the SDK's `{ content: Array<{ type, text/data }> }` envelope before returning.
6. Enforce a per-call timeout equal to `config.timeout_ms` (default `5000`). A call that exceeds the timeout must reject with `McpTimeoutError`.
7. Throw `McpNotConnectedError` with an actionable message when `callTool` is invoked before `connect()`.
8. Not expose any MCP SDK types in the public API — callers receive plain TypeScript values.

### Named error types

Three typed error classes must exist and must use `instanceof`-checkable class syntax (not plain `Error`):

- `McpTimeoutError(toolName: string, timeoutMs: number)` — thrown when a call exceeds `timeout_ms`
- `McpNotConnectedError(backendId: string)` — thrown when `callTool` is called before `connect()`
- `McpSchemaError(message: string)` — reserved for schema-level parse failures (raised in `McpOverlayProvider`)

### `overlay.invoke` protocol

The wire protocol for `callTool("overlay.invoke", input)` uses the following input and output
types (defined in `src/types/overlay-protocol.ts`):

**Input** (`OverlayInvokeInput`):
- `protocol_version: "1"` (required)
- `overlay_id: string` — the overlay name
- `hook: "pre_task" | "post_task"`
- `workflow: { id, run_id }`
- `task: { id, phase?, requirement_ids?, acceptance_criteria?, scope_excluded? }`
- `artifacts?: { requirements_lock_path?, state_path?, outputs? }` — supplied by pre-task hook
- `result?: { outputs?, handover_state? }` — supplied by post-task hook
- `config?: Record<string, unknown>` — passthrough config from `remote_overlays[name].config`

**Output** (`OverlayInvokeOutput`) — validated by `OverlayInvokeOutputSchema` (see FR-002).

The `connect()` / `callTool()` / `disconnect()` lifecycle must be completed within a single
`invoke()` call in `McpOverlayProvider`. The wrapper must not be held open across multiple
overlay invocations; each invocation must create a fresh connection.

## Acceptance criteria

```gherkin
Feature: McpClientWrapper connection lifecycle and tool calls

  Scenario: Successful connect and tool call returns unwrapped response
    Given a McpClientWrapper configured with a valid stdio backend
    When connect() is called and then callTool("overlay.invoke", validInput) is called
    Then the wrapper returns the parsed response value
    And the MCP SDK content envelope is unwrapped before the return
    And no MCP SDK types appear in the return type

  Scenario: callTool before connect throws McpNotConnectedError
    Given a McpClientWrapper that has not had connect() called
    When callTool is invoked
    Then it throws McpNotConnectedError
    And the error message includes the backend id and instructs the caller to call connect() first

  Scenario: Tool call exceeding timeout_ms rejects with McpTimeoutError
    Given a McpClientWrapper with timeout_ms set to 100
    And a mock subprocess that never sends a response
    When callTool is called
    Then it rejects with McpTimeoutError within 150 ms
    And the error names the tool name and the timeout duration

  Scenario: SSE transport is rejected at construction time
    Given an OverlayBackendConfig with transport "sse"
    When McpClientWrapper is constructed
    Then it throws a TypeError naming "sse" as unsupported
    And the error message states that only "stdio" is supported in this release

  Scenario: disconnect is a no-op when not connected
    Given a McpClientWrapper that has not been connected
    When disconnect() is called
    Then it returns without error

  Scenario: Connection is closed after each invocation
    Given a McpClientWrapper that successfully completed a callTool invocation
    When the invocation is complete
    Then disconnect() is called (best-effort)
    And subsequent callTool calls throw McpNotConnectedError
```

## Related
- FR: FR-001 (McpOverlayProvider uses this wrapper), FR-002 (raw response is passed to Zod validation after callTool returns), FR-008 (McpTimeoutError is Tier 1; McpSchemaError is Tier 2), FR-009 (connecting/connected events emitted during lifecycle)
- NFR: NFR-001 (timeout enforcement), NFR-004 (uses @modelcontextprotocol/sdk already in project)
- Depends on: FR-001 (OverlayProvider interface), FR-005 (ResolvedBackendConfig from config schema)
