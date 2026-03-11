# T-024: Shared Adapter Test Suite (NFR-006 Portability)

## Metadata
- **Group:** [TG-07 -- GitHub Integration (MVP2)](index.md)
- **Component:** Shared adapter test suites
- **Agent:** dev
- **Effort:** M
- **Risk:** LOW
- **Depends on:** [T-018](../TG-06-bitbucket-integration/T-018-bitbucket-pr-adapter.md), [T-021](T-021-github-task-tracking-adapter.md), [T-022](T-022-github-code-review-adapter.md)
- **Blocks:** --
- **Requirements:** [NFR-006](../../../define-requirements/NFR/NFR-006-adapter-interface-portability.md)

## Description
Create parameterized test suites for each of the four adapter interfaces that run against all implementations (mock + real adapters). This proves NFR-006 (portability) by construction -- if a new adapter passes the shared suite, it is a valid replacement. Each suite tests the complete interface contract.

## Acceptance criteria

```gherkin
Feature: Shared adapter test suites

  Scenario: TaskTrackingAdapter suite runs against all implementations
    Given the parameterized TaskTrackingAdapter suite
    When it runs against MockTaskTrackingAdapter, JiraTaskTrackingAdapter, and GitHubTaskTrackingAdapter
    Then all implementations pass the same contract tests
    And any new adapter implementing the interface can reuse the suite
```

## Implementation notes
- Files: `tests/collaboration/adapters/notification-adapter.suite.ts`, `document-adapter.suite.ts`, `task-tracking-adapter.suite.ts`, `code-review-adapter.suite.ts`
- Each suite exports a function `runAdapterSuite(name: string, factory: () => AdapterInterface)`
- Real adapters tested with HTTP interceptors (no actual API calls in CI)
- Validates: happy path CRUD, error handling, Result types, healthCheck

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] All four suites pass against all implementations
- [ ] Suite is reusable for future adapter implementations
