# FR-009: Observability Events for Remote Overlay Lifecycle

## Metadata
- **Area:** Observability
- **Priority:** MUST
- **Source:** constitution.md — Deliverables; `src/types/index.ts` (EventType union); `src/observability/emitter.ts` (ObservabilityEmitter); `src/overlays/mcp/mcp-overlay-provider.ts` (emission call sites)

## Description

The system must emit structured observability events at each stage of a remote overlay
invocation. Events must use the existing `ObservabilityEmitter` in `src/observability/` and
must follow the same `{ type, run_id, workflow_id, timestamp, data }` envelope used by all
other framework events.

### Required events

All six event types must be added to the `EventType` string union in `src/types/index.ts`.

| Event type | When emitted | Minimum required payload fields |
|------------|-------------|--------------------------------|
| `overlay.remote.connecting` | Before MCP connection is initiated | `overlay_name`, `backend_id`, `task_id`, `workflow_id`, `run_id` |
| `overlay.remote.connected` | After successful MCP connection | `overlay_name`, `backend_id`, `task_id`, `workflow_id`, `run_id`, `duration_ms` |
| `overlay.remote.invoked` | After `callTool` is called | `overlay_name`, `backend_id`, `hook`, `task_id` |
| `overlay.remote.decision` | After a valid OverlayDecision is received | `overlay_name`, `backend_id`, `hook`, `task_id`, `verdict`, `duration_ms` |
| `overlay.remote.failed` | On Tier 1 transport error or Tier 2 schema violation | `overlay_name`, `backend_id`, `hook`, `task_id`, `failure_tier`, `error_message`, `duration_ms` |
| `overlay.remote.fallback` | When a transport failure is handled by `skip` or `warn` policy | `overlay_name`, `backend_id`, `hook`, `task_id`, `failure_policy` |

The `failure_tier` field in `overlay.remote.failed` must be either `"transport"` or `"schema"`.
This allows log consumers to distinguish connection failures from malformed response failures
without parsing the `error_message` string.

### Log level assignment

The `ObservabilityEmitter.getEventLevel` method must classify these events as follows:

- `overlay.remote.failed` — `ERROR`
- `overlay.remote.fallback` — `WARN`
- `overlay.remote.connecting`, `overlay.remote.connected`, `overlay.remote.invoked`, `overlay.remote.decision` — `INFO`

### `duration_ms` measurement

The `duration_ms` field where required must measure wall-clock time from the start of the
provider's `invoke()` method call to the point of event emission. For `overlay.remote.connected`,
it measures the connect duration only. For `overlay.remote.decision` and `overlay.remote.failed`,
it measures the full invocation duration including connection time.

### Secret redaction

All event payloads must pass through the existing log sanitizer
(`src/observability/sanitizer.ts`) before emission. In particular, any value in the
`config` passthrough that matches a registered secret pattern must be replaced with
`"[REDACTED]"` before the event is emitted. The literal secret value must not appear in any
event payload or console log line.

## Acceptance criteria

```gherkin
Feature: Remote overlay observability events

  Scenario: Successful invocation emits lifecycle events in order
    Given a configured remote overlay backed by a mock MCP server that returns PASS
    When the provider is invoked for a pre_task hook
    Then the following events are emitted in this order:
      1. overlay.remote.connecting
      2. overlay.remote.connected
      3. overlay.remote.invoked
      4. overlay.remote.decision
    And each event includes overlay_name, backend_id, and task_id

  Scenario: overlay.remote.decision includes verdict and positive duration_ms
    Given a mock MCP server that returns verdict "REWORK"
    When the provider receives the response
    Then the overlay.remote.decision event has verdict "REWORK"
    And the event has duration_ms greater than 0

  Scenario: Transport failure emits overlay.remote.failed with failure_tier "transport"
    Given a remote backend that raises a connection timeout
    When the provider handles the error
    Then an overlay.remote.failed event is emitted
    And the event has failure_tier "transport"
    And the event includes error_message and duration_ms

  Scenario: Schema violation emits overlay.remote.failed with failure_tier "schema"
    Given a remote backend that returns an invalid JSON payload
    When Zod validation fails
    Then an overlay.remote.failed event is emitted
    And the event has failure_tier "schema"

  Scenario: Fallback policy emits overlay.remote.fallback
    Given a remote backend with failure_policy "warn" that times out
    When the provider applies the warn fallback
    Then an overlay.remote.fallback event is emitted
    And the event has failure_policy "warn"

  Scenario: overlay.remote.fallback is also emitted for skip policy
    Given a remote backend with failure_policy "skip" that times out
    When the provider applies the skip fallback
    Then an overlay.remote.fallback event is emitted
    And the event has failure_policy "skip"

  Scenario: Secret value in config passthrough is redacted in events
    Given a remote overlay config passthrough with a field matching a secret pattern
    When an overlay.remote.invoked event is emitted
    Then the event payload contains "[REDACTED]" in place of the secret value
    And the literal secret value does not appear in any emitted event or console output

  Scenario: Event log level for failed events is ERROR
    Given an ObservabilityEmitter configured at INFO level
    When an overlay.remote.failed event is emitted
    Then the event is written to stderr (ERROR level output)

  Scenario: Event log level for fallback events is WARN
    Given an ObservabilityEmitter configured at INFO level
    When an overlay.remote.fallback event is emitted
    Then the event is written to stderr (WARN level output)
```

## Related
- FR: FR-003 (connecting/connected events emitted from McpOverlayProvider during lifecycle), FR-008 (failed/fallback events emitted per failure tier)
- NFR: NFR-003 (secret redaction), NFR-002 (emitter must not throw on handler errors)
- Depends on: FR-001, FR-002, FR-003, FR-008
