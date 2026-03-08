# MCS-013: AC Coverage Gate in complete-task Step 2.5

**Phase:** 3e
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-007, MCS-001
**Effort:** 1d
**Ticket:** MCS-013

## Context

When a task has `acceptance_criteria`, `complete-task` must validate that the submitted output explicitly reports `ac_coverage` in `handover_state`. Uncovered ACs transition to `NEEDS_REWORK` in enforce mode; emit events in warn mode. Governance off → check skipped.

## Scope

Update `src/cli/commands/complete-task.ts`: add Step 2.5 between sanitize (Step 2) and contract-validate (Step 3).

## Implementation

```typescript
// Step 2.5: AC coverage check (governance != "off")
const governanceMode = config.governance?.requirements_lock ?? "warn";
if (governanceMode !== "off") {
  const declaredACs = loadDeclaredACs(projectPath, taskId);
  if (declaredACs && declaredACs.length > 0) {
    const hs = handoverState as GatedHandoverState;
    const coverage = hs?.ac_coverage;
    if (!coverage) {
      if (governanceMode === "enforce") {
        return transitionToNeedsRework(taskId,
          `AC coverage not reported. Task has ${declaredACs.length} acceptance criteria but handover_state.ac_coverage is missing.`);
      } else {
        emitter.emit("governance.ac_coverage.missing", { task_id: taskId });
      }
    } else if (coverage.uncovered.length > 0) {
      const msg = `AC coverage incomplete: ${coverage.uncovered.join(", ")} (${coverage.claimed}/${coverage.total} covered)`;
      if (governanceMode === "enforce") {
        return transitionToNeedsRework(taskId, msg);
      } else {
        emitter.emit("governance.ac_coverage.incomplete", { task_id: taskId, uncovered: coverage.uncovered });
      }
    }
  }
}
```

`loadDeclaredACs` reads `acceptance_criteria` from the task definition in workflow YAML.

## Acceptance Criteria

- scenario: "Uncovered ACs + enforce → NEEDS_REWORK"
  given: "task with 3 ACs, ac_coverage.uncovered has 1 scenario, governance: enforce"
  when: "complete-task runs"
  then:
    - "Task transitions to NEEDS_REWORK"
    - "Feedback message lists uncovered scenarios"

- scenario: "Uncovered ACs + warn → event emitted, completes"
  given: "task with 3 ACs, ac_coverage.uncovered has 1 scenario, governance: warn"
  when: "complete-task runs"
  then:
    - "governance.ac_coverage.incomplete event emitted"
    - "Task completes successfully"

- scenario: "governance: off → AC check skipped"
  given: "governance: off, task with ACs, no ac_coverage in handover"
  when: "complete-task runs"
  then:
    - "No AC check runs"
    - "Task completes"

- scenario: "All ACs covered → no event, completes"
  given: "task with 2 ACs, ac_coverage.uncovered is empty"
  when: "complete-task runs"
  then:
    - "No event emitted"
    - "Task completes"

## Tests Required

- complete-task: AC coverage incomplete + enforce → NEEDS_REWORK with message
- complete-task: AC coverage incomplete + warn → event emitted, completes
- complete-task: governance off → AC check entirely skipped
- complete-task: all ACs covered → no event, completes
- complete-task: no acceptance_criteria on task → check skipped (no error)
- complete-task: ac_coverage missing entirely + enforce → NEEDS_REWORK

## Dependency Section

**Blocked by:** MCS-007, MCS-001
**Blocks:** None (Phase 3 complete)
