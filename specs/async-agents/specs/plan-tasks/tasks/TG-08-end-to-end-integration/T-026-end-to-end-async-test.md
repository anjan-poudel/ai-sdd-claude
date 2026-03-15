# T-026: End-to-End Async Workflow Test

## Metadata
- **Group:** [TG-08 -- End-to-End Integration](index.md)
- **Component:** Integration test suite
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** [T-025](T-025-wire-adapters-into-engine.md), [T-009](../TG-03-slack-integration/T-009-slack-notification-adapter.md), [T-010](../TG-03-slack-integration/T-010-slack-polling-listener.md), [T-017](../TG-05-jira-integration/T-017-as-code-sync-engine.md)
- **Blocks:** --
- **Requirements:** [FR-014](../../../define-requirements/FR/FR-014-end-to-end-async-collaboration-flow.md)

## Description
Implement the end-to-end integration tests covering: (1) the full async workflow approval/rejection cycle, and (2) the collaboration wiring test that verifies all hooks fire in correct order with correct arguments when the engine processes a mock workflow. Uses mock adapters throughout.

## Acceptance criteria

```gherkin
Feature: End-to-end async workflow

  Scenario: Happy path -- async task approved and completed
    Given a workflow with one async task requiring 1 approval
    When the engine runs the task
    Then a Slack notification is posted (via MockNotificationAdapter)
    And when a mock approval signal is injected
    Then the task transitions AWAITING_APPROVAL -> APPROVED -> DOING -> COMPLETED
    And the audit log contains all state transitions

  Scenario: Rejection triggers rework cycle
    Given a workflow with one async task in AWAITING_APPROVAL
    When a mock rejection signal is injected
    Then the task transitions to DOING (rework)
    And the approval count resets
    And a new Slack notification is posted for the next review cycle

  Scenario: Hybrid workflow with mixed sync and async tasks
    Given a workflow with task-A (sync) and task-B (async, depends on task-A)
    When the engine runs
    Then task-A completes synchronously
    And task-B enters AWAITING_APPROVAL after agent execution
    And the engine does not block on task-B (continues polling)

Feature: Collaboration wiring hooks

  Scenario: workflow_started hook publishes Slack message
    Given collaboration enabled with MockNotificationChannel
    When the engine starts a workflow
    Then MockNotificationChannel.calls contains one record with event = "workflow_started"

  Scenario: task_completed hook publishes Confluence page and Slack message
    Given collaboration enabled with MockNotificationChannel and MockDocumentAdapter
    When a task completes with an output file
    Then ConfluenceSyncManager.publishDocument is called with the task output
    And MockNotificationChannel.calls contains a record with event = "task_completed"
    And that message includes artifact_url pointing to the Confluence page

  Scenario: hil_requested hook fires non-blocking
    Given a task that enters HIL_PENDING
    When on_hil_requested hook fires
    Then MockNotificationChannel.calls contains a record with event = "hil_requested"
    And the HIL resolution wait is not blocked by the notification publish

  Scenario: failure hook fires on task failure
    Given a task that fails
    When on_failure hook fires
    Then MockNotificationChannel.calls contains a record with event = "task_failed"
    And JiraHierarchySync.transitionForStatus is called with "FAILED"
```

## Implementation notes
- **Async approval test file:** `tests/collaboration/integration/async-approval-flow.test.ts`
- **Collaboration wiring test file:** `tests/collaboration/integration/collab-wiring.test.ts`
- `collab-wiring.test.ts` uses `MockNotificationChannel` (not `MockNotificationAdapter`) to assert at the `ActivityMessage` level
- Mock adapter signal injection: directly call the handler registered via `startListener`
- Verifies audit log entries in `.ai-sdd/sessions/<session>/audit-log.jsonl`
- CLI integration test (dev standard #7): `tests/collaboration/integration/cli-sync-command.test.ts`
- Must cover NFR-003 (auditability): verify every state transition is logged

## Definition of done
- [x] Code reviewed and merged
- [x] Gherkin scenarios for async approval flow covered in `async-approval-flow.test.ts`
- [x] Gherkin scenarios for collaboration wiring covered in `collab-wiring.test.ts` (7 tests)
- [ ] Audit log verified for all state transitions
- [ ] CLI integration test for the sync command (dev standard #7)
- [ ] No PII in logs
