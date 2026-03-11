---
description: Bitbucket code review adapter implementation — REST 2.0 adapter with merge strategies, pipeline support, mock test double, and fixture-based tests.
---

# Implementation Notes: Bitbucket Code Review Adapter

## Summary

Implemented the Bitbucket Cloud code review adapter (real + mock) with merge strategy support and pipeline triggering.

## Files Created

- `src/collaboration/impl/bitbucket-code-review-adapter.ts` — Real Bitbucket Cloud REST 2.0 adapter. Supports createPullRequest, getPullRequestStatus, mergePullRequest (fast-forward/squash/merge), postReviewComment, getReviewComments, approvePullRequest, requestChanges, triggerPipeline, getPipelineStatus, healthCheck.
- `src/collaboration/impl/mock-code-review-adapter.ts` — In-memory test double with PR lifecycle management, pipeline simulation, `failOn` error injection, and `since`-based comment filtering.

## Testing

Tests in `tests/collaboration/adapters/impl/bitbucket.test.ts`:
- Full PR lifecycle (create, status check, merge, verify merged status)
- Review comment CRUD and `since` filtering
- Approve and request-changes operations
- Pipeline trigger and status poll
- Health check
- NOT_FOUND error
- Error injection via `failOn` option
- Fixture validation against `tests/fixtures/bitbucket/create-pr-response.json`

## Key Design Decisions

- Merge strategy `"fast-forward"` maps to Bitbucket API name `"fast_forward"` (underscore, not hyphen).
- Client-side `since` filtering on review comments (Bitbucket API does not support date filtering on the comments endpoint).
- `file_path` and `line` on ReviewComment use spread pattern to stay `exactOptionalPropertyTypes`-safe.
- `parseRepo()` safely splits `"workspace/repo"` format with undefined fallback.
