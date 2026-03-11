# T-004: Approval Timeout with Slack Escalation

## Metadata
- **Group:** [TG-01 -- Core Async Engine](index.md)
- **Component:** AsyncTaskManager (timeout subsystem)
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-002](T-002-async-task-manager.md), [T-003](T-003-approval-manager.md)
- **Blocks:** T-025
- **Requirements:** [FR-002](../../../define-requirements/FR/FR-002-async-task-state-machine.md), [FR-013](../../../define-requirements/FR/FR-013-configurable-stakeholder-signoff.md)

## Description
Implement approval timeout handling in the AsyncTaskManager. When `approval_timeout_seconds > 0`, a deadline is computed and persisted. The `checkTimeouts()` method (called periodically) detects expired deadlines, posts a Slack escalation notification, emits `async.timeout.expired`, and transitions the task to FAILED.

## Acceptance criteria

```gherkin
Feature: Approval timeout with escalation

  Scenario: Task times out and transitions to FAILED
    Given a task in AWAITING_APPROVAL with approval_timeout_seconds = 60
    When 60 seconds elapse without meeting the approval threshold
    Then checkTimeouts returns the task as timed out
    And the task transitions to FAILED
    And a timeout notification is posted to the Slack channel

  Scenario: No timeout when approval_timeout_seconds is 0
    Given a task in AWAITING_APPROVAL with approval_timeout_seconds = 0
    When checkTimeouts runs
    Then the task is not flagged as timed out
```

## Implementation notes
- `approval_timeout_at` stored as ISO 8601 in AsyncTaskState, persisted via StateManager
- `checkTimeouts()` compares current time against `approval_timeout_at`
- Escalation message includes task ID, elapsed time, and current approval count
- Use the NotificationAdapter interface for posting (not Slack directly)

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Timeout deadline survives engine restart (persisted in state)
