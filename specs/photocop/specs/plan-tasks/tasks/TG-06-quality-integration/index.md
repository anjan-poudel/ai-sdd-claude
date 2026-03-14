# TG-06: Quality & Integration

> **Jira Epic:** Quality & Integration

## Description
Delivers the full-pipeline integration test suite (including the 200-image accuracy benchmark for NFR-002) and the final QA sign-off gate. These tasks gate production readiness and must be completed after all implementation tasks in TG-02 through TG-05 are merged.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-020](T-020-full-pipeline-integration-test.md) | Full pipeline integration test and accuracy benchmark | L | T-016, T-020-fe | HIGH |
| [T-021](T-021-qa-sign-off.md) | QA sign-off and production readiness checklist | M | T-003, T-020 | MEDIUM |

## Group effort estimate
- Optimistic: 3 days
- Realistic: 4–5 days
