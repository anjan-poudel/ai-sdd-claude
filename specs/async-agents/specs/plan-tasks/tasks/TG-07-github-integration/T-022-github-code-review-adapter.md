# T-022: GitHubCodeReviewAdapter -- PRs + Actions

## Metadata
- **Group:** [TG-07 -- GitHub Integration (MVP2)](index.md)
- **Component:** GitHubCodeReviewAdapter
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-005](../TG-02-adapter-framework/T-005-adapter-interfaces.md), [T-006](../TG-02-adapter-framework/T-006-retry-middleware.md)
- **Blocks:** T-024
- **Requirements:** [FR-016](../../../define-requirements/FR/FR-016-mvp2-github-pr-adapter.md)

## Description
Implement the GitHubCodeReviewAdapter for PR lifecycle management (create, review, merge) and GitHub Actions pipeline triggers. Approve and request-changes use the Reviews API with APPROVE/REQUEST_CHANGES events. Pipeline trigger via workflow_dispatch. Health check via `GET /user`.

## Acceptance criteria

```gherkin
Feature: GitHubCodeReviewAdapter PRs and Actions

  Scenario: Create a pull request
    Given valid GITHUB_TOKEN and a repo
    When createPullRequest is called with source and target branches
    Then POST /repos/{owner}/{repo}/pulls is called
    And a PRRef with provider = "github" is returned

  Scenario: Trigger a GitHub Actions workflow
    Given a workflow file ID
    When triggerPipeline is called with the branch
    Then POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches is called
    And a PipelineRef is returned
```

## Implementation notes
- File: `src/collaboration/adapters/github/code-review-adapter.ts`
- Auth: `Authorization: Bearer ${GITHUB_TOKEN}`
- Approve: POST reviews with event = "APPROVE"
- Request changes: POST reviews with event = "REQUEST_CHANGES"
- Merge strategies: merge/squash/rebase mapped to GitHub merge method
- Actions trigger: requires `actions:write` scope on token

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Tests use captured GitHub API fixtures
- [ ] Shared CodeReviewAdapter test suite passes
