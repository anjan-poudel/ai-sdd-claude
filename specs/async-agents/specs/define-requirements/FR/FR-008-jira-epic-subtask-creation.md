# FR-008: Jira Epic and Sub-Task Creation

## Metadata
- **Area:** Jira Integration
- **Priority:** MUST
- **Source:** requirements.md "Agents will follow the Jira model closely. It will mimic Epics and Sub-Tasks" / constitution.md "Jira (task tracking, Agile Kanban workflow, epics/sub-tasks)"

## Description
The system must provide a Jira adapter that creates epics and sub-tasks in a configured Jira project. When a workflow is loaded, each top-level task group must be represented as a Jira epic, and individual tasks within the group must be created as sub-tasks (or stories) linked to their parent epic. The adapter must set standard fields: summary, description, assignee (mapped from agent role), priority, and labels. Issue types must be configurable to accommodate project-specific Jira schemes.

## Acceptance criteria

```gherkin
Feature: Jira epic and sub-task creation

  Scenario: Workflow task groups are created as Jira epics
    Given a workflow YAML with 2 task groups and valid Jira credentials
    When the engine syncs tasks to Jira
    Then 2 epics are created in the configured Jira project
    And each epic summary matches the task group name

  Scenario: Individual tasks are created as sub-tasks under their epic
    Given a task group "requirements" with 3 tasks
    When the engine syncs tasks to Jira
    Then 3 sub-tasks are created under the "requirements" epic
    And each sub-task summary matches the task title

  Scenario: Duplicate creation is prevented on re-sync
    Given tasks have already been synced to Jira
    When the engine syncs the same workflow again
    Then no duplicate epics or sub-tasks are created
    And existing issues are updated if task metadata has changed
```

## Related
- NFR: NFR-001 (Adapter Pluggability)
- Depends on: FR-010
