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
Wire the CollaborationAdapterFactory, AsyncTaskManager, ApprovalManager, CollaborationEventBus, and AsyncAuditLog into the engine startup and dispatch paths. The engine must create the factory during initialization (when `collaboration.enabled = true`), inject adapters into the AsyncTaskManager, and route signals from the notification listener through the approval manager to the state machine.

## Acceptance criteria

```gherkin
Feature: Wire adapters into engine

  Scenario: Engine initializes collaboration subsystem when enabled
    Given workflow YAML with collaboration.enabled = true
    When the engine starts
    Then CollaborationAdapterFactory is created
    And validateCredentials is called (fail-fast)
    And AsyncTaskManager receives the notification adapter
    And CollaborationEventBus is connected to ObservabilityEventEmitter

  Scenario: Engine skips collaboration when disabled
    Given workflow YAML with collaboration.enabled = false
    When the engine starts
    Then no collaboration components are initialized
    And all tasks run in sync mode regardless of task-level mode config
```

## Implementation notes
- Modify `src/core/engine.ts` to conditionally initialize collaboration subsystem
- Factory creation: after config parsing, before task dispatch
- Event bus: forward all `collab.*` events to existing ObservabilityEventEmitter
- Audit log: `.ai-sdd/sessions/<session>/audit-log.jsonl` (append-only JSONL)
- Must not break existing sync-only workflows (collaboration.enabled defaults to false)
- Integration point test required (dev standard #2)

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Integration test: engine with mock adapters runs async task through full lifecycle
- [ ] Existing engine tests pass unchanged (backward compatibility)
