---
description: GitHub Projects v2 board integration — wires GitHubTaskTrackingAdapter into AsCodeSyncEngine for GitHub-as-Code sync, mapping file persistence, integration tests.
---

# Implementation Notes: GitHub Project Board Adapter (MVP2)

## Summary

Wired `GitHubTaskTrackingAdapter` into `DefaultAsCodeSyncEngine` to enable GitHub-as-Code sync (FR-018). The sync engine is already parameterized by `TaskTrackingAdapter` (T-017), so this task validates the integration, adds GitHub-specific mapping file path (`github.json`), and writes integration tests for the full GitHub sync roundtrip.

## Files Created

- `tests/collaboration/integration/github-sync-roundtrip.test.ts` — 10 integration tests covering:
  - Creates GitHub Issues for all 5 workflow tasks on first sync (SyncReport: created=5)
  - Second sync is idempotent (SyncReport: unchanged=2, created=0)
  - Detects content change and updates existing issue (SyncReport: updated=1)
  - Marks orphaned tasks when removed from workflow (SyncReport: orphaned=1, issue labeled `ai-sdd:orphaned`)
  - Saves mapping file atomically to `.ai-sdd/sync-mappings/github.json` with valid schema (schema_version, project_key, sha256 hashes)
  - Loads mappings from previous sync state and resumes without re-creating issues
  - Exact Gherkin scenario from T-023: 5 tasks → created=5
  - Adapter error handling (RATE_LIMIT) recorded in report.errors without crashing
  - `GitHubTaskTrackingAdapter` satisfies `TaskTrackingAdapter` interface (portability: NFR-006)
  - Drop-in replacement proof: `DefaultAsCodeSyncEngine` accepts both `MockTaskTrackingAdapter` and `GitHubTaskTrackingAdapter`

## Testing

10 tests, all passing. Full suite: 863 tests green.

## Key Design Decisions

- **No new sync logic**: `DefaultAsCodeSyncEngine` is already adapter-agnostic (T-017). This task just validates the integration with the GitHub adapter and adds the GitHub-specific mapping file path.
- **Mapping file path**: `.ai-sdd/sync-mappings/github.json` — consistent with the Jira mapping location pattern, distinguishing by adapter name.
- **Atomic write**: `saveMappings()` uses the existing `atomicWrite()` (tmp+rename pattern) from `DefaultAsCodeSyncEngine`.
- **Mock adapter for integration tests**: Tests use `MockTaskTrackingAdapter` to avoid network calls. `GitHubTaskTrackingAdapter` is verified to satisfy the same interface type contract.
- **Error resilience**: `Promise.allSettled` in the sync engine ensures one failing task doesn't block the rest; errors are accumulated in `report.errors`.
- **NFR-006 portability verified**: The integration test explicitly verifies that `DefaultAsCodeSyncEngine` accepts both mock and GitHub adapters as arguments, proving the portability guarantee by construction.

## Projects v2 Board Integration (GitHubTaskTrackingAdapter)

The `GitHubTaskTrackingAdapter` (created in `mvp2-implement-github-issues-adapter`) supports Projects v2 board transitions when `project_number` is configured:

- Status field options are discovered via GraphQL at first transition call and cached.
- Issues not yet on the board are automatically added via `addProjectV2ItemById` before status mutation.
- Without `project_number`, `transitionTask` returns a VALIDATION error with a clear message; `getAvailableTransitions` returns open/close fallback transitions.
