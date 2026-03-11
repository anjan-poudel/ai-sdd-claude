# NFR-006: Adapter Interface Portability

## Metadata
- **Category:** Maintainability
- **Priority:** MUST

## Description
MVP 1 (Atlassian stack) and MVP 2 (GitHub stack) must share identical adapter interface contracts. The TaskTrackingAdapter interface used by Jira (FR-008, FR-009, FR-010) must be the same interface implemented by GitHub Issues/Projects (FR-015, FR-017, FR-018). The CodeReviewAdapter interface used by Bitbucket (FR-011, FR-012) must be the same interface implemented by GitHub PRs (FR-016). A workflow YAML must be able to switch between Atlassian and GitHub backends by changing only the adapter configuration block -- zero changes to task definitions, dependencies, or state machine configuration. Interface compatibility must be verified by automated tests that run the same test suite against both the Atlassian and GitHub adapter implementations: 100% of test cases must pass on both.

## Acceptance criteria

```gherkin
Feature: Adapter interface portability

  Scenario: TaskTrackingAdapter interface is identical for Jira and GitHub
    Given the JiraTaskTrackingAdapter and GitHubTaskTrackingAdapter implementations
    When both are checked against the TaskTrackingAdapter interface
    Then both implement 100% of the interface methods
    And the method signatures (parameters and return types) are identical

  Scenario: Workflow switches backend with config-only change
    Given a workflow YAML targeting Jira for task tracking
    When the adapter config block is changed to target GitHub Issues
    And no other workflow YAML changes are made
    Then the workflow executes successfully with GitHub Issues as the backend

  Scenario: Shared test suite passes for both backends
    Given the adapter integration test suite with N test cases
    When run against the Jira adapter
    Then N of N tests pass
    When run against the GitHub adapter
    Then N of N tests pass
```

## Related
- FR: FR-008, FR-009, FR-010, FR-011, FR-015, FR-016, FR-017, FR-018
