---
description: Async engine core implementation — state machine extensions, ApprovalManager, AsyncTaskManager, AsCodeSyncEngine, adapter interfaces, event bus, adapter factory, and RetryHttpClient.
---

# Implementation Notes: Async Engine Core

## Summary

Implemented the async task engine core components as specified in design-l2.md.

## Files Created / Modified

### Modified
- `src/types/index.ts` — Extended `TaskStatus` union with `AWAITING_APPROVAL | APPROVED | DOING`; extended `VALID_TRANSITIONS` map; added `ASYNC_ONLY_STATUSES` constant; added `async_state?: AsyncTaskState | undefined` to `TaskState` interface.
- `src/core/state-manager.ts` — Added `taskMode?: "sync" | "async"` parameter to `transition()`; added `updateTaskFields()` method; enforces mode guard (async-only states require `taskMode === "async"`).
- `src/cli/commands/status.ts` — Added `AWAITING_APPROVAL`, `APPROVED`, `DOING` entries to `STATUS_SYMBOLS`.

### Created
- `src/collaboration/types.ts` — Shared Result type, all adapter error/ref types, signal types, collaboration event types, async state types.
- `src/collaboration/adapters/notification-adapter.ts` — NotificationAdapter interface.
- `src/collaboration/adapters/document-adapter.ts` — DocumentAdapter interface.
- `src/collaboration/adapters/task-tracking-adapter.ts` — TaskTrackingAdapter interface.
- `src/collaboration/adapters/code-review-adapter.ts` — CodeReviewAdapter interface.
- `src/collaboration/core/event-bus.ts` — DefaultCollaborationEventBus wrapping Node EventEmitter.
- `src/collaboration/core/approval-manager.ts` — DefaultApprovalManager with deduplication, threshold checking, veto model.
- `src/collaboration/core/async-task-manager.ts` — AsyncTaskManager owning the async lifecycle.
- `src/collaboration/core/sync-engine.ts` — DefaultAsCodeSyncEngine with SHA-256 content hashing and BFS mapping.
- `src/collaboration/core/adapter-factory.ts` — DefaultCollaborationAdapterFactory with singleton caching and fail-fast credential validation.
- `src/collaboration/infra/retry.ts` — RetryHttpClient with exponential backoff and Retry-After header support.

## Testing

97 new tests across 7 test files, all passing.

## Key Design Decisions

- Async-only states (`AWAITING_APPROVAL`, `APPROVED`, `DOING`) are mode-guarded: the state manager throws `StateError` if `taskMode !== "async"` is passed for these transitions.
- Approval veto model: any single rejection increments the phase and triggers DOING regardless of prior approvals in that phase.
- `min_approvals=0` means auto-advance (no human gate needed).
- `AsyncTaskManager.handleSignal()` distinguishes approval from rejection by presence of `feedback` field.
