---
description: GitHub Issues task tracking adapter implementation — REST API + GraphQL for Projects v2, label-based epic simulation, fixture-based tests.
---

# Implementation Notes: GitHub Issues Adapter (MVP2)

## Summary

Implemented `GitHubTaskTrackingAdapter` — a full implementation of `TaskTrackingAdapter` using GitHub Issues + Projects v2. Epics are simulated via an `epic` label on issues; child tasks carry `epic:<number>` labels for parent linking. Board column transitions use GitHub GraphQL Projects v2 mutations.

## Files Created

- `src/collaboration/impl/github-task-tracking-adapter.ts` — Real GitHub REST + GraphQL adapter. Supports `createEpic`, `createTask` (with epic label linking), `updateTask` (PATCH via direct fetch), `transitionTask` (GraphQL `updateProjectV2ItemFieldValue`), `getTask`, `listTasks` (labels filter, excludes PRs), `addLabel`, `getAvailableTransitions` (GraphQL status field options), `healthCheck` (`GET /user`).

- `tests/collaboration/adapters/impl/` `github-issues.test.ts` — 22 tests covering:
  - Fixture schema validation for `create-issue-response.json` and `graphql-project-status-field.json`
  - Full MockTaskTrackingAdapter CRUD (same interface as GitHubTaskTrackingAdapter)
  - Epic creation with label, child task with parent link
  - Standalone task (no epic), field updates
  - Kanban transitions: direct and multi-hop (Backlog → Done)
  - VALIDATION error for impossible transitions
  - Label/status filters in listTasks
  - addLabel idempotency
  - getAvailableTransitions contract shape
  - NOT_FOUND and failOn error injection
  - GitHubTaskTrackingAdapter provider = "github"
  - `transitionTask` without project_number → VALIDATION error
  - `getAvailableTransitions` without project_number → open/close fallback

- `tests/fixtures/github/create-issue-response.json` — Captured GitHub Issues API response shape.
- `tests/fixtures/github/graphql-project-status-field.json` — Captured Projects v2 GraphQL status field shape.

## Testing

22 tests across 1 test file, all passing. Full suite: 863 tests green.

## Key Design Decisions

- **Epic simulation via labels**: GitHub has no native epic type. `epic` label marks epics; `epic:<issue-number>` label links child tasks to their parent. This mirrors Jira's parent-key semantics at the label level.
- **PATCH via direct fetch**: `RetryHttpClient` doesn't expose PATCH. The adapter calls `fetch` directly for issue updates; the `updateTask` path calls `patchIssue()` private helper with the same auth headers.
- **GraphQL for Projects v2**: Status field transitions require GraphQL `updateProjectV2ItemFieldValue`. The adapter lazily loads status field options on first `transitionTask` or `getAvailableTransitions` call and caches them in `statusFieldCache`. If no project board is configured (`project_number` is undefined), `transitionTask` returns a VALIDATION error with a clear message; `getAvailableTransitions` falls back to open/close transitions.
- **PR exclusion in listTasks**: GitHub's `/issues` endpoint returns pull requests. The adapter filters `pull_request` field to exclude them.
- **Auto-add to project**: If `transitionTask` is called for an issue not yet on the board, the adapter automatically calls `addProjectV2ItemById` before updating the status field.
