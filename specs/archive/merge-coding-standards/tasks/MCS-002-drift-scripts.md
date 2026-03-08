# MCS-002: Adapted Drift Scripts

**Phase:** 4.1
**Status:** READY
**Priority:** P1
**Dependencies:** MCS-009c, MCS-008 (Phase 2 + Phase 3 complete)
**Effort:** 1d
**Ticket:** MCS-002

## Context

Port and adapt `reproducibility-check.sh` and `semantic-drift-check.sh` from coding-standards into ai-sdd's `data/integration/scripts/`. These are copied by `ai-sdd init` into `.ai-sdd/scripts/`.

## Scope

1. Create `data/integration/scripts/reproducibility-check.sh`
2. Create `data/integration/scripts/semantic-drift-check.sh`

## Adaptations Required

### reproducibility-check.sh
- Check `.ai-sdd/requirements.lock.yaml` (not bare root path)
- Check `workflow-state.json` integrity
- Call `bun test` (not `./gradlew test`)
- Gate 0: use `ai-sdd traceability validate-lock` (not standalone hash file)

### semantic-drift-check.sh
- Gate 0: read `spec_hash` from `workflow-state.json` (via `ai-sdd traceability validate-lock`)
- Gate 2: read `scope_excluded` from workflow YAML tasks
- Replace Java/Kotlin tool calls with bun equivalents

## Acceptance Criteria

- scenario: "Scripts execute without error on valid project"
  given: "project with requirements.lock.yaml and workflow-state.json"
  when: "reproducibility-check.sh runs"
  then:
    - "Exit code 0"
    - "All gates pass"

- scenario: "Gate 0 fails when lock hash mismatches"
  given: "requirements.lock.yaml changed without acknowledgement"
  when: "semantic-drift-check.sh runs"
  then:
    - "Exit code non-zero"
    - "Gate 0 failure message displayed"

## Tests Required

- Script syntax: `bash -n` passes on both files (no syntax errors)
- Integration: `ai-sdd init` copies scripts to `.ai-sdd/scripts/`

## Dependency Section

**Blocked by:** MCS-009c, MCS-008
**Blocks:** MCS-003 (CI template references these scripts)
