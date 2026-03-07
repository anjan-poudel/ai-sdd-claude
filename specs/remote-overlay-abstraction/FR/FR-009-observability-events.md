# FR-009: Observability Events

## Metadata
- **Area:** Observability
- **Priority:** MUST
- **Source:** REMOTE-OVERLAY-PLAN.md §6, §9 (ROA-018); constitution.md Deliverables

## Description

The system must emit structured observability events for the full lifecycle of remote overlay invocations. These events must be routed through the existing event emitter in `src/observability/` and must follow the same structure as existing observability events in the codebase.

The following events must be emitted:

| Event name | When emitted | Required payload fields |
|------------|-------------|------------------------|
| `overlay.remote.connecting` | Before the MCP connection is initiated | `overlay_name`, `backend_id`, `task_id`, `workflow_id`, `run_id`, `timestamp` |
| `overlay.remote.connected` | After a successful MCP connection | `overlay_name`, `backend_id`, `task_id`, `workflow_id`, `run_id`, `timestamp`, `duration_ms` |
| `overlay.remote.invoked` | After `callTool` / CLI spawn is called | `overlay_name`, `backend_id`, `hook`, `task_id`, `workflow_id`, `run_id`, `timestamp` |
| `overlay.remote.decision` | After a valid `OverlayDecision` is received | `overlay_name`, `backend_id`, `hook`, `task_id`, `workflow_id`, `run_id`, `verdict`, `timestamp`, `duration_ms` |
| `overlay.remote.failed` | On any remote failure (transport or schema) | `overlay_name`, `backend_id`, `hook`, `task_id`, `workflow_id`, `run_id`, `failure_tier` (`"transport"` or `"schema"`), `error_message`, `timestamp`, `duration_ms` |
| `overlay.remote.fallback` | When a transport failure triggers skip or warn policy | `overlay_name`, `backend_id`, `hook`, `task_id`, `workflow_id`, `run_id`, `failure_policy`, `timestamp` |

All events must include `overlay_name`, `backend_id`, `task_id`, and `timestamp` at minimum. The `duration_ms` field must measure wall-clock time from the start of the provider invocation to the point of event emission.

Events must be emitted whether the overlay is a `CliOverlayProvider` or `McpOverlayProvider`. The event names and payload shapes are identical across both runtimes; the `backend_id` field identifies which backend was used.

The log sanitizer (`src/observability/`) must be applied to all event payloads before emission. In particular, any `config` passthrough values that match secret patterns must be redacted before appearing in events.

## Acceptance Criteria

```gherkin
Feature: Remote overlay observability events

  Scenario: Successful MCP invocation emits lifecycle events in order
    Given a configured remote overlay backed by a mock MCP server
    When the provider is invoked for a pre_task hook
    Then the following events are emitted in order:
      1. overlay.remote.connecting
      2. overlay.remote.connected
      3. overlay.remote.invoked
      4. overlay.remote.decision
    And each event includes overlay_name, backend_id, and task_id

  Scenario: overlay.remote.decision includes verdict and duration_ms
    Given a mock MCP server that returns verdict REWORK
    When the provider receives the response
    Then the overlay.remote.decision event has verdict "REWORK"
    And the event has a duration_ms greater than 0

  Scenario: Transport failure emits overlay.remote.failed with failure_tier transport
    Given a remote backend that times out
    When the provider handles the timeout
    Then an overlay.remote.failed event is emitted
    And the event has failure_tier "transport"
    And the event includes error_message, duration_ms, overlay_name, and backend_id

  Scenario: Schema violation emits overlay.remote.failed with failure_tier schema
    Given a remote backend that returns invalid JSON
    When the provider handles the parse failure
    Then an overlay.remote.failed event is emitted
    And the event has failure_tier "schema"

  Scenario: Warn and skip policies emit overlay.remote.fallback
    Given a remote backend with failure_policy "warn" that times out
    When the provider applies the fallback policy
    Then an overlay.remote.fallback event is emitted
    And the event includes the failure_policy field set to "warn"

  Scenario: Secret values in config passthrough are redacted from events
    Given a remote overlay config with a passthrough field containing a value that matches a secret pattern
    When an observability event is emitted for that invocation
    Then the secret value is replaced with "[REDACTED]" in the event payload
    And the original value does not appear in any log output
```

## Related
- FR: FR-008 (failure events are emitted there), FR-003 (connecting/connected events are emitted from McpClientWrapper)
- NFR: NFR-003 (secret redaction in events)
- Depends on: FR-001, FR-002, FR-003, FR-008
