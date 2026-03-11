# NFR-001: Adapter Pluggability

## Metadata
- **Category:** Maintainability
- **Priority:** MUST

## Description
All collaboration tool integrations (Slack, Confluence, Jira, Bitbucket, GitHub Issues, GitHub PRs, GitHub Projects) must be implemented behind well-defined TypeScript adapter interfaces. Each adapter interface must define a contract that is tool-agnostic, allowing new tool backends to be added by implementing the interface without modifying the workflow engine or orchestrator. There must be at least 4 distinct adapter interfaces: NotificationAdapter (Slack), DocumentAdapter (Confluence), TaskTrackingAdapter (Jira / GitHub Issues+Projects), and CodeReviewAdapter (Bitbucket / GitHub PRs). Adding a new adapter implementation must require zero changes to existing adapter code or engine code -- measured by verifying that no files outside the new adapter's directory are modified.

## Acceptance criteria

```gherkin
Feature: Adapter pluggability

  Scenario: New adapter implementation requires no engine changes
    Given the adapter interface for TaskTrackingAdapter
    When a new implementation "LinearAdapter" is created
    Then the new adapter file is the only file added or modified
    And the engine runs the workflow using "LinearAdapter" without code changes to engine.ts

  Scenario: At least 4 distinct adapter interfaces exist
    Given the adapter layer source code
    When the interfaces are enumerated
    Then at least 4 interfaces exist: NotificationAdapter, DocumentAdapter, TaskTrackingAdapter, CodeReviewAdapter
    And each interface defines at least 3 methods

  Scenario: Mock adapter satisfies interface for testing
    Given a MockTaskTrackingAdapter implementing TaskTrackingAdapter
    When the workflow engine is configured with the mock adapter
    Then the workflow executes end-to-end using the mock
    And all task tracking operations are recorded in the mock's call log
```

## Related
- FR: FR-004, FR-006, FR-008, FR-011, FR-015, FR-016, FR-017
