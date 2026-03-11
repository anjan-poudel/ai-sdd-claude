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
Implement the end-to-end integration test that exercises the full async workflow: engine dispatches an async task, agent produces output, Slack notification is posted, approval signal is received via polling, ApprovalManager records it, threshold is met, state transitions to APPROVED then DOING then COMPLETED. Also tests the rejection/rework cycle and timeout escalation. Uses mock adapters throughout.

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
```

## Implementation notes
- Test file: `tests/collaboration/integration/async-approval-flow.test.ts`
- Uses MockNotificationAdapter, MockDocumentAdapter, MockTaskTrackingAdapter, MockCodeReviewAdapter
- Mock adapter's signal injection: directly call the handler registered via startListener
- Verifies audit log entries in `.ai-sdd/sessions/<session>/audit-log.jsonl`
- CLI integration test (dev standard #7): `tests/collaboration/integration/cli-sync-command.test.ts`
- Must cover NFR-003 (auditability): verify every state transition is logged

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Audit log verified for all state transitions
- [ ] CLI integration test for the sync command (dev standard #7)
- [ ] No PII in logs
