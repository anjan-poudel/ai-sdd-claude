# T010 — Observability Events

## Metadata
- **ID**: T010
- **FR/NFR**: FR-009, NFR-003
- **Owner**: developer
- **Depends on**: T001, T004
- **Estimate**: S (<2h)

## Context

The observability event system in `src/observability/events.ts` defines Zod schemas for all known event types, and `ObservabilityEmitter` in `src/observability/emitter.ts` sanitizes all event payloads before emission.

`McpOverlayProvider` (T004) already calls `this.emitter.emit(...)` for remote overlay lifecycle events. This task ensures those event types have proper Zod schemas in `events.ts` and are listed in the `EventType` union in `src/types/index.ts` (which was partially done in T001's modifications).

Additionally, `emitter.ts`'s `getEventLevel()` method uses string pattern matching to determine log level. The method currently classifies events with `"failed"` in the name as `ERROR` and `"warning"` or `"rework"` as `WARN`. The new event `overlay.remote.failed` contains `"failed"`, so it maps to `ERROR` correctly. `overlay.remote.fallback` does NOT contain any of those patterns, so it will be classified as `INFO` by default. This must be fixed to map to `WARN`.

Secret redaction is already handled by `ObservabilityEmitter.emit()` via `this.sanitizer.sanitizeObject(data)`. No per-event changes are needed for secret redaction — the sanitizer is already applied to all payloads.

## Files to create/modify

- `src/observability/events.ts` — modify — add 6 new event Zod schemas for remote overlay lifecycle
- `src/observability/emitter.ts` — modify — update `getEventLevel()` to map `overlay.remote.fallback` to `"WARN"`
- `src/types/index.ts` — verify `EventType` includes all 6 new types (done in T001, verify here)
- `tests/observability/remote-overlay-events.test.ts` — create — schema + log level tests

## Implementation spec

### Modifications to `src/observability/events.ts`

Add these six schemas after the existing `SecurityViolationEvent` schema:

```typescript
export const OverlayRemoteConnectingEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.connecting"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    task_id: z.string(),
    workflow_id: z.string(),
    run_id: z.string(),
  }).passthrough(),
});

export const OverlayRemoteConnectedEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.connected"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    task_id: z.string(),
    duration_ms: z.number(),
  }).passthrough(),
});

export const OverlayRemoteInvokedEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.invoked"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
  }).passthrough(),
});

export const OverlayRemoteDecisionEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.decision"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
    verdict: z.enum(["PASS", "REWORK", "FAIL", "HIL"]),
    duration_ms: z.number(),
  }).passthrough(),
});

export const OverlayRemoteFailedEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.failed"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
    failure_tier: z.enum(["transport", "schema"]),
    error_message: z.string(),
    duration_ms: z.number(),
  }).passthrough(),
});

export const OverlayRemoteFallbackEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.fallback"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
    failure_policy: z.enum(["skip", "warn"]),
  }).passthrough(),
});
```

Note: `OverlayRemoteFallbackEvent.data.failure_policy` is `z.enum(["skip", "warn"])` — `"fail_closed"` is not a valid fallback policy because `fail_closed` does not produce a fallback.

### Modifications to `src/observability/emitter.ts`

Update `getEventLevel()` to handle remote overlay events explicitly:

```typescript
private getEventLevel(type: string): ObservabilityLogLevel {
  if (type.includes("failed") || type.includes("violation")) return "ERROR";
  if (type.includes("warning") || type.includes("rework")) return "WARN";
  if (type === "overlay.remote.fallback") return "WARN";   // ← ADD THIS LINE
  return "INFO";
}
```

The explicit check must come before the generic string pattern matches, or the generic `return "INFO"` fallback would incorrectly classify `overlay.remote.fallback` as INFO.

### Verification of `src/types/index.ts` (done in T001)

Confirm that `EventType` in `src/types/index.ts` already includes these six types from T001:
```typescript
| "overlay.remote.connecting"
| "overlay.remote.connected"
| "overlay.remote.invoked"
| "overlay.remote.decision"
| "overlay.remote.failed"
| "overlay.remote.fallback"
```

If T001 was not yet complete when this task is implemented, add them here.

## Tests to write

**File**: `tests/observability/remote-overlay-events.test.ts`

Required test cases:

**Schema tests:**
1. `OverlayRemoteConnectingEvent` schema validates a correct payload — `safeParse` returns success
2. `OverlayRemoteConnectedEvent` schema validates with `duration_ms` field
3. `OverlayRemoteFailedEvent` schema validates both `failure_tier: "transport"` and `failure_tier: "schema"`
4. `OverlayRemoteFallbackEvent` schema accepts `failure_policy: "warn"` and `failure_policy: "skip"`
5. `OverlayRemoteFallbackEvent` rejects `failure_policy: "fail_closed"` — `safeParse` returns `success: false` (error messages are contracts — CLAUDE.md §5)
6. `OverlayRemoteDecisionEvent` schema validates all four verdict values

**Log level tests:**
7. `getEventLevel("overlay.remote.failed")` returns `"ERROR"` (string includes "failed")
8. `getEventLevel("overlay.remote.fallback")` returns `"WARN"` (explicit check required)
9. `getEventLevel("overlay.remote.decision")` returns `"INFO"` (no special pattern)
10. `getEventLevel("overlay.remote.connecting")` returns `"INFO"`

**Secret redaction integration test (CLAUDE.md §5 — error messages are contracts):**
11. Emit an `overlay.remote.invoked` event with data containing a field matching the OPENAI_KEY pattern (`sk-` prefix + 48 chars). Capture the event via `emitter.on(handler)`. Assert the captured event's data does NOT contain the raw secret value. Assert it contains `"[REDACTED:OPENAI_KEY]"` instead.

**Event payload minimums:**
12. `overlay.remote.failed` event includes `overlay_name`, `backend_id`, `task_id`, `failure_tier`, `error_message`, `duration_ms` — all required fields present in a sample emission

## Acceptance criteria

- [ ] `src/observability/events.ts` exports all 6 new event schemas
- [ ] `OverlayRemoteFallbackEvent.data.failure_policy` rejects `"fail_closed"`
- [ ] `OverlayRemoteFailedEvent.data.failure_tier` accepts both `"transport"` and `"schema"`
- [ ] `emitter.ts` `getEventLevel("overlay.remote.fallback")` returns `"WARN"`
- [ ] `emitter.ts` `getEventLevel("overlay.remote.failed")` returns `"ERROR"`
- [ ] `EventType` in `src/types/index.ts` includes all 6 new types
- [ ] Secret redaction via `sanitizer.sanitizeObject` is applied to all event data (existing emitter behavior — verify it covers new event types)
- [ ] `bun run typecheck` exits 0
- [ ] All existing 177 tests still pass
