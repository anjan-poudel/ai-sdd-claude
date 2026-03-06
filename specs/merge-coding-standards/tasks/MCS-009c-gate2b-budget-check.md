# MCS-009c: Gate 2b — Budget Check in PolicyGateOverlay.postTask

**Phase:** 2.5
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-009b
**Effort:** 0.5d
**Ticket:** MCS-009c

## Context

Gate 2b enforces scope budgets declared on task definitions. The agent is expected to self-report metrics in `GatedHandoverState`. Missing metrics emit a warning in `warn` mode or fail in `enforce` mode.

## Scope

Add Gate 2b logic to `src/overlays/policy-gate/gate-overlay.ts` `postTask` method, after Gate 2.

## Implementation

```typescript
// Gate 2b: Budget check
const budget = ctx.task_definition.budget;
if (budget) {
  const hs = result.handover_state as GatedHandoverState | undefined;
  if (hs) {
    checkBudgetField("new_files_created", budget.max_new_files, hs.new_files_created, failures);
    checkBudgetField("loc_delta", budget.max_loc_delta, hs.loc_delta, failures);
    checkBudgetField("new_public_apis", budget.max_new_public_apis, hs.new_public_apis, failures);
  } else {
    emitter.emit("governance.handover_state.untyped", {
      task_id: ctx.task_id,
      reason: "Task has budget fields but agent did not populate GatedHandoverState fields",
    });
    if (governanceMode === "enforce") {
      failures.push("[Gate 2b] Budget declared but agent did not report metrics in handover_state");
    }
  }
}

// Helper (add to file):
function checkBudgetField(
  field: string,
  max: number | undefined,
  actual: number | undefined,
  failures: string[]
): void {
  if (max !== undefined && actual !== undefined && actual > max) {
    failures.push(`[Gate 2b] Budget exceeded: ${field}=${actual} (max ${max})`);
  }
}
```

## Acceptance Criteria

- scenario: "Budget exceeded → gate failure"
  given: "task with budget.max_new_files: 3, handover reports new_files_created: 5"
  when: "PolicyGateOverlay.postTask runs"
  then:
    - "Gate 2b failure added: 'Budget exceeded: new_files_created=5 (max 3)'"

- scenario: "Budget not exceeded → no failure"
  given: "task with budget.max_new_files: 5, handover reports new_files_created: 3"
  when: "PolicyGateOverlay.postTask runs"
  then:
    - "No gate failure"

- scenario: "Budget declared but no metrics in handover (warn mode) → event only"
  given: "governance: warn, task with budget, handover_state missing metrics"
  when: "PolicyGateOverlay.postTask runs"
  then:
    - "governance.handover_state.untyped event emitted"
    - "No gate failure"

- scenario: "Budget declared but no metrics in handover (enforce mode) → failure"
  given: "governance: enforce, task with budget, handover_state missing metrics"
  when: "PolicyGateOverlay.postTask runs"
  then:
    - "Gate 2b failure added"

## Tests Required

- Gate 2b: budget.max_new_files=3, actual=5 → failure
- Gate 2b: budget.max_new_files=3, actual=2 → no failure
- Gate 2b: budget declared, no handover, warn mode → untyped event, no failure
- Gate 2b: budget declared, no handover, enforce mode → failure
- Gate 2b: multiple budget fields, one exceeded → only exceeded field fails
- Integration: workflow with all Phase 2 features runs end-to-end without regression

## Dependency Section

**Blocked by:** MCS-009b
**Blocks:** Phase 3 (MCS-011)
