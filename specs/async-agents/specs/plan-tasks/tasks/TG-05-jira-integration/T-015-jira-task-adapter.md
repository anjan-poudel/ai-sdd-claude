# T-015: JiraTaskTrackingAdapter -- Epic/Story/Subtask CRUD

## Metadata
- **Group:** [TG-05 -- Jira Integration](index.md)
- **Component:** JiraTaskTrackingAdapter
- **Agent:** dev
- **Effort:** L
- **Risk:** MEDIUM
- **Depends on:** [T-005](../TG-02-adapter-framework/T-005-adapter-interfaces.md), [T-006](../TG-02-adapter-framework/T-006-retry-middleware.md)
- **Blocks:** T-016, T-017
- **Requirements:** [FR-008](../../../define-requirements/FR/FR-008-jira-epic-subtask-creation.md)

## Description
Implement the JiraTaskTrackingAdapter for creating epics, stories, and subtasks via the Jira REST API v3. Handles epic linking via parent field, label management, JQL-based listing, and task field updates. Description formatting uses minimal ADF (Atlassian Document Format). Health check via `/rest/api/3/myself`.

## Acceptance criteria

```gherkin
Feature: JiraTaskTrackingAdapter CRUD

  Scenario: Create an epic with labels
    Given valid Jira credentials and project key
    When createEpic is called with summary, description, and labels
    Then POST /rest/api/3/issue is called with issue type from config
    And the created issue has the specified labels
    And an IssueRef with provider = "jira" is returned

  Scenario: Create a task linked to an epic
    Given an existing epic IssueRef
    When createTask is called with the epicRef
    Then the created issue has parent set to the epic key
```

## Implementation notes
- File: `src/collaboration/adapters/jira/task-tracking-adapter.ts`
- Auth: Basic auth with `JIRA_USER_EMAIL:JIRA_API_TOKEN`
- ADF conversion: minimal -- paragraph nodes with text, best-effort for complex content
- Issue types read from `collaboration.jira.issue_types` config (default: epic="Epic", task="Story")
- JQL for listTasks: `project = {key} AND labels in ({labels}) AND status = "{status}"`

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Tests use captured Jira API fixtures (dev standard #4)
- [ ] No credentials in log output
