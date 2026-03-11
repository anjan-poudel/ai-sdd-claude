# T-018: BitbucketCodeReviewAdapter -- PR Lifecycle

## Metadata
- **Group:** [TG-06 -- Bitbucket Integration](index.md)
- **Component:** BitbucketCodeReviewAdapter
- **Agent:** dev
- **Effort:** L
- **Risk:** MEDIUM
- **Depends on:** [T-005](../TG-02-adapter-framework/T-005-adapter-interfaces.md), [T-006](../TG-02-adapter-framework/T-006-retry-middleware.md)
- **Blocks:** T-019, T-020, T-024
- **Requirements:** [FR-011](../../../define-requirements/FR/FR-011-bitbucket-pr-review-flow.md)

## Description
Implement the BitbucketCodeReviewAdapter for the full PR lifecycle: create, get status, get/post review comments, approve, request changes, and merge. Supports configurable merge strategies (merge, squash, fast-forward). Incremental comment retrieval filters client-side by `created_on` timestamp. Health check via `GET /2.0/user`.

## Acceptance criteria

```gherkin
Feature: BitbucketCodeReviewAdapter PR lifecycle

  Scenario: Create a pull request
    Given valid Bitbucket credentials and a workspace/repo
    When createPullRequest is called with source and target branches
    Then POST /2.0/repositories/{workspace}/{repo}/pullrequests is called
    And a PRRef with provider = "bitbucket" is returned

  Scenario: Merge with squash strategy
    Given an open pull request
    When mergePullRequest is called with strategy = "squash"
    Then the merge API is called with merge_strategy = "squash"
    And MergeResult is returned with merged = true and commit_hash
```

## Implementation notes
- File: `src/collaboration/adapters/bitbucket/code-review-adapter.ts`
- Auth: Basic auth with `BITBUCKET_USERNAME:BITBUCKET_APP_PASSWORD`
- Merge strategy mapping: "merge" -> "merge_commit", "squash" -> "squash", "fast-forward" -> "fast_forward"
- Incremental comments: client-side `created_on >= since` filter (API lacks server-side date filter)
- API base: `https://api.bitbucket.org`

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Tests use captured Bitbucket API fixtures (dev standard #4)
- [ ] No credentials in log output
