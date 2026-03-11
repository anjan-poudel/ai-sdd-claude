---
description: MVP1 integration — wires all Atlassian-stack adapters into the engine, adds collaboration startup/shutdown, and implements the end-to-end async workflow integration test suite.
---

# Implementation Notes: MVP1 Integration

## Summary

Completed the end-to-end wiring of all MVP1 (Atlassian-stack) collaboration components into the ai-sdd engine. This covers two task-group TG-08 tasks: T-025 (wire adapters into engine) and T-026 (end-to-end async workflow test). The engine now supports `collaboration.enabled = true` in workflow YAML, initializes the full collaboration subsystem on startup (fail-fast credential validation), and routes async task signals through the approval manager to the state machine. A comprehensive integration test suite verifies the full lifecycle using mock adapters.

## Files Created / Modified

### Modified

- `src/core/engine.ts` — Added `initCollaboration()` private method called during `run()` startup when `config.collaboration?.enabled === true`. Injects `CollaborationAdapterFactory`, `AsyncTaskManager`, `ApprovalManager`, and `CollaborationEventBus` into the task-dispatch path. Added `teardownCollaboration()` called in the `finally` block to stop all listeners cleanly. Forward all `collab.*` events to the existing `ObservabilityEventEmitter` via a bridge handler.

- `src/types/index.ts` — Extended `EngineConfig` with an optional `collaboration` block (`enabled: boolean`, `adapters: CollaborationAdapterConfig`, `notification_channel: string`).

- `src/core/workflow-loader.ts` — Added parsing for the top-level `collaboration:` key in workflow YAML (Zod schema extension). Passes config into engine at load time.

- `src/cli/commands/run.ts` — Forwards `collaboration` config from loaded workflow into `EngineConfig`.

### Created

- `src/collaboration/engine-bridge.ts` — Thin integration layer between the engine and the collaboration subsystem. Exports `CollaborationBridge` class that:
  1. Accepts `CollaborationAdapterFactory`, `AsyncTaskManager`, `ApprovalManager`, `CollaborationEventBus`.
  2. On `start()`: calls `factory.validateCredentials()` (fail-fast), registers the notification listener on the configured channel.
  3. On `stop()`: stops all listeners, flushes audit log.
  4. Exports `handleTaskDispatched(taskId, taskConfig)` — called by engine after each task dispatch; if `taskConfig.mode === "async"`, transitions to `AWAITING_APPROVAL` and posts Slack notification.

- `src/collaboration/audit-log.ts` — `AsyncAuditLog` class. Appends JSONL entries to `.ai-sdd/sessions/<session>/audit-log.jsonl`. Each entry contains: `timestamp`, `task_id`, `event_type`, `from_status`, `to_status`, `actor`, `metadata`. Uses atomic append (file descriptor O_APPEND). Registers as a `collab.*` event listener on the event bus.

- `tests/collaboration/integration/async-approval-flow.test.ts` — End-to-end integration test suite (T-026). 3 Gherkin scenarios fully covered:
  1. **Happy path**: engine dispatches async task → `MockNotificationAdapter.postNotification()` called → inject approval signal via `MockNotificationAdapter.simulateMessage()` → state machine transitions `AWAITING_APPROVAL → APPROVED → DOING → COMPLETED` → audit log contains all 4 transitions.
  2. **Rejection/rework cycle**: inject rejection → task transitions to `DOING` (rework) → approval count resets → new Slack notification posted → second approval completes task.
  3. **Hybrid workflow**: sync task-A + async task-B (depends on A) → A completes synchronously → B enters `AWAITING_APPROVAL` without blocking A's completion → engine continues polling.

- `tests/collaboration/integration/cli-sync-command.test.ts` — CLI integration test for a future `ai-sdd sync` command stub (dev standard #7). Verifies the command exits with a clear "not yet implemented" error message (no silent stub — dev standard #3).

## Testing

17 new tests across 2 new integration test files, all passing. Existing 97 collaboration unit tests pass unchanged. Full test suite: `bun test` — green.

## Key Design Decisions

- **CollaborationBridge as the seam**: Rather than modifying the engine dispatch loop with deep collaboration conditionals, `CollaborationBridge` encapsulates all collaboration startup/shutdown and provides a single `handleTaskDispatched()` hook. The engine remains testable without collaboration components.

- **Fail-fast credential validation on startup**: `factory.validateCredentials()` is called before any tasks run. If credentials are missing or malformed, the engine exits with a clear error before dispatching any work. This satisfies NFR-001 (credential safety) and dev standard #3 (no silent stubs).

- **Collaboration disabled by default**: `collaboration.enabled` defaults to `false` in `EngineConfig`. All sync-only workflows (the entire existing test suite) are completely unaffected — no bridge is created, no adapters initialized.

- **Event bus bridging to observability**: All `collab.*` events are forwarded to the existing `ObservabilityEventEmitter` so collaboration activity appears in existing event logs without duplicating the observability infrastructure.

- **Audit log as append-only JSONL**: Using O_APPEND file descriptor ensures correctness under concurrent signal handling. The log is session-scoped (`.ai-sdd/sessions/<session>/audit-log.jsonl`) consistent with existing session layout.

- **Mock adapter signal injection**: End-to-end tests call `MockNotificationAdapter.simulateMessage()` to inject signals directly into the registered handler, bypassing actual polling. This keeps tests deterministic with no real I/O.

## Open Issues

None blocking. The following are tracked for post-MVP:

- Timeout escalation (approval_timeout_seconds > 0) is stubbed — timer fires but currently logs a warning rather than transitioning to FAILED. Tracked in T-027 (post-MVP).
- `ai-sdd sync` CLI command returns "not implemented" — the test covers this per dev standard #7. Full implementation is post-MVP.
