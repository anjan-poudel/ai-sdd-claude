# ROA-T-006: McpOverlayProvider (`src/overlays/mcp/mcp-overlay-provider.ts`)

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Component F — `src/overlays/mcp/mcp-overlay-provider.ts`
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** ROA-T-001, ROA-T-003, ROA-T-005
- **Blocks:** ROA-T-007
- **Requirements:** FR-001, FR-002, FR-003, FR-008, FR-009, NFR-002, NFR-003
- **Status:** COMPLETE — file exists; skip-policy event assertion gap needs addressing (L3 recommendation)

## Description

Implement `McpOverlayProvider` to satisfy `OverlayProvider` for MCP backends. Delegates
all SDK communication to `McpClientWrapper` via an injectable `clientFactory`. Validates
responses with `OverlayInvokeOutputSchema`. Applies the two-tier failure model.

The two-tier failure model is the central logic:
- **Tier 1 (transport errors)**: any exception thrown before a valid response. Governed
  by `effectivePolicy = blocking === false ? "warn" : backendConfig.failure_policy`.
  - `skip`: return `PASS`; emit `overlay.remote.fallback` only (no `overlay.remote.failed`)
  - `warn`: return `PASS`; emit `overlay.remote.failed` + `overlay.remote.fallback`
  - `fail_closed`: return `FAIL`
- **Tier 2 (schema violations)**: always return `FAIL`; emit `overlay.remote.failed`
  with `failure_tier: "schema"`. Never emit `overlay.remote.fallback` for Tier 2.

The Tier 1 and Tier 2 paths must be separate code paths — not a single catch block.

`disconnect()` is called best-effort (`.catch(() => {})`) in both Tier 1 catch and the
`finally` block for the success path. Disconnect errors are swallowed.

The `overlay.remote.invoked` event must clarify in its implementation comment that it is
emitted after `callTool()` is called but before the response is received — meaning the
invocation is in-flight at the time of emission (L3 recommendation from review-l2 Finding 2).

## Files to create/modify

| File | Action |
|------|--------|
| `src/overlays/mcp/mcp-overlay-provider.ts` | Create |

## Acceptance criteria

```gherkin
Feature: McpOverlayProvider two-tier failure model

  Scenario: Valid REWORK verdict is mapped to OverlayDecision correctly
    Given a mock client that returns protocol_version "1" and verdict "REWORK"
    When McpOverlayProvider.invokePre is called
    Then the returned OverlayDecision has verdict "REWORK"
    And evidence.source equals "mcp"

  Scenario: Transport timeout with failure_policy "warn" returns PASS and emits both events
    Given a backend with failure_policy "warn" and a mock client that throws on connect
    When McpOverlayProvider invokes the overlay
    Then the returned OverlayDecision has verdict "PASS"
    And an overlay.remote.failed event is emitted with failure_tier "transport"
    And an overlay.remote.fallback event is emitted with failure_policy "warn"

  Scenario: Transport timeout with failure_policy "skip" returns PASS — no overlay.remote.failed
    Given a backend with failure_policy "skip" and a mock client that throws on connect
    When McpOverlayProvider invokes the overlay
    Then the returned OverlayDecision has verdict "PASS"
    And an overlay.remote.fallback event IS emitted with failure_policy "skip"
    And NO overlay.remote.failed event is emitted

  Scenario: Transport timeout with failure_policy "fail_closed" returns FAIL
    Given a backend with failure_policy "fail_closed" and a mock client that throws on connect
    When McpOverlayProvider invokes the overlay
    Then the returned OverlayDecision has verdict "FAIL"

  Scenario: Schema violation always returns FAIL regardless of failure_policy
    Given a backend with failure_policy "skip"
    And the mock client returns a response that fails Zod validation
    When McpOverlayProvider processes the response
    Then the returned OverlayDecision has verdict "FAIL"
    And an overlay.remote.failed event is emitted with failure_tier "schema"
    And no overlay.remote.fallback event is emitted

  Scenario: blocking false overrides fail_closed for transport errors only
    Given a remote overlay with blocking: false and failure_policy "fail_closed"
    And the mock client throws a transport error
    When McpOverlayProvider invokes the overlay
    Then the effective policy is "warn"
    And the returned OverlayDecision has verdict "PASS"

  Scenario: blocking false does not override schema violations
    Given a remote overlay with blocking: false
    And the mock client returns an invalid schema response
    When McpOverlayProvider processes the response
    Then the returned OverlayDecision has verdict "FAIL"

  Scenario: Secret value in config passthrough is redacted in emitted events
    Given a remote overlay config with a passthrough value matching a secret pattern
    When any observability event is emitted for that invocation
    Then the event payload contains "[REDACTED]" in place of the secret value
```

## Implementation notes

- `overlay.remote.invoked` implementation comment (L3 recommendation — review-l2 Finding 2):
  ```typescript
  // Emitted after callTool() is called — invocation is in-flight at this point.
  // The response has not been received yet.
  this.emitter.emit("overlay.remote.invoked", { ... });
  ```
- The `clientFactory` parameter (defaults to `(cfg) => new McpClientWrapper(cfg)`) allows
  injecting mock clients in tests. No subprocess is spawned in tests.
- Skip-policy event assertion (L3 recommendation — review-l2 highest priority): a dedicated
  test must assert both (a) `overlay.remote.fallback` IS emitted and (b) `overlay.remote.failed`
  is NOT emitted when `failure_policy: "skip"` and a transport error occurs. Test 7 in
  `tests/overlays/mcp/mcp-overlay-provider.test.ts` currently asserts (a) but not (b).
- Evidence: `mapToDecision()` sets `evidence.source = "mcp"`. If remote response includes
  `evidence.overlay_id`, that value is preserved; otherwise the local `overlayName` is used.

## Definition of done

- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests in `tests/overlays/mcp/mcp-overlay-provider.test.ts`
- [ ] Skip-policy test explicitly asserts `overlay.remote.failed` is NOT emitted (L3 recommendation)
- [ ] `overlay.remote.invoked` emit site has implementation comment describing in-flight semantics
- [ ] Static check: no `eval()` in `src/overlays/mcp/` (NFR-003)
- [ ] `bun test` shows all 505+ existing tests still pass
