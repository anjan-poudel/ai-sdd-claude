# MCS-005c: Planning Artefacts Convention in CLAUDE.md

**Phase:** 1.4
**Status:** READY
**Priority:** P1
**Dependencies:** MCS-005b
**Effort:** 0.5d
**Ticket:** MCS-005c

## Context

Planning outputs from BA/architect agents need a predictable location so the PlanningReviewOverlay (Phase 3) can find them. This is a naming convention only — documentation change.

## Scope

Add to `CLAUDE.md` the `plans/<feature-name>/` convention for planning artefacts.

## Content to Add

```
**Planning artefacts** — live in `plans/<feature-name>/` (tool-agnostic, versionable).
A plan directory contains: `spec.md` (feature spec), `plan.md` (task breakdown), optionally `tasks/*.md`.
```

## Acceptance Criteria

- scenario: "CLAUDE.md contains planning artefacts convention"
  given: "CLAUDE.md"
  when: "task completes"
  then:
    - "CLAUDE.md contains plans/<feature-name>/ convention section"

## Deliverables

1. Updated `CLAUDE.md` with planning artefacts convention

## Tests Required

- Documentation only — no automated tests required

## Dependency Section

**Blocked by:** MCS-005b
**Blocks:** None (Phase 1 complete)
