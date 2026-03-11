# FR-001: Async/Sync Task Mode Configuration

## Metadata
- **Area:** Workflow Engine
- **Priority:** MUST
- **Source:** constitution.md "Async task mode" / requirements.md "Allow the workflow tasks to be configured either as sync or async"

## Description
The workflow engine must allow each task to be individually configured as either `sync` or `async` via the workflow YAML definition. A `sync` task executes inline and blocks the engine until completion (existing behaviour). An `async` task executes, posts its output to collaboration tools, and transitions to an awaiting-approval state until external signals advance it. The task-level `mode` field must default to `sync` to preserve backward compatibility with existing workflows.

## Acceptance criteria

```gherkin
Feature: Async/Sync task mode configuration

  Scenario: Task configured as async enters awaiting state after execution
    Given a workflow YAML with a task whose mode is set to "async"
    When the engine executes that task
    Then the task output is produced
    And the task transitions to AWAITING_APPROVAL state
    And the engine does not block waiting for the task to complete

  Scenario: Task configured as sync blocks until completion
    Given a workflow YAML with a task whose mode is set to "sync"
    When the engine executes that task
    Then the engine blocks until the task completes
    And the task transitions directly to DONE upon completion

  Scenario: Task with no mode specified defaults to sync
    Given a workflow YAML with a task that does not specify a mode field
    When the engine loads the workflow
    Then the task mode is resolved as "sync"
```

## Related
- NFR: NFR-001 (Adapter Pluggability)
- Depends on: none
