# T005: Human-in-the-Loop (HIL) Overlay

**Phase:** 1 (Core Engine)
**Status:** PENDING
**Dependencies:** T004 (core engine)

---

## Context

The HIL overlay is the primary safety mechanism. It is **on by default**. It pauses workflow execution when:
1. A task is explicitly marked `requires_human: true`.
2. A loop exhausts its `MAX_ITERATION` without meeting an exit condition (deadlock).
3. Any overlay signals an unresolvable condition requiring human judgment.

The HIL queue is file-based (for easy inspection and integration with external tools). A human operator resolves or rejects items via the CLI.

---

## Acceptance Criteria

```gherkin
Feature: HIL overlay

  Scenario: Task requires human approval
    Given a task with `requires_human: true`
    When the task is ready to execute
    Then execution pauses
    And a HIL queue item is created with status PENDING
    And the CLI shows the pending item with task context

  Scenario: Human resolves HIL item
    Given a PENDING HIL queue item for task "design-l1"
    When the operator runs `ai-sdd hil resolve <item-id>`
    Then the queue item status changes to RESOLVED
    And the engine resumes and executes "design-l1"

  Scenario: Human rejects HIL item
    Given a PENDING HIL queue item for task "design-l1"
    When the operator runs `ai-sdd hil reject <item-id> --reason "..."`
    Then the queue item status changes to REJECTED
    And the engine marks "design-l1" as FAILED with the rejection reason
    And downstream tasks are not executed

  Scenario: Loop exhaustion escalates to HIL
    Given a task loop that has reached MAX_ITERATION without meeting exit conditions
    When the engine detects loop exhaustion
    Then a HIL queue item is created with the loop history and current state
    And execution pauses awaiting human decision

  Scenario: HIL notification fires on item creation
    Given hil.notify.on_created has a webhook configured
    When a HIL queue item is created (any trigger)
    Then the webhook is called asynchronously with item_id, task_id, trigger
    And the queue file is already written before the webhook fires
    And a notification failure does not block the workflow or the HIL queue

  Scenario: T2 gate triggers dedicated notification
    Given hil.notify.on_t2_gate has a separate webhook configured
    When a T2 evidence gate creates a HIL item
    Then the on_t2_gate webhook fires in addition to on_created
    And the notification includes the full gate report for immediate triage

  Scenario: HIL disabled for low-risk workflow
    Given a workflow with `overlays.hil.enabled: false`
    And a task with `requires_human: true`
    When the task runs
    Then a warning is logged
    And the task executes without pausing (HIL is bypassed)

  Scenario: Queue item lifecycle
    Given a new HIL queue item
    Then it starts as PENDING
    When the operator acknowledges it
    Then it transitions to ACKED
    When the operator provides a decision
    Then it transitions to RESOLVED or REJECTED
```

---

## HIL Queue Item Schema

```json
{
  "id": "hil-001",
  "task_id": "design-l1",
  "trigger": "requires_human | loop_exhaustion | overlay_escalation",
  "status": "PENDING | ACKED | RESOLVED | REJECTED",
  "context": {
    "task_definition": "...",
    "loop_history": [...],
    "overlay_state": {...}
  },
  "created_at": "2026-02-27T10:00:00Z",
  "resolved_at": null,
  "resolved_by": null,
  "resolution_notes": null
}
```

---

## File-Based Queue

Queue directory: `.ai-sdd/state/hil/`

Each queue item is a JSON file named `<item-id>.json`. The engine polls or watches this directory for status changes.

---

## CLI Commands

```bash
ai-sdd hil list                           # list all PENDING HIL items
ai-sdd hil show <item-id>                 # show item context + current state
ai-sdd hil resolve <item-id> [--notes ""] # resolve and unblock the task
ai-sdd hil reject <item-id> --reason "..." # reject and fail the task
```

---

## HIL Notification Hooks

In parallel workflows, a T2 gate or long-running HIL item can stall the entire DAG if
nobody is watching the queue. The notification hook fires whenever a HIL item is created,
allowing the engine to ping external systems without polling.

```yaml
# ai-sdd.yaml — HIL is configured under overlays.hil (consistent with all other overlays)
overlays:
  hil:
    enabled: true
    queue_path: ".ai-sdd/state/hil/"
    poll_interval_seconds: 2
    notify:
      on_created:
        - type: webhook
          url: "https://hooks.slack.com/services/..."    # Slack incoming webhook
        - type: command
          command: "scripts/notify-hil.sh ${HIL_ITEM_ID} ${TASK_ID} ${TRIGGER}"
      on_t2_gate:                                         # separate hook for T2 urgency
        - type: webhook
          url: "https://hooks.slack.com/services/..."
```

Notification is **fire-and-forget** — a notification failure never blocks the HIL queue
itself. The queue file is written first; the notification is best-effort.

## Implementation Notes

- HIL overlay registers on the `pre_task` hook of the engine.
- On loop exhaustion, the overlay intercepts the `on_loop_exit` hook.
- Queue write failure is a critical error — block progression, emit critical event.
- Notification hooks fire after queue write succeeds (fire-and-forget, async).
- `${HIL_ITEM_ID}`, `${TASK_ID}`, `${TRIGGER}` are substituted by the engine.
- Polling interval for queue file change detection: 2s (configurable).
- The engine does not proceed until the queue item is RESOLVED or REJECTED.

---

## Files to Create

- `overlays/hil/hil_overlay.py`
- `overlays/hil/queue.py`
- `tests/test_hil_overlay.py`

---

## Test Strategy

- Integration tests: pause on `requires_human=true`; CLI resolve unblocks; CLI reject fails task.
- Integration test: loop exhaustion triggers HIL.
- Integration test: queue write failure raises critical error.
- Unit tests: queue item lifecycle state machine (PENDING → ACKED → RESOLVED/REJECTED).

## Rollback/Fallback

- If queue write fails: block progression and emit critical error log entry.
- If HIL is disabled and `requires_human: true` is set: log warning, proceed (safety bypass is explicit choice).
