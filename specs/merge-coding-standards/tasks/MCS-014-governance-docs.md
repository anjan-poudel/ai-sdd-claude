# MCS-014: Governance Onboarding Documentation

**Phase:** 4.6
**Status:** READY
**Priority:** P2
**Dependencies:** MCS-009c, MCS-013 (governance features complete)
**Effort:** 1d
**Ticket:** MCS-014

## Context

User-facing documentation for all governance features. Can be an addition to `constitution.md` or a separate `data/integration/claude-code/GOVERNANCE.md`.

## Scope

Create `data/integration/claude-code/GOVERNANCE.md`.

## Required Coverage

1. **Governance modes**: `off`, `warn`, `enforce` — what each means, when to use
2. **AC declaration format**: Gherkin structure, required fields, examples
3. **Budget declaration**: `budget.max_new_files`, `max_loc_delta`, `max_new_public_apis`
4. **Traceability CLI usage**: all 4 subcommands with examples
5. **Lock file format**: `requirements.lock.yaml` structure, `spec_hash`, `locked_at`
6. **Phase routing setup**: config example, precedence rules
7. **Lock mode**: `greenfield` vs `brownfield` — effect on gap severity

## Acceptance Criteria

- scenario: "Documentation is comprehensive"
  given: "GOVERNANCE.md"
  when: "reviewed"
  then:
    - "All 7 required topics covered"
    - "At least one config example per feature"
    - "CLI examples are runnable (not pseudocode)"
    - "Governance modes section includes all three modes"

## Tests Required

- Documentation only — no automated tests

## Dependency Section

**Blocked by:** MCS-009c, MCS-013
**Blocks:** None
