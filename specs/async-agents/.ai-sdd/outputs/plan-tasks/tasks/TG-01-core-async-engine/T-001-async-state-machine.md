# T-001: Async State Machine Extensions

## Metadata
- **Group:** [TG-01 -- Core Async Engine](index.md)
- **Component:** AsyncTaskManager (state machine layer)
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** --
- **Blocks:** T-002, T-003, T-004, T-025
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-async-sync-task-mode.md), [FR-002](../../../define-requirements/FR/FR-002-async-task-state-machine.md)

## Description
Add AWAITING_APPROVAL, APPROVED, DOING, and CANCELLED states to the TaskStatus enum and extend VALID_TRANSITIONS with async-specific transitions. The new states must only be reachable when `task.mode === "async"` -- sync tasks must never enter these states. Existing sync transitions must remain unchanged for full backward compatibility.

## Acceptance criteria

```gherkin
Feature: Async state machine extensions

  Scenario: Async task transitions through approval lifecycle
    Given a task configured with mode "async"
    When the task reaches RUNNING state
    Then AWAITING_APPROVAL is a valid next state
    And AWAITING_APPROVAL can transition to APPROVED or FAILED or CANCELLED
    And APPROVED can transition to DOING
    And DOING can transition to AWAITING_APPROVAL or COMPLETED or FAILED or CANCELLED

  Scenario: Sync tasks cannot enter async states
    Given a task configured with mode "sync"
    When the task is in RUNNING state
    Then AWAITING_APPROVAL is NOT a valid transition target
    And attempting the transition throws StateError
```

## Implementation notes
- Modify `src/types/index.ts` to add new enum values and extend VALID_TRANSITIONS
- The transition map merge must happen at module load time (not runtime config)
- Add a mode guard in the state manager's `transition()` method that checks task mode before allowing async states
- Must preserve all existing test assertions for sync transitions

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Existing state machine tests still pass (zero regressions)
- [ ] TypeScript strict mode -- no `any` casts for new states
