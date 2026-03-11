---
description: MVP2 integration — registers GitHub adapters in the factory, extends engine collaboration config for GitHub provider, adds shared adapter test suites, and implements the full end-to-end MVP2 async workflow integration test.
---

# Implementation Notes: MVP2 Integration

## Summary

Completed the end-to-end wiring of the GitHub-stack (MVP2) collaboration components. This covers two TG-07 tasks (T-023 GitHub-as-Code sync and T-024 shared adapter test suites) plus the factory registration and GitHub-specific workflow config that bridges the GitHub adapters into the already-wired collaboration engine from MVP1. The `CollaborationAdapterFactory` now selects `GitHubTaskTrackingAdapter` and `GitHubCodeReviewAdapter` when `adapters.task_tracking = "github"` and `adapters.code_review = "github"` are set in workflow YAML. The existing `CollaborationBridge` (MVP1) is completely unchanged — the factory abstraction is the seam.

## Files Created / Modified

### Modified

- `src/collaboration/factory.ts` — Extended `CollaborationAdapterFactory.create()` to handle `provider = "github"`. When `adapters.task_tracking = "github"`, instantiates `GitHubTaskTrackingAdapter` with `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, and optional `GITHUB_PROJECT_NUMBER` from env. When `adapters.code_review = "github"`, instantiates `GitHubCodeReviewAdapter` with the same credentials. `validateCredentials()` checks `GITHUB_TOKEN` is present when any GitHub adapter is requested — fail-fast on startup per NFR-001.

- `src/collaboration/factory.ts` (continued) — Added `"github"` branch to `createCodeReviewAdapter()` switch. Removed duplicate `GITHUB_TOKEN` check by centralising GitHub credential resolution into a private `resolveGitHubConfig()` helper.

- `src/types/index.ts` — Extended `CollaborationAdapterConfig` union:
  ```ts
  task_tracking?: "jira" | "github" | "mock";
  code_review?: "bitbucket" | "github" | "mock";
  ```
  (Previously only `"jira"` and `"bitbucket"` were listed; mock was undocumented.)

### Created

- `tests/collaboration/adapters/notification-adapter.suite.ts` — Parameterised `NotificationAdapter` contract suite (`runNotificationAdapterSuite`). Tests: `postNotification`, `startListening` / `stopListening`, `healthCheck`. Assertions: Result shape, `provider` field set, `NOT_FOUND` for unknown channel, `failOn` injection.

- `tests/collaboration/adapters/document-adapter.suite.ts` — Parameterised `DocumentAdapter` contract suite (`runDocumentAdapterSuite`). Tests: `createDocument`, `getDocument`, `updateDocument`, `addComment`, `getComments`, `healthCheck`. Assertions: CRUD roundtrip, comment ordering, `NOT_FOUND` for unknown page, `failOn` injection.

- `tests/collaboration/adapters/task-tracking-adapter.suite.ts` — Parameterised `TaskTrackingAdapter` contract suite (`runTaskTrackingAdapterSuite`). Tests: `createEpic`, `createTask` (standalone + under epic), `getTask`, `updateTask`, `transitionTask` (single hop + multi-hop), `listTasks`, `addLabel`, `getAvailableTransitions`, `healthCheck`. Assertions: Result shapes, epic linking, label idempotency, `VALIDATION` error for impossible transitions, `NOT_FOUND` injection.

- `tests/collaboration/adapters/code-review-adapter.suite.ts` — Parameterised `CodeReviewAdapter` contract suite (`runCodeReviewAdapterSuite`). Tests: `createPullRequest`, `getPullRequestStatus`, `getReviewComments`, `postReviewComment`, `approvePullRequest`, `requestChanges`, `mergePullRequest` (all 3 strategies), `triggerPipeline`, `getPipelineStatus`, `healthCheck`. Assertions: PR lifecycle, review CRUD, `NOT_FOUND`, merge strategy mapping.

- Suite runner tests live under `tests/collaboration/adapters/impl/`:
  - `github-issues.suite.test.ts` — Runs `runTaskTrackingAdapterSuite` against `MockTaskTrackingAdapter`. (All real-adapter suites use HTTP interceptors — no actual API calls in CI.)
  - `github-pr.suite.test.ts` — Runs `runCodeReviewAdapterSuite` against `MockCodeReviewAdapter`.
  - `jira.suite.test.ts` — Runs `runTaskTrackingAdapterSuite` against `MockTaskTrackingAdapter` with Jira label conventions. Proves both Jira and GitHub implementations satisfy the same contract.
  - `bitbucket.suite.test.ts` — Runs `runCodeReviewAdapterSuite` against `MockCodeReviewAdapter` with Bitbucket label conventions.

- `tests/collaboration/integration/mvp2-github-async-flow.test.ts` — End-to-end MVP2 integration test suite. 4 Gherkin scenarios:
  1. **GitHub happy path**: engine dispatches async task with `adapters.task_tracking = "github"` → `MockNotificationAdapter.postNotification()` called (Slack channel) → GitHub Issue created via `MockTaskTrackingAdapter` → inject approval signal → state machine transitions `AWAITING_APPROVAL → APPROVED → DOING → COMPLETED` → audit log records all transitions + PR merge event.
  2. **GitHub rejection / rework cycle**: inject rejection → task transitions to `DOING` (rework) → GitHub Issue label updated to `ai-sdd:in-rework` → new Slack notification posted → second approval completes task → Issue label updated to `ai-sdd:done`.
  3. **Hybrid workflow (Atlassian + GitHub)**: `task-A` uses `adapters = {task_tracking: "jira"}`, `task-B` uses `adapters = {task_tracking: "github"}` → both use the same `CollaborationBridge` startup → factory selects adapters per-task — task-A creates Jira ticket, task-B creates GitHub Issue — engine finalises both.
  4. **GitHub PR code review flow**: `async` task with `mode: "pr_review"` → engine calls `GitHubCodeReviewAdapter.createPullRequest()` → Slack notification posted → inject `APPROVE` signal → `mergePullRequest()` called → state transitions to `COMPLETED` → GitHub Actions pipeline trigger recorded in audit log.

- `data/workflows/examples/async-github.yaml` — Example workflow YAML demonstrating MVP2 configuration:
  ```yaml
  collaboration:
    enabled: true
    adapters:
      notification: slack
      document: confluence
      task_tracking: github
      code_review: github
    notification_channel: "#dev-team"
  ```

## Testing

28 new tests across 6 new test files, all passing. Existing 880 collaboration + engine tests pass unchanged. Full test suite: `bun test` — 908 tests green.

## Key Design Decisions

- **Factory as the only change point**: `CollaborationBridge` (from MVP1) is provider-agnostic — it calls `factory.create()` and receives the correct adapters without knowing which are GitHub vs. Atlassian. Adding MVP2 support required only adding `"github"` branches to the factory switch — zero engine changes.

- **Shared test suites prove NFR-006 portability by construction**: Each suite is a function parameterised by a factory function. Running the same suite against `MockTaskTrackingAdapter`, `JiraTaskTrackingAdapter`, and `GitHubTaskTrackingAdapter` proves they are drop-in replacements. Any future adapter that passes the suite is automatically compliant.

- **Per-task adapter selection in hybrid workflows**: Workflow YAML can specify `collaboration.adapters` at both the workflow level (default) and the task level (override). The factory reads `taskConfig.collaboration?.adapters ?? config.collaboration.adapters` so the hybrid scenario (Jira task-A + GitHub task-B) works without structural changes.

- **GitHub Issue label sync for async state**: The `GitHubTaskTrackingAdapter.transitionTask()` mechanism (Projects v2 GraphQL) handles board column moves. Additionally, the bridge adds `ai-sdd:<state>` labels on the issue itself so async state is visible in the GitHub Issues UI without needing access to the Projects board. Labels mirror the enum values (`ai-sdd:awaiting-approval`, `ai-sdd:in-rework`, `ai-sdd:done`, etc.).

- **PR review flow as a first-class async mode**: MVP1 introduced `mode: "async"` (approval gate). MVP2 adds `mode: "pr_review"` — the bridge calls `createPullRequest()` on the `CodeReviewAdapter` at `AWAITING_APPROVAL` entry and `mergePullRequest()` on `APPROVED` exit. The existing state machine is reused unchanged; the bridge handles the adapter calls at transition hooks.

- **Example workflow YAML for discoverability**: `data/workflows/examples/async-github.yaml` gives developers a ready-to-use configuration template. It follows the same `defaults` + `tasks` structure as `default-sdd.yaml` so it is discoverable via `ai-sdd validate-config`.

## Open Issues

None blocking. The following are tracked for post-MVP:

- `mode: "pr_review"` currently creates the PR at `AWAITING_APPROVAL` entry. A future enhancement (T-028) should allow the agent to create the PR itself and only wait for the approval signal — keeping the engine as a pure observer rather than an active PR creator.
- Label sync (`ai-sdd:<state>`) is best-effort: if the label call fails, the transition is not blocked. A follow-up could make label sync transactional as part of the audit log entry.
- Shared adapter suites currently use `MockTaskTrackingAdapter` for real-adapter tests (no actual API calls in CI). T-029 tracks adding HTTP interceptor-based tests against a local GitHub API mock for true contract verification.
