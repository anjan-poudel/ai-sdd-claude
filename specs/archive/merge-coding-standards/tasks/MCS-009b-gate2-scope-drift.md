# MCS-009b: Gate 2 — Scope Drift in PolicyGateOverlay.postTask

**Phase:** 2.4
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-009a
**Effort:** 0.5d
**Ticket:** MCS-009b

## Context

Gate 2 implements active scanning of agent output for excluded scope terms. It runs inside `PolicyGateOverlay.postTask`, after the existing T0/T1/T2 evidence checks. Uses `GatedHandoverState.raw_output` from MCS-006.

## Scope

Add Gate 2 logic to `src/overlays/policy-gate/gate-overlay.ts` `postTask` method.

## Implementation

```typescript
// Skip all governance gates when mode is "off"
const governanceMode = config.governance?.requirements_lock ?? "warn";
if (governanceMode === "off") {
  return existingResult; // early return — no governance gates run
}

// Gate 2: Scope excluded
const excluded = ctx.task_definition.scope_excluded ?? [];
if (excluded.length > 0) {
  const hs = result.handover_state as GatedHandoverState | undefined;
  const output = hs?.raw_output ?? "";
  if (output.length === 0 && excluded.length > 0) {
    emitter.emit("governance.gate2.no_raw_output", { task_id: ctx.task_id });
    // warn but don't fail — agent may not have populated raw_output
  } else {
    const violations = excluded.filter(term =>
      output.toLowerCase().includes(term.toLowerCase())
    );
    if (violations.length > 0) {
      failures.push(`[Gate 2] Scope drift: excluded terms found: ${violations.join(", ")}`);
    }
  }
}
```

## Acceptance Criteria

- scenario: "Excluded term found in output → gate failure"
  given: "task with scope_excluded: ['payment'], handover raw_output containing 'payment'"
  when: "PolicyGateOverlay.postTask runs"
  then:
    - "Gate 2 failure added to failures array"
    - "Task transitions to NEEDS_REWORK"

- scenario: "No raw_output → warning event only"
  given: "task with scope_excluded, handover_state with no raw_output"
  when: "PolicyGateOverlay.postTask runs"
  then:
    - "governance.gate2.no_raw_output event emitted"
    - "No gate failure added (warn not fail)"

- scenario: "governance: off → gate skipped"
  given: "governance.requirements_lock: off"
  when: "PolicyGateOverlay.postTask runs"
  then:
    - "Gate 2 code not reached (early return)"

## Tests Required

- Gate 2: task with `scope_excluded: ["payment"]`, output containing "payment" → gate failure
- Gate 2: task with `scope_excluded: ["payment"]`, output not containing "payment" → no failure
- Gate 2: task with `scope_excluded`, no `raw_output` → governance.gate2.no_raw_output event
- Gate 2: governance off → early return, no gate fires
- Gate 2: case-insensitive match ("Payment" matches "payment" exclusion)

## Dependency Section

**Blocked by:** MCS-009a
**Blocks:** MCS-009c
