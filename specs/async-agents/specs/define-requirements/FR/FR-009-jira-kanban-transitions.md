# FR-009: Jira Agile Kanban Transitions

## Metadata
- **Area:** Jira Integration
- **Priority:** MUST
- **Source:** requirements.md "Jira transition will follow Agile Kanban workflow with appropriate swimlanes" / constitution.md "Agile Kanban workflow"

## Description
The system must map the async task state machine states to Jira Kanban board columns (swimlanes). When a task transitions state in the orchestrator (e.g., AWAITING_APPROVAL, APPROVED, DOING, DONE), the corresponding Jira issue must be transitioned to the mapped Kanban column. The column mapping must be configurable in the workflow YAML or adapter config. The adapter must handle Jira transition IDs correctly by querying available transitions before attempting a move.

## Acceptance criteria

```gherkin
Feature: Jira Agile Kanban transitions

  Scenario: Task state change triggers Jira transition
    Given a task "design-l1" mapped to Jira issue PROJ-42
    And the Kanban column mapping is: AWAITING_APPROVAL -> "In Review", DOING -> "In Progress", DONE -> "Done"
    When the orchestrator transitions "design-l1" from DOING to AWAITING_APPROVAL
    Then Jira issue PROJ-42 is transitioned to the "In Review" column

  Scenario: Custom column mapping is respected
    Given a custom column mapping in workflow YAML: APPROVED -> "Ready for Dev"
    When a task transitions to APPROVED
    Then the Jira issue moves to "Ready for Dev"

  Scenario: Transition to unavailable Jira status is handled
    Given a Jira issue in "To Do" status
    And the target column "In Review" requires an intermediate transition through "In Progress"
    When the adapter attempts the transition
    Then the adapter queries available transitions
    And performs the required intermediate transitions to reach "In Review"
```

## Related
- NFR: NFR-003 (State Transition Auditability)
- Depends on: FR-002, FR-008
