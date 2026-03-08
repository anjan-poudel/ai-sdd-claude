# ROA-T-002: CANCELLED Task State (`src/types/index.ts`)

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Component H — `src/types/index.ts`
- **Effort:** S
- **Risk:** MEDIUM
- **Depends on:** ROA-T-001
- **Blocks:** ROA-T-009
- **Requirements:** FR-006, NFR-002
- **Status:** COMPLETE — `CANCELLED` is already in `TaskStatus` and `VALID_TRANSITIONS`

## Description

Add `CANCELLED` as a terminal `TaskStatus` value in `src/types/index.ts` and update
`VALID_TRANSITIONS` to allow transitions from every non-terminal state to `CANCELLED`.
`CANCELLED` represents deliberate operator-initiated cancellation and must be visually
distinct from `FAILED` in `ai-sdd status` output.

Key behavioral rules:
- `CANCELLED` is reachable from `PENDING`, `RUNNING`, `NEEDS_REWORK`, `HIL_PENDING`.
- `COMPLETED` and `FAILED` cannot transition to `CANCELLED` (already terminal).
- `CANCELLED` has no outgoing transitions — any attempt throws `StateError`.
- Downstream tasks of a `CANCELLED` task behave identically to downstream tasks of `FAILED`.

## Files to create/modify

| File | Action |
|------|--------|
| `src/types/index.ts` | Modify — add `"CANCELLED"` to `TaskStatus` union and to `VALID_TRANSITIONS` |
| `src/cli/commands/status.ts` | Modify — display `CANCELLED` as a separate category (symbol `⊘`) |

## Acceptance criteria

```gherkin
Feature: CANCELLED task state and transitions

  Scenario: Transition from PENDING to CANCELLED succeeds atomically
    Given a task in PENDING state
    When the state-manager transitions it to CANCELLED
    Then the transition succeeds without error
    And the persisted state file reflects status "CANCELLED"
    And the write used the tmp+rename atomic pattern

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

  Scenario: COMPLETED cannot be cancelled
    Given a task in COMPLETED state
    When a transition to CANCELLED is attempted
    Then the state-manager throws StateError

  Scenario: FAILED cannot be cancelled
    Given a task in FAILED state
    When a transition to CANCELLED is attempted
    Then the state-manager throws StateError

  Scenario: ai-sdd status displays CANCELLED tasks separately from FAILED
    Given a workflow with one CANCELLED task and one FAILED task
    When "ai-sdd status" is run
    Then both tasks appear in the output
    And CANCELLED is displayed with the "⊘" symbol distinct from the "✗" symbol for FAILED
    And the summary line includes a separate "⊘ N" count for cancelled tasks
```

## Implementation notes

- `StateManager.transition()` persists `CANCELLED` atomically using the existing
  tmp+rename pattern in `src/core/state-manager.ts`. No changes to `StateManager` are
  required beyond ensuring `CANCELLED` is a valid transition target — the generic
  transition logic handles it automatically once `VALID_TRANSITIONS` is updated.
- The `ai-sdd status` command in `src/cli/commands/status.ts` must include a `cancelled`
  count in its summary line and use the `⊘` symbol (U+2298) for CANCELLED tasks.
- Development Standards §7 (one integration test per CLI command): a CLI integration
  test must verify the CANCELLED display in `ai-sdd status` output.

## Definition of done

- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests in `tests/state-manager.test.ts` (extended)
- [ ] CLI integration test in `tests/cli/` verifies CANCELLED display in `ai-sdd status` output
- [ ] `bun test` shows all 505+ existing tests still pass (NFR-004 regression gate)
