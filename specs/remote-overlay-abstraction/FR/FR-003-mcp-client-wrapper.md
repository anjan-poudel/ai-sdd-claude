# FR-003: MCP Client Wrapper

## Metadata
- **Area:** MCP Transport
- **Priority:** MUST
- **Source:** REMOTE-OVERLAY-PLAN.md §2.6, §4; constitution.md Deliverables

## Description

The system must provide a `McpClientWrapper` class at `src/overlays/mcp/mcp-client.ts` that encapsulates the connection lifecycle and tool-call mechanics for a single remote MCP backend. `McpOverlayProvider` must delegate all MCP communication to this wrapper; no MCP SDK calls may appear in the provider itself.

The wrapper must:

1. Accept a backend configuration of type `OverlayBackendConfig` (runtime `"mcp"`) at construction time.
2. Expose a `connect()` method that establishes the stdio transport connection using `@modelcontextprotocol/sdk`.
3. Expose a `disconnect()` method that cleanly closes the connection.
4. Expose a `callTool(toolName: string, input: unknown): Promise<unknown>` method that sends an MCP tool call and returns the raw response.
5. Enforce a per-call timeout equal to `config.timeout_ms` (default 5000 ms). A call that exceeds the timeout must reject with a `McpTimeoutError`.
6. Not expose any MCP SDK types in its public API; callers receive plain TypeScript values.
7. Be safe to construct before connecting; calling `callTool` before `connect` must throw a `McpNotConnectedError` with an actionable message.

The wrapper must not implement retry logic itself; retry decisions belong to the failure-handling layer in `McpOverlayProvider` and `CliOverlayProvider`.

The connection transport must be `stdio` only in this release. SSE and HTTP transports are out of scope.

## Acceptance Criteria

```gherkin
Feature: McpClientWrapper connection lifecycle

  Scenario: Successful connect and tool call
    Given a McpClientWrapper configured with a valid stdio backend
    When connect() is called and succeeds
    And callTool("overlay.invoke", validInput) is called
    Then the wrapper returns the raw response from the MCP server
    And no MCP SDK types leak into the return value

  Scenario: Tool call before connect throws McpNotConnectedError
    Given a McpClientWrapper that has not been connected
    When callTool is called
    Then it throws McpNotConnectedError
    And the error message instructs the caller to call connect() first

  Scenario: Tool call timeout rejects with McpTimeoutError
    Given a McpClientWrapper with timeout_ms set to 100
    And a mock MCP server that never responds
    When callTool is called
    Then it rejects with McpTimeoutError after 100 ms (±20 ms tolerance)

  Scenario: disconnect() after tool call succeeds
    Given a connected McpClientWrapper that has completed a tool call
    When disconnect() is called
    Then the connection closes without error
    And subsequent callTool calls throw McpNotConnectedError

  Scenario: SSE transport configuration is rejected at construction
    Given an OverlayBackendConfig with transport set to "sse"
    When McpClientWrapper is constructed
    Then it throws a configuration error naming "sse" as unsupported
```

## Related
- FR: FR-004 (provider chain composition uses McpOverlayProvider which uses this)
- NFR: NFR-001 (timeout enforced here), NFR-002 (connection error classified here)
- Depends on: FR-001 (OverlayProvider interface), FR-002 (OverlayDecision — McpOverlayProvider uses the wrapper to obtain raw responses then validates them)
