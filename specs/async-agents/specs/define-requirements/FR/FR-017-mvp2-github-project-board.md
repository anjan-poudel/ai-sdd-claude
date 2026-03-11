# FR-017: [MVP2] GitHub Project Board Adapter

## Metadata
- **Area:** GitHub Integration
- **Priority:** SHOULD
- **Source:** requirements.md "Github project" / constitution.md "GitHub abstraction mimicking Jira via Issues + Projects + Labels"

## Description
The system must provide a GitHub Projects (v2) adapter that creates and manages a project board for workflow task tracking. The adapter must create a project board with columns mapped to the async task state machine states (configurable mapping, similar to FR-009). When a task transitions state, the corresponding project item must move to the mapped column. The adapter must support creating project items from GitHub Issues (linked to FR-015) and managing custom fields for priority and assignee. The adapter must implement the same board/tracking interface as the Jira Kanban adapter.

## Acceptance criteria

```gherkin
Feature: GitHub Project board adapter

  Scenario: Project board is created with mapped columns
    Given a workflow configured for GitHub Projects
    And column mapping: AWAITING_APPROVAL -> "In Review", DOING -> "In Progress", DONE -> "Done"
    When the engine initializes the project board
    Then a GitHub Project is created with columns "In Review", "In Progress", and "Done"

  Scenario: Task state change moves project item
    Given a task "design-l1" linked to a GitHub Project item
    When the orchestrator transitions "design-l1" to AWAITING_APPROVAL
    Then the project item moves to the "In Review" column

  Scenario: Same interface as Jira board adapter
    Given a workflow configured for Jira Kanban boards
    When the adapter configuration is switched to GitHub Projects
    Then the workflow executes without modification to task definitions
```

## Related
- NFR: NFR-001 (Adapter Pluggability), NFR-006 (Adapter Interface Portability)
- Depends on: FR-009 (shares interface contract), FR-015
