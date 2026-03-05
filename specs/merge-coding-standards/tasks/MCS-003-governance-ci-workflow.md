# MCS-003: Governance CI Workflow

**Phase:** A (Quality Gate Foundation)  
**Status:** DRAFT  
**Dependencies:** MCS-002  
**Size:** S (1 day)

## Context

The current repo has a Claude action workflow but no explicit governance gates for drift/reproducibility.

## Scope

1. Add a CI workflow under `.github/workflows/` for governance checks.
2. Run, at minimum:
   - typecheck
   - unit tests
   - reproducibility script
   - semantic drift script
3. Ensure workflow fails on gate violations.
4. Keep branch trigger scope practical (pull requests + manual dispatch).

## Acceptance Criteria

1. CI workflow appears and runs on PR.
2. Failing script exits fail the job.
3. Passing checks complete green.
4. Workflow logs clearly indicate which gate failed.

## Deliverables

1. `.github/workflows/<governance-gates>.yml`.
2. Minor doc updates linking local and CI gate commands.

