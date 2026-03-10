# ROA-T-009: State Manager Tests for CANCELLED State

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Test coverage for Component H (CANCELLED state)
- **Effort:** S
- **Risk:** LOW
- **Depends on:** ROA-T-002
- **Blocks:** ROA-T-011
- **Requirements:** FR-006, NFR-002
- **Status:** COMPLETE — CANCELLED transition tests already in tests/state-manager.test.ts

## Description

Extend `tests/state-manager.test.ts` to cover all CANCELLED state transitions. These
tests verify the full reachability matrix, terminal semantics, and atomic persistence
of the `CANCELLED` state added in ROA-T-002.

Tests must verify:
1. `PENDING → CANCELLED` succeeds and state file reflects `CANCELLED`
2. `RUNNING → CANCELLED` succeeds
3. `NEEDS_REWORK → CANCELLED` succeeds
4. `HIL_PENDING → CANCELLED` succeeds
5. `CANCELLED → anything` throws `StateError`
6. `COMPLETED → CANCELLED` throws `StateError`
7. `FAILED → CANCELLED` throws `StateError`
8. Atomic write (tmp+rename): file is either pre-state or post-state at all times

## Files to create/modify

| File | Action |
|------|--------|
| `tests/state-manager.test.ts` | Extend — add CANCELLED transition test cases |

## Acceptance criteria

```gherkin
Feature: CANCELLED state in StateManager

  Scenario: PENDING to CANCELLED persists atomically
    Given a StateManager with a task in PENDING state
    When transition("task-id", "CANCELLED") is called
    Then getTaskState("task-id").status equals "CANCELLED"
    And the state file at the state path contains "CANCELLED"
    And no partial write is observable during the transition

  Scenario: All non-terminal states can reach CANCELLED
    Given tasks in PENDING, RUNNING, NEEDS_REWORK, and HIL_PENDING states
    When each is transitioned to CANCELLED
    Then all transitions succeed without throwing

  Scenario: CANCELLED has no outgoing transitions
    Given a task in CANCELLED state
    When transition("task-id", "RUNNING") is attempted
    Then StateError is thrown

  Scenario: Terminal states cannot be cancelled
    Given a task in COMPLETED state
    When transition("task-id", "CANCELLED") is attempted
    Then StateError is thrown

    Given a task in FAILED state
    When transition("task-id", "CANCELLED") is attempted
    Then StateError is thrown
```

## Implementation notes

- This task is purely test-only — no source code changes.
- The atomic write assertion can be verified by the fact that the `StateManager` uses
  tmp+rename pattern for all transitions. The test verifies the state file is readable
  with the expected status immediately after the call returns (no partial state).
- NFR-002: `VALID_TRANSITIONS` enforcement (100% of invalid transitions throw `StateError`).

## Definition of done

- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios passing in `tests/state-manager.test.ts`
- [ ] `bun test` shows all 505+ existing tests still pass
