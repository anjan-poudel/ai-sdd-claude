# T-025: Wire Adapters into Engine Config

## Metadata
- **Group:** [TG-08 -- End-to-End Integration](index.md)
- **Component:** Engine + CollaborationAdapterFactory
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** [T-002](../TG-01-core-async-engine/T-002-async-task-manager.md), [T-003](../TG-01-core-async-engine/T-003-approval-manager.md), [T-008](../TG-02-adapter-framework/T-008-adapter-factory.md)
- **Blocks:** T-026
- **Requirements:** [FR-003](../../../define-requirements/FR/FR-003-hybrid-workflow-execution.md), [FR-014](../../../define-requirements/FR/FR-014-end-to-end-async-collaboration-flow.md)

## Description
Wire the CollaborationAdapterFactory, NotificationChannel abstraction, ConfluenceSyncManager, and JiraHierarchySync into the CLI run command. The engine exposes lifecycle hooks (`on_workflow_start`, `on_task_start`, `on_post_task`, `on_hil_requested`, `on_failure`, `on_workflow_end`) that the run command uses to drive all collaboration side-effects. The engine itself remains collaboration-agnostic.

## Acceptance criteria

```gherkin
Feature: Wire adapters into run command

  Scenario: Collaboration subsystem initializes when enabled
    Given ai-sdd.yaml with collaboration.enabled = true
    When run.ts starts the engine
    Then CollaborationAdapterFactory is created
    And validateCredentials is called (fail-fast)
    And SlackNotificationChannel is created with mentionConfig from slack.mentions
    And ConfluenceSyncManager loads existing mappings
    And JiraHierarchySync ensures Epic + syncs Stories pre-run

  Scenario: Hooks post Slack messages at correct lifecycle points
    Given collaboration enabled with mock adapters
    When the engine runs a workflow
    Then on_workflow_start fires: "Workflow started" message published to MockNotificationChannel
    And on_task_start fires: "Task started: <id>" published
    And on_post_task fires: Confluence page published + "Task completed" message with artifact URL
    And on_workflow_end fires: Confluence index page updated + "Workflow completed" summary

  Scenario: HIL hook posts notification to approvers
    Given a task enters HIL_PENDING state
    When on_hil_requested hook fires
    Then a Slack message with hil_requested event is published
    And the message includes mentions for the approver role

  Scenario: Collaboration skipped when disabled
    Given ai-sdd.yaml with collaboration.enabled = false (or absent)
    When run.ts starts the engine
    Then no collaboration components are initialized
    And no hooks are registered on the engine
    And all tasks run in sync mode regardless of task-level mode config
```

## Implementation notes
- **Wiring location:** `src/cli/commands/run.ts` (not `engine.ts` — engine is collaboration-agnostic)
- **New engine hooks added to `src/core/hooks.ts`:**
  - `on_task_start` — fires before overlay chain, before `task.started` emitter
  - `on_workflow_start` — fires once after `workflow.started`, before first task
  - `on_workflow_end` — fires after all tasks complete/fail, after `workflow.completed`
  - `on_hil_requested` — fires when task enters HIL_PENDING (non-blocking void return)
- **NotificationChannel abstraction:** All Slack messages go through `SlackNotificationChannel.publish(ActivityMessage)`, not directly through `NotificationAdapter.postNotification`. This enables swapping providers.
- **ConfluenceSyncManager:** Publishes task output files as Confluence pages on `on_post_task`. Uses `task_id → PageRef` mapping for create-vs-update routing.
- **JiraHierarchySync:** Transitions Jira issues to matching statuses on `on_task_start` (→ "In Progress") and `on_post_task` (→ "Done" / "Blocked" on failure).
- **`mentions` config path:** `config.collaboration.slack.mentions` — validated by Zod as `Record<string, string[]>`
- Must not break existing sync-only workflows (`collaboration.enabled` defaults to false)
- Integration point test: `tests/collaboration/integration/collab-wiring.test.ts`

## Definition of done
- [x] Code reviewed and merged
- [x] All Gherkin scenarios covered by automated tests in `collab-wiring.test.ts`
- [x] Integration test: engine with mock adapters runs workflow; all 5 hook types fire
- [x] Existing engine tests pass unchanged (backward compatibility)
- [x] `src/core/hooks.ts` extended with 4 new hook events + convenience methods
