# MCS-004: Agent Constitution + Handover Reporting Instructions

**Phase:** 1.1
**Status:** READY
**Priority:** P0
**Dependencies:** None
**Effort:** 0.5d
**Ticket:** MCS-004

## Context

ai-sdd agent prompts focus on role and workflow but have no non-negotiable gold-plating prevention rules. A mandatory `constitution.md` plugs this gap at the prompt level. All 6 agent MD files must reference it.

## Scope

1. Create `data/integration/claude-code/agents/constitution.md` with the 9 non-negotiable rules.
2. Add a reference line to each of the 6 agent MD files: `sdd-architect.md`, `sdd-ba.md`, `sdd-dev.md`, `sdd-le.md`, `sdd-pe.md`, `sdd-reviewer.md`.

## Constitution Content (non-negotiable rules)

1. Treat `requirements.lock.yaml` as source of truth when present. Do not reinterpret or extend it.
2. Do not mark work complete unless all acceptance criteria are implemented and validated.
3. Surface blockers and deviations in `handover_state.blockers`.
4. No gold-plating: no unrequested features, logging, retries, caching, or error handling beyond the task definition.
5. Mandatory Planning Review before implementation; confidence score does not bypass it.
6. Every code change must trace to an AC in the task definition.
7. When `budget` fields present: report `new_files_created`, `loc_delta`, `new_public_apis` in `handover_state`.
8. When `acceptance_criteria` present: report `ac_coverage` as `{ claimed: N, total: M, uncovered: ["scenario-name", ...] }` in `handover_state`.
9. BA produces initial `requirements.lock.yaml`; Architect regenerates on drift; Human approves via HIL.

## Acceptance Criteria

- scenario: "constitution.md created with all 9 rules"
  given: "data/integration/claude-code/agents/ directory"
  when: "task completes"
  then:
    - "constitution.md exists with all 9 rules verbatim"
    - "All 6 agent MD files contain a reference line to constitution.md"
    - "Snapshot test passes: constitution.md content matches expected rules"

## Deliverables

1. `data/integration/claude-code/agents/constitution.md` (new file)
2. Updated: `sdd-architect.md`, `sdd-ba.md`, `sdd-dev.md`, `sdd-le.md`, `sdd-pe.md`, `sdd-reviewer.md`

## Tests Required

- Snapshot test: verify `constitution.md` content matches expected rules
- Presence test: all 6 agent MD files contain reference to constitution.md

## Dependency Section

**Blocked by:** None
**Blocks:** MCS-005a
