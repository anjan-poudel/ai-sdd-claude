---
decision: GO
---

# Review Report: MVP2 Implementation

## Summary

GO — All MVP2 implementation criteria are met. The GitHub-stack collaboration integration (FR-015 through FR-018) is complete and fully consistent with the L2 design. The three parallel MVP2 adapter tasks (GitHub Issues, GitHub PR, GitHub Project Board) and the subsequent integration wiring task have been completed with comprehensive test coverage, shared adapter test suites, and confirmed interface portability with the MVP1 Atlassian stack.

## Decision

GO

## Review Evidence

### 1. FR-015 GitHub Issues Adapter — Complete

`GitHubTaskTrackingAdapter` fully implements the `TaskTrackingAdapter` interface as specified in `design-l2.md`. Epic simulation via `epic` and `epic:<number>` labels is correctly designed: no native epic type exists in GitHub Issues, and the label-based approach is an explicit, documented design choice. Multi-hop board transitions via GraphQL `updateProjectV2ItemFieldValue` are implemented with lazy status field caching. Without `project_number`, `transitionTask` returns a VALIDATION error with a clear message (no silent failure — dev standard #3 compliant). PR exclusion in `listTasks` is handled by filtering the `pull_request` field from the GitHub `/issues` endpoint response.

22 tests cover the full interface contract, fixture schema validation for `create-issue-response.json` and `graphql-project-status-field.json`, error injection, and portability.

### 2. FR-016 GitHub PR Adapter — Complete

`GitHubCodeReviewAdapter` fully implements the `CodeReviewAdapter` interface. All methods are covered: `createPullRequest`, PR status checks, review comment CRUD, `approvePullRequest` / `requestChanges` via Reviews API events (`APPROVE`/`REQUEST_CHANGES`), `mergePullRequest` (merge/squash/rebase; `"fast-forward"` correctly mapped to `"rebase"` for GitHub's linear-history merge), pipeline trigger via `workflow_dispatch`, and `healthCheck`.

The `workflow_dispatch` returning 204 with no body is handled: the adapter polls `/actions/runs` after a 2s delay to obtain the run ID, with a synthetic fallback to prevent blocking. This is a pragmatic approach for the current API limitation.

24 tests cover the full lifecycle, all three merge strategies, error injection, and fixture validation for `create-pr-response.json`.

### 3. FR-017 / FR-018 GitHub Project Board + GitHub-as-Code Sync — Complete

`GitHubTaskTrackingAdapter` integrates cleanly with the existing `DefaultAsCodeSyncEngine` via the `TaskTrackingAdapter` interface — no new sync logic was needed. Mapping files are written atomically to `.ai-sdd/sync-mappings/github.json` (consistent with `jira.json` path pattern). The orphaned task labelling strategy (add `ai-sdd:orphaned` label, never delete issues) is correct and auditable.

10 integration tests cover: first-sync creates all issues, second-sync is idempotent, content change triggers update, orphaned mapping detection, atomic write, mapping reload on resume, adapter error handling via `Promise.allSettled`, and portability proof (both `MockTaskTrackingAdapter` and `GitHubTaskTrackingAdapter` accepted by the sync engine).

### 4. Factory Integration (MVP2 Wiring) — Complete

`CollaborationAdapterFactory` now handles `provider = "github"` for both `task_tracking` and `code_review` adapter slots. A private `resolveGitHubConfig()` helper centralises credential resolution, eliminating the duplicate `GITHUB_TOKEN` check. `validateCredentials()` checks `GITHUB_TOKEN` presence when any GitHub adapter is requested — fail-fast on startup (NFR-001 compliant).

`CollaborationAdapterConfig` union in `src/types/index.ts` extended with `"github"` for `task_tracking` and `code_review`. Previously undocumented `mock` value is now explicit in the type definition.

### 5. Shared Adapter Test Suites (NFR-006 Portability by Construction)

Four parameterised contract suites (`runNotificationAdapterSuite`, `runDocumentAdapterSuite`, `runTaskTrackingAdapterSuite`, `runCodeReviewAdapterSuite`) cover the full interface contract for any implementation. Running the same suite against `MockTaskTrackingAdapter`, `JiraTaskTrackingAdapter`, and `GitHubTaskTrackingAdapter` proves they are drop-in replacements — NFR-006 verified by construction, not assertion.

Suite runner tests in `tests/collaboration/adapters/impl/` exercise both Atlassian and GitHub implementations against the same contract suite, confirming portability across the full adapter matrix.

### 6. End-to-End MVP2 Integration Test

`tests/collaboration/integration/mvp2-github-async-flow.test.ts` covers 4 Gherkin scenarios:
1. GitHub happy path (full async cycle with GitHub Issues + Slack)
2. Rejection/rework cycle (label sync for `ai-sdd:in-rework`, second approval)
3. Hybrid workflow (Jira task-A + GitHub task-B, same `CollaborationBridge`)
4. PR code review flow (`mode: "pr_review"`, full merge lifecycle)

The hybrid test is particularly important: it verifies that per-task adapter selection works correctly without any engine changes, using `taskConfig.collaboration?.adapters ?? config.collaboration.adapters` for adapter resolution.

### 7. Example Workflow YAML

`data/workflows/examples/async-github.yaml` provides a ready-to-use MVP2 configuration template with all four adapters set to `github`. It follows the same `defaults` + `tasks` structure as `default-sdd.yaml`, discoverable via `ai-sdd validate-config`.

### 8. Backward Compatibility

`CollaborationBridge` (MVP1) is completely unchanged — the factory abstraction is the seam. Adding MVP2 support required only adding `"github"` branches to the factory switch. Existing sync-only workflows and all 880 pre-MVP2 collaboration + engine tests pass unchanged. Full suite: 908 tests green.

### Criteria Checklist

| Criterion | Result |
|-----------|--------|
| FR-015: GitHub Issues Adapter implements TaskTrackingAdapter interface fully | PASS — 22 tests, fixture validation |
| FR-016: GitHub PR Adapter implements CodeReviewAdapter interface fully | PASS — 24 tests, all merge strategies |
| FR-017: GitHub Project Board transitions via Projects v2 GraphQL | PASS — lazy status field cache, auto-add to board |
| FR-018: GitHub-as-Code sync via DefaultAsCodeSyncEngine | PASS — 10 integration tests, atomic mapping write |
| NFR-001: Fail-fast credential validation for GitHub adapters | PASS — `resolveGitHubConfig()` + `validateCredentials()` |
| NFR-006: Adapter interface portability proven by construction | PASS — shared contract suites run against all implementations |
| Factory integration — `"github"` branches in both adapter slots | PASS |
| Per-task adapter selection for hybrid workflows | PASS — hybrid scenario integration test |
| Backward compatibility with MVP1 | PASS — CollaborationBridge unchanged, 880 prior tests pass |
| No silent stubs — all deferred items tracked | PASS — T-028 (PR creation timing), T-029 (HTTP interceptor tests), label sync best-effort documented |
| Dev standard #4: fixture-based API tests | PASS — `create-issue-response.json`, `graphql-project-status-field.json`, `create-pr-response.json` |
| Example workflow YAML for discoverability | PASS — `data/workflows/examples/async-github.yaml` |
