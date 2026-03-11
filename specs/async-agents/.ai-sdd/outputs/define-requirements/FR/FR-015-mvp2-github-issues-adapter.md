# FR-015: [MVP2] GitHub Issues Adapter

## Metadata
- **Area:** GitHub Integration
- **Priority:** SHOULD
- **Source:** requirements.md "create abstraction on top of Github (using issue and project etc) to mimic Jira" / constitution.md "MVP 2 - GitHub Stack"

## Description
The system must provide a GitHub Issues adapter that mimics the Jira epic/sub-task model using GitHub Issues, labels, and milestones. Top-level task groups must be represented as GitHub Issues with an "epic" label. Individual tasks must be created as separate issues with a label referencing their parent epic (e.g., "epic:requirements"). The adapter must implement the same adapter interface as the Jira adapter (FR-008) so that workflows can target either backend without changes to workflow YAML beyond the adapter configuration. The adapter must support issue creation, update, closure, label management, and assignee mapping.

## Acceptance criteria

```gherkin
Feature: GitHub Issues adapter mimicking Jira

  Scenario: Task groups are created as epic-labelled issues
    Given a workflow YAML with 2 task groups and valid GitHub credentials
    When the engine syncs tasks to GitHub Issues
    Then 2 issues are created with the label "epic"
    And each issue title matches the task group name

  Scenario: Individual tasks are created with parent epic reference
    Given a task group "requirements" with 3 tasks
    When the engine syncs tasks to GitHub Issues
    Then 3 issues are created with the label "epic:requirements"
    And each issue title matches the task title

  Scenario: Same adapter interface as Jira
    Given a workflow previously configured for Jira
    When the adapter configuration is switched to GitHub Issues
    Then the workflow executes without modification to task definitions
    And all task tracking operations (create, update, transition) succeed
```

## Related
- NFR: NFR-001 (Adapter Pluggability), NFR-006 (Adapter Interface Portability)
- Depends on: FR-008 (shares interface contract)
