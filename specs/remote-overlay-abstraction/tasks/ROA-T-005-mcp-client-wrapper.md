# ROA-T-005: McpClientWrapper (`src/overlays/mcp/mcp-client.ts`)

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Component E — `src/overlays/mcp/mcp-client.ts`
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** ROA-T-001, ROA-T-003
- **Blocks:** ROA-T-006
- **Requirements:** FR-003, NFR-001, NFR-004
- **Status:** COMPLETE — file exists; JSDoc gap for McpSchemaError needs addressing (L3 recommendation)

## Description

Implement `McpClientWrapper` to encapsulate the full MCP stdio connection lifecycle.
All `@modelcontextprotocol/sdk` imports are confined to this file. Callers receive
plain TypeScript values; no SDK types leak through the public API.

Per-invocation connection model (ADR-002): a fresh connection is created for every
overlay invocation. `McpClientWrapper` is not held open across multiple calls.

Three named error classes must be defined:
- `McpTimeoutError(toolName, timeoutMs)` — thrown when `callTool` exceeds `timeout_ms`
- `McpNotConnectedError(backendId)` — thrown when `callTool` is called before `connect()`
- `McpSchemaError(message)` — reserved for future use; not raised in this release

The `McpSchemaError` class must carry a JSDoc comment marking its reserved status
(L3 recommendation from review-l2 Finding 3).

## Files to create/modify

| File | Action |
|------|--------|
| `src/overlays/mcp/mcp-client.ts` | Create (contains McpClientWrapper + three error classes) |
| `tests/overlays/mcp/fixtures/mcp-call-tool-result.json` | Create — captured SDK fixture (Development Standards §4) |

## Acceptance criteria

```gherkin
Feature: McpClientWrapper connection lifecycle and tool calls

  Scenario: SSE transport is rejected at construction time
    Given a backend config with transport "sse"
    When McpClientWrapper is constructed
    Then it throws a TypeError naming "sse" as unsupported
    And the error message states only "stdio" is supported in this release

  Scenario: callTool before connect throws McpNotConnectedError
    Given a McpClientWrapper that has not had connect() called
    When callTool is invoked
    Then it throws McpNotConnectedError
    And the error message includes the backend id

  Scenario: Tool call exceeding timeout_ms rejects with McpTimeoutError
    Given a McpClientWrapper with timeout_ms set to 100
    And a mock client that never responds
    When callTool is called
    Then it rejects within 150 ms
    And the error is McpTimeoutError naming the tool name and timeout duration

  Scenario: disconnect is a no-op when not connected
    Given a McpClientWrapper that has not been connected
    When disconnect() is called
    Then it returns without error

  Scenario: SDK content envelope is unwrapped before return
    Given a mock client that returns content[0].type "text" with JSON text
    When callTool is called
    Then the returned value is the parsed JSON object
    And the content array is not visible in the return value

  Scenario: External SDK fixture validates unwrapping logic
    Given the captured mcp-call-tool-result.json fixture
    When callTool processes the fixture sample_response
    Then the result equals fixture.expected_unwrapped
```

## Implementation notes

- Timeout enforcement: `Promise.race([callPromise, setTimeout(reject, timeout_ms)])`.
  Accuracy must be within `timeout_ms + 50ms` (NFR-001).
- `McpSchemaError` JSDoc (L3 recommendation — review-l2 Finding 3):
  ```typescript
  /** Reserved for future use. Not raised in this release. */
  export class McpSchemaError extends Error { ... }
  ```
- External SDK fixture (Development Standards §4): capture the real
  `@modelcontextprotocol/sdk@^1.0.4` `CallToolResult` structure in
  `tests/overlays/mcp/fixtures/mcp-call-tool-result.json`. Fields: `sdk_version`,
  `sample_response`, `expected_unwrapped`. This prevents SDK schema drift.
- No SDK type in return type or throw type. All thrown errors must be one of the
  three named classes or a plain `Error`.
- `env` merge: `{ ...process.env, ...config.env }` — remote process inherits existing env.

## Definition of done

- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests in `tests/overlays/mcp/mcp-client.test.ts`
- [ ] `tests/overlays/mcp/fixtures/mcp-call-tool-result.json` committed with real SDK shape
- [ ] `McpSchemaError` carries `/** Reserved for future use. Not raised in this release. */` JSDoc
- [ ] Static check: no `eval()` in `src/overlays/mcp/mcp-client.ts` (NFR-003)
- [ ] `bun test` shows all 505+ existing tests still pass
