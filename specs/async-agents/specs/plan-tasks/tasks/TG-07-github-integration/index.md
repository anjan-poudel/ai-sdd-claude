# TG-07: GitHub Integration (MVP2)

> **Jira Epic:** GitHub Integration (MVP2)

## Description
Implements the GitHub adapters that mirror the Atlassian adapter interfaces: GitHubTaskTrackingAdapter (Issues + Projects v2 for epic simulation), GitHubCodeReviewAdapter (PRs + Actions), GitHub-as-Code sync reusing the AsCodeSyncEngine, and a shared adapter test suite to verify NFR-006 portability. Covers FR-015 through FR-018.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-021](T-021-github-task-tracking-adapter.md) | GitHubTaskTrackingAdapter -- Issues + Projects | L | T-005, T-006, T-017 | MEDIUM |
| [T-022](T-022-github-code-review-adapter.md) | GitHubCodeReviewAdapter -- PRs + Actions | M | T-005, T-006 | MEDIUM |
| [T-023](T-023-github-as-code-sync.md) | GitHub-as-Code Sync (Reuse AsCodeSyncEngine) | M | T-017, T-021 | LOW |
| [T-024](T-024-shared-adapter-test-suite.md) | Shared Adapter Test Suite (NFR-006 Portability) | M | T-018, T-021, T-022 | LOW |

## Group effort estimate
- Optimistic (full parallel): 3 days
- Realistic (2 devs): 5 days
