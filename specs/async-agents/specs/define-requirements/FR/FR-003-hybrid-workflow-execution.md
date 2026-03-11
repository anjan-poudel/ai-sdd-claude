# FR-003: Hybrid Workflow Execution

## Metadata
- **Area:** Workflow Engine
- **Priority:** MUST
- **Source:** requirements.md "workflow can be fully async or fully sync, or hybrid"

## Description
The workflow engine must support three execution modes at the workflow level: fully synchronous (all tasks sync), fully asynchronous (all tasks async), and hybrid (a mix of sync and async tasks). In hybrid mode, the engine must correctly manage the DAG dependency graph such that a sync task depending on an async task waits until the async task reaches DONE before starting. The engine must not deadlock when async and sync tasks are interleaved in the dependency graph.

## Acceptance criteria

```gherkin
Feature: Hybrid workflow execution

  Scenario: Fully synchronous workflow executes sequentially
    Given a workflow where all tasks have mode "sync"
    When the engine runs the workflow
    Then each task executes in dependency order
    And the engine blocks on each task until completion

  Scenario: Fully asynchronous workflow with approval gates
    Given a workflow where all tasks have mode "async"
    When the engine runs the workflow
    Then each task executes and enters AWAITING_APPROVAL
    And the engine waits for external approval signals before advancing each task

  Scenario: Hybrid workflow with sync task depending on async task
    Given a workflow with task A (async) and task B (sync) where B depends on A
    When the engine starts the workflow
    Then task A executes and enters AWAITING_APPROVAL
    And task B remains PENDING until task A reaches DONE
    And once task A is DONE, task B executes synchronously

  Scenario: Hybrid workflow does not deadlock
    Given a workflow with 3 tasks: A (async), B (sync, depends on A), C (async, depends on B)
    When the engine runs the workflow
    Then A completes its async cycle
    And B executes synchronously after A is DONE
    And C enters its async cycle after B completes
    And the workflow reaches completion
```

## Related
- NFR: none
- Depends on: FR-001, FR-002
