# FR-008: Remote Failure Handling

## Metadata
- **Area:** Reliability / Error Handling
- **Priority:** MUST
- **Source:** REMOTE-OVERLAY-PLAN.md §2.7; remote-overlay-mcp-architecture-codex.md §2.7

## Description

The system must implement a two-tier failure model for remote overlay providers (`CliOverlayProvider` and `McpOverlayProvider`). The two tiers are distinguished by failure cause and have different policy applicability:

### Tier 1: Transport Errors (policy-governed)

Transport errors are failures in the communication channel between ai-sdd and the remote provider. They include:

- Connection timeout (call exceeds `timeout_ms`)
- Connection refused or process spawn failure
- Process crash (non-zero exit code with no stdout for CLI; connection drop for MCP)

The behavior on a transport error is governed by the `failure_policy` field on the backend config:

| `failure_policy` | Behavior on transport error |
|------------------|-----------------------------|
| `skip` | Return `OverlayDecision { verdict: "PASS" }` silently |
| `warn` | Return `OverlayDecision { verdict: "PASS" }` and emit `overlay.remote.failed` observability event |
| `fail_closed` | Return `OverlayDecision { verdict: "FAIL" }` — task transitions to FAILED |

Default `failure_policy` when omitted from config: `warn`.

### Tier 2: Schema Violations (always fail_closed)

Schema violations are failures in the content of the response, regardless of successful transport. They include:

- Response fails Zod schema validation
- `verdict` field contains an unrecognized value
- Required fields (`protocol_version`, `verdict`) are absent
- Response body is not valid JSON

Schema violations must always result in `OverlayDecision { verdict: "FAIL" }` and must never be overridden by the configured `failure_policy`. This is the no-mutation safety guarantee: a corrupted or rogue remote overlay cannot silently pass governance checks by returning malformed data.

### Separation at Implementation Level

The `CliOverlayProvider` and `McpOverlayProvider` must explicitly catch transport errors (Tier 1) and schema errors (Tier 2) in separate `catch` branches. The two branches must log different observability events and apply the appropriate policy independently.

### `blocking` field

When a remote overlay is configured with `blocking: false`, a Tier 1 transport error must always behave as `failure_policy: warn` regardless of the configured policy. A Tier 2 schema violation on a `blocking: false` overlay must still result in `FAIL` — the `blocking` field does not override schema safety.

## Acceptance Criteria

```gherkin
Feature: Remote overlay failure handling

  Scenario: Transport timeout with failure_policy warn returns PASS and emits event
    Given a remote overlay backend with timeout_ms 100 and failure_policy "warn"
    And the remote process does not respond within 100 ms
    When the provider invokes the overlay
    Then the returned OverlayDecision has verdict PASS
    And an overlay.remote.failed observability event is emitted
    And the event includes the backend_id, overlay_name, and duration_ms

  Scenario: Transport timeout with failure_policy fail_closed returns FAIL
    Given a remote overlay backend with failure_policy "fail_closed"
    And the remote process times out
    When the provider invokes the overlay
    Then the returned OverlayDecision has verdict FAIL

  Scenario: Transport timeout with failure_policy skip returns PASS silently
    Given a remote overlay backend with failure_policy "skip"
    And the remote process times out
    When the provider invokes the overlay
    Then the returned OverlayDecision has verdict PASS
    And no overlay.remote.failed event is emitted

  Scenario: Schema violation always returns FAIL regardless of failure_policy skip
    Given a remote overlay backend with failure_policy "skip"
    And the remote process returns an invalid JSON response
    When the provider attempts to parse the response
    Then the returned OverlayDecision has verdict FAIL
    And the failure reason identifies a schema violation

  Scenario: Schema violation always returns FAIL regardless of failure_policy warn
    Given a remote overlay backend with failure_policy "warn"
    And the remote process returns a response with unknown verdict "APPROVE"
    When Zod validation runs on the response
    Then the returned OverlayDecision has verdict FAIL

  Scenario: Valid REWORK verdict from remote is always propagated
    Given a remote overlay backend with any failure_policy
    And the remote process returns a valid response with verdict "REWORK"
    When the provider processes the response
    Then the returned OverlayDecision has verdict REWORK
    And failure_policy does not alter this outcome

  Scenario: blocking false does not override schema safety
    Given a remote overlay configured with blocking false
    And the remote process returns an invalid schema response
    When the provider processes the response
    Then the returned OverlayDecision has verdict FAIL
```

## Related
- FR: FR-002 (schema validation is Tier 2), FR-009 (observability events emitted here)
- NFR: NFR-002 (reliability — fail_closed prevents silent pass), NFR-003 (security — schema enforced)
- Depends on: FR-001, FR-002, FR-003, FR-005 (failure_policy from config)
