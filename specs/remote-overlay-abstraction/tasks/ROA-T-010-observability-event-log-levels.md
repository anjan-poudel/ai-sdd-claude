# ROA-T-010: Observability Event Log Levels (`src/observability/emitter.ts`)

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Component J — `src/types/index.ts` (EventType additions), `src/observability/emitter.ts`
- **Effort:** S
- **Risk:** LOW
- **Depends on:** ROA-T-001
- **Blocks:** ROA-T-011
- **Requirements:** FR-009, NFR-003
- **Status:** COMPLETE — EventType additions and log levels are implemented

## Description

Add the six new `overlay.remote.*` event types to the `EventType` string union in
`src/types/index.ts` and configure their log level assignments in
`ObservabilityEmitter.getEventLevel()` in `src/observability/emitter.ts`:

| Event | Level |
|-------|-------|
| `overlay.remote.failed` | `ERROR` |
| `overlay.remote.fallback` | `WARN` |
| `overlay.remote.connecting` | `INFO` |
| `overlay.remote.connected` | `INFO` |
| `overlay.remote.invoked` | `INFO` |
| `overlay.remote.decision` | `INFO` |

All event payloads pass through `sanitizer.sanitizeObject(data)` in `emitter.emit()`
before any handler or log line receives them. Config passthrough values matching
registered secret patterns are replaced with `"[REDACTED]"`.

## Files to create/modify

| File | Action |
|------|--------|
| `src/types/index.ts` | Modify — add six `overlay.remote.*` values to `EventType` union |
| `src/observability/emitter.ts` | Modify — add log level assignments for new event types |

## Acceptance criteria

```gherkin
Feature: Remote overlay observability event log levels

  Scenario: overlay.remote.failed is assigned ERROR level
    Given an ObservabilityEmitter instance
    When getEventLevel("overlay.remote.failed") is called
    Then it returns "ERROR"

  Scenario: overlay.remote.fallback is assigned WARN level
    Given an ObservabilityEmitter instance
    When getEventLevel("overlay.remote.fallback") is called
    Then it returns "WARN"

  Scenario: Four INFO events are assigned INFO level
    Given an ObservabilityEmitter instance
    When getEventLevel is called for each of connecting, connected, invoked, decision
    Then each returns "INFO"

  Scenario: Secret value in emitted event payload is redacted
    Given an emitter with a registered secret pattern matching "TOKEN-12345"
    When emit("overlay.remote.invoked", { config: { token: "TOKEN-12345" } }) is called
    Then the received payload contains "[REDACTED]" not "TOKEN-12345"

  Scenario: overlay.remote.failed is written to ERROR-level output
    Given an ObservabilityEmitter configured at INFO level
    When an overlay.remote.failed event is emitted
    Then the event appears in ERROR output (stderr)
```

## Implementation notes

- `overlay.remote.failed` → matched by `type.includes("failed")` in `getEventLevel()`.
- `overlay.remote.fallback` → matched by explicit `type === "overlay.remote.fallback"` check.
- All six event types must be valid `EventType` values so TypeScript catches typos at
  compile time in `McpOverlayProvider.emit()` calls.
- The secret redaction path is the existing `sanitizer.sanitizeObject(data)` call inside
  `emitter.emit()`. No changes to `sanitizer.ts` are required for this task.

## Definition of done

- [ ] Code reviewed and merged
- [ ] Log level tests in `tests/observability/` (extended)
- [ ] Secret redaction test in `tests/overlays/mcp/mcp-overlay-provider.test.ts` (existing)
- [ ] `bun run typecheck` passes — EventType string union is exhaustive
- [ ] `bun test` shows all 505+ existing tests still pass
