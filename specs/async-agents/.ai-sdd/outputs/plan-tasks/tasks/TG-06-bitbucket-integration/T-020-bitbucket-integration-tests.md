# T-020: Bitbucket Integration Tests with API Fixtures

## Metadata
- **Group:** [TG-06 -- Bitbucket Integration](index.md)
- **Component:** BitbucketCodeReviewAdapter (test suite)
- **Agent:** dev
- **Effort:** M
- **Risk:** LOW
- **Depends on:** [T-018](T-018-bitbucket-pr-adapter.md), [T-019](T-019-bitbucket-pipeline-trigger.md)
- **Blocks:** --
- **Requirements:** [NFR-005](../../../define-requirements/NFR/NFR-005-external-api-retry.md)

## Description
Write integration tests for the BitbucketCodeReviewAdapter using captured API fixtures. Tests cover PR creation, review comments, merge strategies, pipeline triggers, and error handling (auth failures, 404s, rate limits). Shared adapter test suite runs against both Mock and Bitbucket implementations.

## Acceptance criteria

```gherkin
Feature: Bitbucket integration tests

  Scenario: Tests validate PR response parsing against fixtures
    Given captured fixtures in tests/fixtures/bitbucket/
    When the adapter parses a create-pr-response fixture
    Then the PRRef is correctly extracted
    And the fixture format matches the actual Bitbucket API schema
```

## Implementation notes
- Fixtures: `tests/fixtures/bitbucket/create-pr-response.json`, `merge-response.json`, `pipeline-response.json`
- Test file: `tests/collaboration/adapters/impl/bitbucket.test.ts`
- Shared suite: `tests/collaboration/adapters/code-review-adapter.suite.ts`

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Fixtures captured from real Bitbucket API responses
