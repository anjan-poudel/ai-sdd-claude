# T025: Fix HIL Resume State Machine Reset

**Phase:** 1 (Core Engine — bug fix)
**Status:** IMPLEMENTED
**Dependencies:** T004 (engine), T008 (HIL overlay)
**Size:** S (2 days)
**Priority:** High — causes repeated failures during interactive workflows

---

## Problem

When a task is in `HIL_PENDING` state and the engine resumes (via `--resume` or the
`/sdd-run` skill looping), the task's state gets "reset" — the HIL resolution is
effectively discarded and the overlay chain fires again from scratch. This manifests as:

```
"The HIL resolution triggered a state machine reset again. I need to restore the correct state."
```

This has been observed **multiple times** during real feature implementation workflows.

---

## Root Cause Analysis

The bug was in `engine.ts` → `runTaskIteration()`. The method had a **fixed sequence**
that did not distinguish between a fresh task start and a resume from `HIL_PENDING`:

```
1. Pre-task lifecycle hook                    — always
2. transition(taskId, "RUNNING")              — UNCONDITIONAL
3. incrementIteration(taskId)                 — bumps count incorrectly on resume
4. Emit "task.started"                        — fires again
5. Assemble context                           — fine
6. Run pre-task overlay chain                 — HIL overlay fires AGAIN
7. applyPreDecision                           — processes the duplicate HIL
8. (if HIL verdict) → transition HIL_PENDING  — back to HIL_PENDING (loop)
9. awaitResolution                            — waits for new (duplicate) item
```

### What happened on resume from `HIL_PENDING`:

1. `engine.run()` loaded persisted state. Task was `HIL_PENDING`.
2. `engine.run()` skipped COMPLETED tasks but did NOT skip `HIL_PENDING` tasks.
3. `runTask()` called `runTaskIteration()`.
4. `transition(taskId, "RUNNING")` — valid per `VALID_TRANSITIONS`
   (`HIL_PENDING → RUNNING` is allowed). The task lost its `HIL_PENDING` status.
5. `incrementIteration()` bumped iteration count (incorrect — no new work happened).
6. Pre-task overlay chain fired. HIL overlay's `preTask()` ran:
   - It checked `queue.list("PENDING")` for existing items.
   - If the HIL item was already `RESOLVED` by the user, no pending item existed,
     so `preTask()` created a **new** HIL item.
   - The task got stuck in a HIL loop: resolve → resume → new HIL → resolve → ...
7. If the HIL item was still `PENDING`, the overlay found it and returned it.
   But the task had already been moved to `RUNNING`, then got moved back to
   `HIL_PENDING`. This was the "state reset" — visible state churned without progress.

### Secondary issue: `initializeTasks()` on resume

`engine.run()` calls `stateManager.initializeTasks(allTaskIds)` every run.
`initializeTasks()` skips tasks that already have state, so it did NOT overwrite
`HIL_PENDING` tasks. This was correct — but the unconditional `transition("RUNNING")`
in `runTaskIteration()` immediately undid the persisted state anyway.

---

## Solution

### Approach: Detect and skip pre-overlay chain on HIL resume

Added a guard at the top of `runTaskIteration()` that checks if the task is being
resumed from `HIL_PENDING`. If so, it:

1. Skips the `transition("RUNNING")` + `incrementIteration()` + pre-overlay chain
2. Looks up the persisted `hil_item_id` from `TaskState`
3. Calls `awaitResolution(hil_item_id)` directly on the HIL overlay
4. On resolution: transitions `HIL_PENDING → RUNNING` and falls through to dispatch
5. On rejection: transitions to `FAILED` with the rejection reason
6. On missing `hil_item_id`: transitions to `FAILED` with actionable error message

The normal (non-HIL-resume) path is wrapped in the `else` branch and is completely
unchanged.

Context assembly was moved after both paths merge (before dispatch) so it is shared —
both normal and HIL resume paths assemble context before dispatch.

### Code Changes

#### 1. `src/core/engine.ts` — `runTaskIteration()`

The method now has this structure:

```typescript
private async runTaskIteration(...): Promise<...> {
  // Build idempotency keys (shared)

  // ── HIL resume path ──────────────────────────────────────────
  const currentState = this.stateManager.getTaskState(taskId);
  if (currentState.status === "HIL_PENDING") {
    const hilItemId = currentState.hil_item_id;
    if (!hilItemId) {
      // → FAILED: "no hil_item_id — cannot resume"
    }
    // emit "task.hil_resuming"
    // find HIL provider → awaitResolution(hilItemId)
    // if rejected → FAILED
    // if resolved → transition("RUNNING")
    // Do NOT incrementIteration — already started before HIL
  } else {
    // ── Normal path ──────────────────────────────────────────────
    // Pre-task hook
    // transition("RUNNING")
    // incrementIteration()
    // emit "task.started"
    // Pre-overlay chain (if providers exist)
    //   → may trigger HIL (fresh), REWORK, FAIL
  }

  // ── Shared path (both normal and HIL resume) ──────────────────
  // Assemble context
  // Cost budget check
  // Dispatch
  // Post-overlay chain
  // → COMPLETED / NEEDS_REWORK / FAILED
}
```

**Key correctness properties:**

- Context is assembled after both paths merge, before dispatch — shared by both.
- `incrementIteration()` is NOT called on HIL resume — the iteration was already
  counted when the task first started before HIL was triggered.
- `hil_item_id` from `TaskState` (set by `applyPreDecision()`) is used to find
  the correct HIL queue item. This field already existed in the interface.
- The overlay chain inside the `else` block now assembles its own `overlayContext`
  variable for the pre-overlay call, separate from the shared `context` used by dispatch.

#### 2. `src/core/engine.ts` — `run()` method

No changes needed. `HIL_PENDING` tasks correctly fall through to `runTask()`.

#### 3. `src/types/index.ts` — No changes needed

`hil_item_id?: string` already exists in the `TaskState` interface.

#### 4. Observability — `task.hil_resuming` event

The engine now emits `task.hil_resuming` with `{ task_id, hil_id }` when entering
the HIL resume path. This is logged via the existing `ObservabilityEmitter` (no
schema change needed — the emitter accepts arbitrary event payloads).

---

## What This Does NOT Do

- Does not change the overlay chain architecture or execution order
- Does not add a general "resume from any state" mechanism (only HIL_PENDING)
- Does not change HIL queue semantics (PENDING/ACKED/RESOLVED/REJECTED lifecycle)
- Does not add post-task HIL resume (post-task HIL is already handled conservatively
  as NEEDS_REWORK — see `applyPostDecision()`)
- Does not persist `operation_id` / `attempt_id` across resume (these are regenerated —
  the provider-side idempotency key handles dedup)

---

## Acceptance Criteria

```gherkin
Feature: HIL resume does not reset state

  Scenario: Resume from HIL_PENDING goes directly to awaitResolution
    Given a workflow state with task "task-a" in HIL_PENDING with hil_item_id "hil-abc-123"
    And a mock HIL overlay with awaitResolution returning { proceed: true }
    When engine.run() is called
    Then the engine does NOT call preTask on the HIL overlay
    And the engine calls awaitResolution("hil-abc-123")
    And the task transitions HIL_PENDING → RUNNING → (dispatch) → COMPLETED

  Scenario: Resume from HIL_PENDING does not increment iteration
    Given a workflow state with task "task-a" in HIL_PENDING with iterations=1
    When engine.run() resolves the HIL and completes
    Then iterations is still 1

  Scenario: Resume from HIL_PENDING with rejected item
    Given a workflow state with task "task-a" in HIL_PENDING with hil_item_id "hil-rejected"
    And a mock HIL overlay with awaitResolution returning { proceed: false, feedback: "..." }
    When engine.run() is called
    Then the task transitions to FAILED
    And the error message contains the rejection feedback

  Scenario: Resume from HIL_PENDING without hil_item_id fails gracefully
    Given a workflow state with task "task-a" in HIL_PENDING but no hil_item_id
    When engine.run() is called
    Then the task transitions to FAILED
    And the error contains "no hil_item_id"

  Scenario: Fresh task start (not resume) is unaffected
    Given a workflow state with task "task-a" in PENDING
    And a mock HIL overlay that triggers HIL on preTask
    When engine.run() is called
    Then preTask IS called on the HIL overlay
    And awaitResolution is called (after HIL is created)
    And the task completes normally
```

---

## Test Results

5 new tests in `tests/engine.test.ts` under `describe("Engine: HIL resume (T025)")`:

| # | Test | Assertion |
|---|------|-----------|
| 1 | resume from HIL_PENDING skips pre-overlay chain and calls awaitResolution | `preTaskCalled.length === 0`, `awaitCalled` contains the hil_item_id |
| 2 | resume from HIL_PENDING does not increment iteration count | `iterations` unchanged after resume |
| 3 | resume from HIL_PENDING with rejected item transitions to FAILED | `status === "FAILED"`, `error` contains feedback |
| 4 | resume from HIL_PENDING without hil_item_id transitions to FAILED | `status === "FAILED"`, `error` contains "no hil_item_id" |
| 5 | normal task start (non-resume) fires pre-overlay chain as before | `preTaskCalled` contains task-a |

**All 394 tests pass (389 existing + 5 new), 0 failures.**

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing HIL flow | Guard is strictly `if (status === "HIL_PENDING")` — no other paths affected |
| Missing `hil_item_id` on old state files | Explicit FAILED with actionable error message |
| Context not assembled in resume path | Context assembly moved to shared location after both paths merge |
| Race between external resolution and engine resume | `awaitResolution` polls until RESOLVED/REJECTED — handles this correctly |

---

## Files Modified

| File | Change |
|------|--------|
| `src/core/engine.ts` | HIL resume guard in `runTaskIteration()` + context assembly refactored to shared location |
| `tests/engine.test.ts` | `makeEngineWithOverlays()` helper + 5 new HIL resume tests |
