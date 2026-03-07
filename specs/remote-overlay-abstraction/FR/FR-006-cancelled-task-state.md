# FR-006: CANCELLED Task State

## Metadata
- **Area:** Task State Machine
- **Priority:** MUST
- **Source:** REMOTE-OVERLAY-PLAN.md §7; constitution.md Deliverables

## Description

The system must add `CANCELLED` as a valid terminal task state to the `TaskStatus` type and `VALID_TRANSITIONS` map in `src/types/index.ts`.

The updated definitions must be:

```typescript
export type TaskStatus =
  | "PENDING" | "RUNNING" | "COMPLETED"
  | "NEEDS_REWORK" | "HIL_PENDING" | "FAILED"
  | "CANCELLED";

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING:      ["RUNNING", "CANCELLED"],
  RUNNING:      ["COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED", "CANCELLED"],
  COMPLETED:    [],
  NEEDS_REWORK: ["RUNNING", "FAILED", "CANCELLED"],
  HIL_PENDING:  ["RUNNING", "FAILED", "CANCELLED"],
  FAILED:       [],
  CANCELLED:    [],
};
```

Key properties of `CANCELLED`:

1. It is terminal: no transitions out of `CANCELLED` are valid.
2. It is reachable from every non-terminal state: `PENDING`, `RUNNING`, `NEEDS_REWORK`, and `HIL_PENDING`.
3. Attempting to transition out of `CANCELLED` must throw `StateError` with the same error format used for all invalid transitions.
4. The state-manager must persist the `CANCELLED` status to the state file atomically (using the existing tmp+rename pattern).
5. The `ai-sdd status` CLI command must display `CANCELLED` tasks in its output. The display must not be omitted or grouped with `FAILED`.

The `CANCELLED` state is the mechanism by which workflow cancellation, manual operator intervention, and (future) governance SKIP decisions terminate a task cleanly and traceably without implying an error.

## Acceptance Criteria

```gherkin
Feature: CANCELLED task state

  Scenario: PENDING task can be cancelled
    Given a task in PENDING state
    When the state-manager transitions the task to CANCELLED
    Then the transition succeeds
    And the persisted state file shows status "CANCELLED"

  Scenario: RUNNING task can be cancelled
    Given a task in RUNNING state
    When the state-manager transitions the task to CANCELLED
    Then the transition succeeds
    And the persisted state file shows status "CANCELLED"

  Scenario: HIL_PENDING task can be cancelled
    Given a task in HIL_PENDING state
    When the state-manager transitions the task to CANCELLED
    Then the transition succeeds
    And the persisted state file shows status "CANCELLED"

  Scenario: NEEDS_REWORK task can be cancelled
    Given a task in NEEDS_REWORK state
    When the state-manager transitions the task to CANCELLED
    Then the transition succeeds
    And the persisted state file shows status "CANCELLED"

  Scenario: CANCELLED is terminal — no transition out
    Given a task in CANCELLED state
    When any further state transition is attempted
    Then the state-manager throws StateError
    And the error message identifies CANCELLED as a terminal state

  Scenario: COMPLETED task cannot be cancelled
    Given a task in COMPLETED state
    When a transition to CANCELLED is attempted
    Then the state-manager throws StateError

  Scenario: FAILED task cannot be cancelled
    Given a task in FAILED state
    When a transition to CANCELLED is attempted
    Then the state-manager throws StateError

  Scenario: ai-sdd status shows CANCELLED tasks
    Given a workflow run where one task is in CANCELLED state
    When "ai-sdd status" is run
    Then the output includes the task and its CANCELLED status
    And CANCELLED is visually distinct from FAILED in the output
```

## Related
- FR: FR-007 (engine verdict mapping triggers CANCELLED)
- NFR: NFR-002 (state persistence reliability)
- Depends on: none (standalone type system change)
