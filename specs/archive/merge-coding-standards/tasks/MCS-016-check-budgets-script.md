# MCS-016: check-budgets.sh — Out-of-Process Budget Verification

**Phase:** 4.4
**Status:** READY
**Priority:** P1
**Dependencies:** MCS-009c (budget gates exist)
**Effort:** 0.5d
**Ticket:** MCS-016

## Context

Out-of-process verification to catch agent self-reporting cheating. Reads `toolgate.yaml` budgets block, uses `git diff --stat` for actual metrics, exits non-zero on violation. Designed for CI use alongside Phase 2 in-engine budget gates.

## Scope

Create `data/integration/scripts/check-budgets.sh`.

## Checks

1. Read `toolgate.yaml` `budgets.scope` block for thresholds
2. `git diff --stat` → count new files created
3. `git diff --unified=0 | wc -l` → LOC delta
4. Grep for new public API signatures (exported functions/classes)
5. Compare against configured thresholds
6. Exit non-zero if any threshold exceeded

## Acceptance Criteria

- scenario: "Budget exceeded → non-zero exit"
  given: "toolgate.yaml with max_new_files_per_task: 3, git diff shows 5 new files"
  when: "check-budgets.sh runs"
  then:
    - "Exit code 1"
    - "Message identifies which budget was exceeded"

- scenario: "Budget not exceeded → zero exit"
  given: "toolgate.yaml thresholds, git diff within limits"
  when: "check-budgets.sh runs"
  then:
    - "Exit code 0"

## Tests Required

- Script syntax: `bash -n check-budgets.sh` (no syntax errors)
- Integration: `ai-sdd init` copies script to `.ai-sdd/scripts/`

## Dependency Section

**Blocked by:** MCS-009c
**Blocks:** None
