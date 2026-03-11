# TG-06: Bitbucket Integration

> **Jira Epic:** Bitbucket Integration

## Description
Implements the BitbucketCodeReviewAdapter for PR lifecycle management (create, review, merge), pipeline triggering, and integration tests against captured Bitbucket API fixtures. Covers FR-011 and FR-012.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-018](T-018-bitbucket-pr-adapter.md) | BitbucketCodeReviewAdapter -- PR Lifecycle | L | T-005, T-006 | MEDIUM |
| [T-019](T-019-bitbucket-pipeline-trigger.md) | Bitbucket Pipeline Trigger | S | T-018 | LOW |
| [T-020](T-020-bitbucket-integration-tests.md) | Bitbucket Integration Tests with API Fixtures | M | T-018, T-019 | LOW |

## Group effort estimate
- Optimistic (full parallel): 2 days
- Realistic (2 devs): 3 days
