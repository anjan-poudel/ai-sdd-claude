# MCS-012: PlanningReviewOverlay

**Phase:** 3d
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-007 (for `phase` field on TaskDefinition)
**Effort:** 2.5d
**Ticket:** MCS-012

## Context

The highest-value feature from coding-standards. Prevents scope creep, missing AC coverage, and infeasible plans before a single line of code is written. Opt-in via `overlays.planning_review.enabled: false` default. Includes timeout handling (OD-9: fail-closed, 24h default).

## Scope

1. Create `src/overlays/planning-review/planning-review-overlay.ts` (new file).
2. Update `src/overlays/composition-rules.ts` overlay chain order.
3. Update `src/config/defaults.ts` with planning_review defaults.
4. `TaskOverlays.planning_review` already added in MCS-006.

## Config in ai-sdd.yaml

```yaml
overlays:
  planning_review:
    enabled: false           # opt-in
    reviewer_agent: reviewer
    phases: [planning, design]
    block_on_needs_work: true
    timeout_seconds: 86400   # 24h default; 0 = no timeout (for T2 tasks)
```

## Overlay Chain Update (composition-rules.ts)

```
HIL → PlanningReview → Evidence Gate → Agentic Review → Paired → Confidence → Dispatch
```

`buildOverlayChain` must insert PlanningReview after HIL. `validateOverlayCombination` must validate PlanningReview only present when `overlays.planning_review.enabled: true`.

## preTask Behaviour

1. Skip if task `phase` not in `phases` config (if phases not set → skip all tasks)
2. Build prompt: task definition + ACs + `scope_excluded` + `requirement_ids` + agent description
3. Dispatch to `reviewer_agent` via adapter
4. Apply timeout (`timeout_seconds`); if exceeded → treat as parse failure
5. Parse response for `{"planning_review": "APPROVED" | "NEEDS_WORK", "reason": "..."}` (OD-4)
6. Response cases:
   - `APPROVED` → `{ proceed: true }`
   - `NEEDS_WORK` → `{ proceed: false }` → task transitions to `NEEDS_REWORK`
   - Parse failure / timeout → emit `planning_review.parse_failure` event
     - if `block_on_needs_work: true` → treat as `NEEDS_WORK`
     - if `block_on_needs_work: false` → warn and proceed

## Timeout (OD-9)

- Fail-closed: timeout → parse failure → if `block_on_needs_work: true` → NEEDS_REWORK
- Override: `--waive-planning-review=<reason>` flag (reason recorded in audit log)

## Acceptance Criteria

- scenario: "APPROVED response → task proceeds"
  given: "planning_review enabled, task phase in phases config"
  when: "reviewer agent returns APPROVED"
  then:
    - "preTask returns { proceed: true }"
    - "Task dispatched normally"

- scenario: "NEEDS_WORK → NEEDS_REWORK"
  given: "planning_review enabled"
  when: "reviewer agent returns NEEDS_WORK"
  then:
    - "preTask returns { proceed: false }"
    - "Task transitions to NEEDS_REWORK with reviewer reason"

- scenario: "Parse failure + block_on_needs_work=true → NEEDS_REWORK"
  given: "reviewer returns unparseable response, block_on_needs_work: true"
  when: "preTask runs"
  then:
    - "planning_review.parse_failure event emitted"
    - "Task transitions to NEEDS_REWORK"

- scenario: "Parse failure + block_on_needs_work=false → warning, proceeds"
  given: "reviewer returns unparseable response, block_on_needs_work: false"
  when: "preTask runs"
  then:
    - "planning_review.parse_failure event emitted"
    - "preTask returns { proceed: true }"

- scenario: "Timeout → treated as parse failure"
  given: "timeout_seconds: 1, reviewer takes longer than 1s"
  when: "preTask runs"
  then:
    - "Timeout triggers parse failure path"

- scenario: "Task phase not in phases config → overlay skips"
  given: "phases: [planning, design], task with phase: implementation"
  when: "preTask runs"
  then:
    - "Overlay skips entirely (proceed: true without reviewer call)"

## Tests Required

- PlanningReviewOverlay: APPROVED → proceeds
- PlanningReviewOverlay: NEEDS_WORK → NEEDS_REWORK transition
- PlanningReviewOverlay: parse failure + block_on_needs_work=true → NEEDS_REWORK
- PlanningReviewOverlay: parse failure + block_on_needs_work=false → warning, proceeds
- PlanningReviewOverlay: timeout exceeded → parse failure path
- PlanningReviewOverlay: task phase=implementation, phases=[planning,design] → skips
- Composition rules: PlanningReview inserted after HIL, before Evidence Gate
- Integration: full workflow with PlanningReview enabled, planning task reviewed, implementation task not reviewed

## Dependency Section

**Blocked by:** MCS-007
**Blocks:** None (parallelisable with MCS-008/MCS-010)
