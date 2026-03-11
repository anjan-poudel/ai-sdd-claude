---
description: GitHub PR code review adapter implementation — REST API for PR lifecycle, Reviews API for approve/request-changes, Actions dispatch for pipeline triggers, fixture-based tests.
---

# Implementation Notes: GitHub PR Adapter (MVP2)

## Summary

Implemented `GitHubCodeReviewAdapter` — a full implementation of `CodeReviewAdapter` using GitHub REST API v3 for PR lifecycle management and GitHub Actions for pipeline triggers. Approve/request-changes use the Reviews API with `APPROVE`/`REQUEST_CHANGES` events. Pipeline trigger uses `workflow_dispatch` with a run-ID lookup.

## Files Created

- `src/collaboration/impl/github-code-review-adapter.ts` — Real GitHub REST adapter. Supports `createPullRequest`, `getReviewComments` (client-side `since` filtering), `postReviewComment` (inline via issue comments endpoint), `approvePullRequest` (`event: APPROVE`), `requestChanges` (`event: REQUEST_CHANGES`), `mergePullRequest` (merge/squash/rebase methods), `getPullRequestStatus`, `triggerPipeline` (workflow_dispatch + polling), `getPipelineStatus`, `healthCheck` (`GET /user`).

- `tests/collaboration/adapters/impl/` `github-pr.test.ts` — 24 tests covering:
  - Fixture schema validation for `create-pr-response.json`
  - Full MockCodeReviewAdapter lifecycle (same interface as GitHubCodeReviewAdapter)
  - PR create, status check, merge (all 3 strategies: squash/merge/fast-forward)
  - Review comment CRUD and `since` timestamp filtering
  - Approve and request-changes operations
  - Pipeline trigger and status poll + `setPipelineStatus` helper
  - NOT_FOUND for unknown PR ref
  - failOn error injection
  - healthCheck
  - GitHubCodeReviewAdapter provider = "github"
  - Full PR lifecycle integration test (create→approve→merge→verify)
  - Request-changes comment recording
  - Pipeline trigger + status poll cycle

- `tests/fixtures/github/create-pr-response.json` — Captured GitHub PRs API response shape.

## Testing

24 tests across 1 test file, all passing. Full suite: 863 tests green.

## Key Design Decisions

- **Merge method mapping**: GitHub uses `merge`/`squash`/`rebase` (not `fast-forward`). Our interface uses `"fast-forward"` → mapped to `"rebase"` (GitHub's rebasing merge, which produces a fast-forward-like linear history).
- **PUT for merge**: GitHub uses `PUT /pulls/{number}/merge`. `RetryHttpClient.put()` handles this correctly.
- **Review comments via issue comments endpoint**: Full inline review comments require a commit SHA and diff position calculation. For simplicity, inline comments are posted to the issue comments endpoint with a `[file:line]` prefix. A future enhancement could use the PR review diff API.
- **Pipeline trigger with run-ID lookup**: `workflow_dispatch` returns 204 with no body. The adapter polls `/actions/runs?branch=...&per_page=1` after a 2s delay to get the latest run ID. If the poll fails (e.g. network issue), a synthetic ID using `${branch}-${Date.now()}` is returned to avoid blocking.
- **Client-side `since` filtering**: GitHub's pull request review comments endpoint doesn't support date filtering. The adapter filters client-side.
- **`parseRepo` helper**: Accepts both `"owner/repo"` and bare repo name (falls back to instance owner).
