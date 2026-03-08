# FR-006: CANCELLED Task State Addition to VALID_TRANSITIONS

## Metadata
- **Area:** Task State Machine
- **Priority:** MUST
- **Source:** constitution.md — Deliverables; `src/types/index.ts` (TaskStatus, VALID_TRANSITIONS)

## Description

The system must add `CANCELLED` as a valid terminal `TaskStatus` value and update
`VALID_TRANSITIONS` in `src/types/index.ts` to reflect all reachable and blocked transitions.

### Updated type definitions

```typescript
export type TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "NEEDS_REWORK"
  | "HIL_PENDING"
  | "FAILED"
  | "CANCELLED";

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING:      ["RUNNING", "CANCELLED"],
  RUNNING:      ["COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED", "CANCELLED"],
  COMPLETED:    [],
  NEEDS_REWORK: ["RUNNING", "FAILED", "CANCELLED"],
  HIL_PENDING:  ["RUNNING", "FAILED", "CANCELLED"],
  FAILED:       [],
  CANCELLED:    [],   // terminal — no outgoing transitions
};
```

### Key behavioral properties

1. `CANCELLED` is a terminal state. No transitions out of `CANCELLED` are valid. Any attempt to transition a task from `CANCELLED` to any other state must throw `StateError` with the same format used for all invalid transitions.

2. `CANCELLED` is reachable from every non-terminal state: `PENDING`, `RUNNING`, `NEEDS_REWORK`, and `HIL_PENDING`. It is not reachable from `COMPLETED` or `FAILED` (both are already terminal).

3. State persistence: the `StateManager` must persist the `CANCELLED` status atomically to the state file using the existing tmp+rename pattern. No partial writes are permitted.

4. `CANCELLED` represents a deliberate, operator-initiated termination — distinct from `FAILED` (which represents an error). The `ai-sdd status` CLI output must display `CANCELLED` tasks as a separate category from `FAILED` tasks.

5. Tasks downstream of a `CANCELLED` task must behave the same as tasks downstream of a `FAILED` task: they are skipped (not attempted), and the run result includes them in the `failed` list for reporting purposes.

### Rationale

`CANCELLED` is the one genuinely missing state that coding-standards identified in the
existing `TaskStatus` type. It provides a clean terminal state for manual cancellations,
governance skip decisions (future), and workflow-level abort without conflating those
situations with error-driven `FAILED` transitions.

## Acceptance criteria

```gherkin
Feature: CANCELLED task state and transitions

  Scenario: Transition from PENDING to CANCELLED succeeds
    Given a task in PENDING state
    When the state-manager transitions it to CANCELLED
    Then the transition succeeds without error
    And the persisted state file reflects status "CANCELLED"

  Scenario: Transition from RUNNING to CANCELLED succeeds
    Given a task in RUNNING state
    When the state-manager transitions it to CANCELLED
    Then the transition succeeds without error

  Scenario: Transition from HIL_PENDING to CANCELLED succeeds
    Given a task in HIL_PENDING state
    When the state-manager transitions it to CANCELLED
    Then the transition succeeds without error

  Scenario: Transition from NEEDS_REWORK to CANCELLED succeeds
    Given a task in NEEDS_REWORK state
    When the state-manager transitions it to CANCELLED
    Then the transition succeeds without error

  Scenario: CANCELLED is terminal — no outgoing transitions
    Given a task in CANCELLED state
    When any state transition is attempted
    Then the state-manager throws StateError
    And the error message identifies CANCELLED as a terminal state

  Scenario: COMPLETED cannot be cancelled
    Given a task in COMPLETED state
    When a transition to CANCELLED is attempted
    Then the state-manager throws StateError

  Scenario: FAILED cannot be cancelled
    Given a task in FAILED state
    When a transition to CANCELLED is attempted
    Then the state-manager throws StateError

  Scenario: State file is written atomically on CANCELLED transition
    Given a task in RUNNING state
    When the state-manager writes a CANCELLED transition using the tmp+rename pattern
    Then the state file is readable with status "CANCELLED" immediately after the write
    And no intermediate or partial state file exists at any point during the write

  Scenario: ai-sdd status displays CANCELLED tasks separately from FAILED
    Given a workflow with one CANCELLED task and one FAILED task
    When "ai-sdd status" is run
    Then both tasks appear in the output
    And CANCELLED is displayed in a visually distinct way from FAILED
```

## Related
- FR: FR-007 (engine verdict mapping — CANCELLED is the target state for future SKIP verdicts)
- NFR: NFR-002 (atomic state persistence, VALID_TRANSITIONS exhaustiveness)
- Depends on: none (standalone type system change)
