# T-021: GitHubTaskTrackingAdapter -- Issues + Projects

## Metadata
- **Group:** [TG-07 -- GitHub Integration (MVP2)](index.md)
- **Component:** GitHubTaskTrackingAdapter
- **Agent:** dev
- **Effort:** L
- **Risk:** MEDIUM
- **Depends on:** [T-005](../TG-02-adapter-framework/T-005-adapter-interfaces.md), [T-006](../TG-02-adapter-framework/T-006-retry-middleware.md), [T-017](../TG-05-jira-integration/T-017-as-code-sync-engine.md)
- **Blocks:** T-023, T-024
- **Requirements:** [FR-015](../../../define-requirements/FR/FR-015-mvp2-github-issues-adapter.md), [FR-017](../../../define-requirements/FR/FR-017-mvp2-github-project-board.md)

## Description
Implement the GitHubTaskTrackingAdapter that mirrors the TaskTrackingAdapter interface using GitHub Issues + Projects v2. Epics are simulated as Issues with an `epic` label. Child tasks get an `epic:<slug>` label. Board column transitions use GraphQL mutations on the Projects v2 status field. Health check via `GET /user`.

## Acceptance criteria

```gherkin
Feature: GitHubTaskTrackingAdapter

  Scenario: Create an epic as a labeled GitHub Issue
    Given valid GITHUB_TOKEN and a repo
    When createEpic is called
    Then a GitHub Issue is created with label "epic"
    And an IssueRef with provider = "github" is returned

  Scenario: Transition task via Projects v2 status field
    Given an issue linked to a GitHub Projects v2 board
    When transitionTask is called with targetStatus = "In Progress"
    Then a GraphQL updateProjectV2ItemFieldValue mutation is executed
    And the item's status field is updated
```

## Implementation notes
- File: `src/collaboration/adapters/github/task-tracking-adapter.ts`
- REST API for Issues CRUD, GraphQL for Projects v2 status transitions
- Auth: `Authorization: Bearer ${GITHUB_TOKEN}` for both REST and GraphQL
- Epic simulation: label-based grouping (no native Jira-style parent linking)
- `project_number` from config used to find the correct Projects v2 board
- Status field options discovered via GraphQL query (cached at startup)

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Tests use captured GitHub API fixtures (REST + GraphQL)
- [ ] Shared TaskTrackingAdapter test suite passes
