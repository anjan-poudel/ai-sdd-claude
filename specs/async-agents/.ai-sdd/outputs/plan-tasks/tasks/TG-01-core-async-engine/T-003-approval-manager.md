# T-003: ApprovalManager Implementation

## Metadata
- **Group:** [TG-01 -- Core Async Engine](index.md)
- **Component:** ApprovalManager
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-001](T-001-async-state-machine.md)
- **Blocks:** T-004, T-025
- **Requirements:** [FR-005](../../../define-requirements/FR/FR-005-slack-approval-signal-listener.md), [FR-013](../../../define-requirements/FR/FR-013-configurable-stakeholder-signoff.md)

## Description
Implement the ApprovalManager that collects approval/rejection signals, enforces per-stakeholder deduplication, checks the min_approvals threshold, and implements the veto model (any single rejection transitions to DOING). Stateless between restarts -- reads/writes from TaskState via StateManager.

## Acceptance criteria

```gherkin
Feature: ApprovalManager signal handling

  Scenario: Approval threshold met triggers state transition
    Given a task requiring 2 approvals is in AWAITING_APPROVAL
    When 2 distinct stakeholders submit approval signals
    Then isThresholdMet returns true
    And the triggered_transition is "APPROVED"

  Scenario: Duplicate approval from same stakeholder is ignored
    Given a stakeholder has already approved the current phase
    When the same stakeholder submits another approval
    Then the result has accepted = false
    And the approval count does not increment

  Scenario: Single rejection vetoes and resets cycle
    Given a task has 1 of 2 required approvals
    When any stakeholder submits a rejection signal
    Then the task transitions to DOING
    And the approval count resets for the next cycle
```

## Implementation notes
- File: `src/collaboration/core/approval-manager.ts`
- Dedup by checking `stakeholder_id` in `TaskState.approval_signals[]` for current `async_phase`
- `min_approvals` resolved via 4-layer merge (ENGINE_TASK_DEFAULTS -> workflow defaults -> template -> task inline)
- `min_approvals: 0` means auto-advance (no human approval needed)
- Emit `async.approval.received`, `async.rejection.received`, `async.threshold.met` events

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Edge cases tested: 0 min_approvals, concurrent signals, unknown task ID
