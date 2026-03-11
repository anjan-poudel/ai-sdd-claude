# T-002: AsyncTaskManager Implementation

## Metadata
- **Group:** [TG-01 -- Core Async Engine](index.md)
- **Component:** AsyncTaskManager
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** [T-001](T-001-async-state-machine.md)
- **Blocks:** T-004, T-025
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-async-sync-task-mode.md), [FR-003](../../../define-requirements/FR/FR-003-hybrid-workflow-execution.md)

## Description
Implement the AsyncTaskManager that extends the engine's task lifecycle to handle async execution. It owns the sync/async mode fork -- when `mode === "async"`, it transitions RUNNING to AWAITING_APPROVAL, starts the Slack notification + polling loop, and delegates signal handling to the ApprovalManager. Must integrate with the existing engine dispatch path without modifying the sync flow.

## Acceptance criteria

```gherkin
Feature: AsyncTaskManager lifecycle

  Scenario: Async task enters approval cycle after agent output
    Given a task with mode "async" completes agent execution
    When startAsyncCycle is called with the task output
    Then the task transitions to AWAITING_APPROVAL
    And a notification is posted to the configured Slack channel
    And a polling listener is started for approval signals

  Scenario: Sync task bypasses async manager entirely
    Given a task with mode "sync" completes agent execution
    When the engine processes the task output
    Then the task transitions directly to COMPLETED (via existing overlay chain)
    And AsyncTaskManager is never invoked
```

## Implementation notes
- File: `src/collaboration/core/async-task-manager.ts`
- Must use the NotificationAdapter interface (not Slack directly) for posting and listening
- Polling interval and timeout from task config via AsyncTaskConfigSchema (Zod)
- Emit `async.cycle.started` event via CollaborationEventBus on cycle start
- Integration point with engine.ts: call `asyncTaskManager.startAsyncCycle()` after overlay chain when `mode === "async"`

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Unit tests with MockNotificationAdapter
- [ ] Integration test verifying engine calls startAsyncCycle for async tasks
