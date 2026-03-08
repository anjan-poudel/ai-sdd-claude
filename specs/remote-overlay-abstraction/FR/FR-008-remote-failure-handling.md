# FR-008: Remote Failure Handling Modes

## Metadata
- **Area:** Reliability / Error Handling
- **Priority:** MUST
- **Source:** constitution.md — Quality Attributes; `src/overlays/mcp/mcp-overlay-provider.ts` (two-tier model, effectivePolicy calculation)

## Description

`McpOverlayProvider` must implement a two-tier failure model that distinguishes failures by
cause. The two tiers have different applicability for the `failure_policy` config field.

### Tier 1: Transport errors (policy-governed)

A transport error is any failure before a valid response is received from the remote server.
This includes:
- Connection timeout: call duration exceeds `config.timeout_ms`
- Connection refused or subprocess spawn failure
- Process crash: unexpected process exit with no response
- MCP protocol connection drop before a response is sent

The behavior on a Tier 1 error is governed by the `failure_policy` field on the backend config:

| `failure_policy` | Behavior |
|------------------|----------|
| `skip` | Return `OverlayDecision { verdict: "PASS" }` without emitting a failure event |
| `warn` | Return `OverlayDecision { verdict: "PASS" }` and emit `overlay.remote.failed` + `overlay.remote.fallback` events |
| `fail_closed` | Return `OverlayDecision { verdict: "FAIL" }` with the transport error message |

Default `failure_policy` when omitted from config: `"warn"`.

### Tier 2: Schema violations (always fail_closed)

A schema violation is a failure in the content of the response, even when the transport
succeeded. This includes:
- The JSON response fails `OverlayInvokeOutputSchema` Zod validation
- The `verdict` field contains an unrecognized value (e.g., `"FORCE_ACCEPT"`)
- Required fields (`protocol_version`, `verdict`) are absent
- The `protocol_version` value is not `"1"` (the `z.literal("1")` constraint)
- The response body is not parseable as JSON

Schema violations must always return `OverlayDecision { verdict: "FAIL" }`. The configured
`failure_policy` must never override this. This is the no-mutation safety guarantee: a corrupt
or rogue remote overlay cannot pass governance checks by returning malformed data.

### `blocking` field interaction

When a remote overlay is configured with `blocking: false`, any Tier 1 transport error must
behave as `failure_policy: "warn"` regardless of the backend's configured `failure_policy`.
The `McpOverlayProvider` must compute an effective policy before the transport call:

```
effectivePolicy = (overlayConfig.blocking === false) ? "warn" : backendConfig.failure_policy
```

Tier 2 schema violations are not affected by `blocking: false` — they always fail_closed.

### Cleanup semantics

After any error (Tier 1 or Tier 2), `McpClientWrapper.disconnect()` must be called as a
best-effort cleanup. Errors from `disconnect()` must be swallowed (`catch(() => {})`) and must
not replace or mask the original error.

### Implementation separation

The Tier 1 `catch` block must handle transport errors (connection refused, timeout, process
crash). The Tier 2 validation step must run after the transport succeeds, on the raw response.
These must be separate code paths — not a single monolithic catch block that handles both
tiers with the same logic.

## Acceptance criteria

```gherkin
Feature: Remote overlay failure handling

  Scenario: Transport timeout with failure_policy "warn" returns PASS and emits events
    Given a backend with timeout_ms 100 and failure_policy "warn"
    And the remote process does not respond within 100 ms
    When McpOverlayProvider invokes the overlay
    Then the returned OverlayDecision has verdict "PASS"
    And an overlay.remote.failed event is emitted with failure_tier "transport"
    And an overlay.remote.fallback event is emitted with failure_policy "warn"

  Scenario: Transport timeout with failure_policy "fail_closed" returns FAIL
    Given a backend with failure_policy "fail_closed"
    And the remote process times out
    When McpOverlayProvider invokes the overlay
    Then the returned OverlayDecision has verdict "FAIL"
    And the feedback message contains the transport error description

  Scenario: Transport timeout with failure_policy "skip" returns PASS silently
    Given a backend with failure_policy "skip"
    And the remote process times out
    When McpOverlayProvider invokes the overlay
    Then the returned OverlayDecision has verdict "PASS"
    And no overlay.remote.failed event is emitted

  Scenario: Schema violation always returns FAIL regardless of failure_policy "skip"
    Given a backend with failure_policy "skip"
    And the remote process returns a response that fails Zod validation
    When McpOverlayProvider processes the response
    Then the returned OverlayDecision has verdict "FAIL"
    And an overlay.remote.failed event is emitted with failure_tier "schema"

  Scenario: Schema violation always returns FAIL regardless of failure_policy "warn"
    Given a backend with failure_policy "warn"
    And the remote process returns a response with verdict "APPROVE"
    When Zod validation runs
    Then the returned OverlayDecision has verdict "FAIL"

  Scenario: blocking false overrides fail_closed for transport errors
    Given a remote overlay with blocking: false
    And the backend has failure_policy "fail_closed"
    And the remote process times out
    When McpOverlayProvider invokes the overlay
    Then the effective policy is "warn"
    And the returned OverlayDecision has verdict "PASS"

  Scenario: blocking false does not override fail_closed for schema violations
    Given a remote overlay with blocking: false
    And the remote process returns an invalid schema response
    When McpOverlayProvider processes the response
    Then the returned OverlayDecision has verdict "FAIL"

  Scenario: Valid verdict from remote is always propagated regardless of policy
    Given a backend with any failure_policy
    And the remote process returns a valid response with verdict "REWORK"
    When McpOverlayProvider processes the response
    Then the returned OverlayDecision has verdict "REWORK"

  Scenario: Disconnect is called after transport error
    Given a backend that raises a connection refused error
    When McpOverlayProvider handles the error
    Then disconnect() is called on the McpClientWrapper
    And any error from disconnect() is swallowed without masking the original error
```

## Related
- FR: FR-002 (Zod validation is the Tier 2 enforcement), FR-003 (McpTimeoutError raised in McpClientWrapper is caught here), FR-009 (observability events emitted in both tiers)
- NFR: NFR-002 (deterministic outcome on all failure paths), NFR-003 (schema as injection guard)
- Depends on: FR-001, FR-002, FR-003, FR-005 (failure_policy and blocking from config)
