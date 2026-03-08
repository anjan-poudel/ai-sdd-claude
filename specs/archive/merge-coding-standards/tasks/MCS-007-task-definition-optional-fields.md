# MCS-007: Optional Fields on TaskDefinition + Zod Schema for Workflow YAML

**Phase:** 2 (supporting)
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-006, MCS-001
**Effort:** 1d
**Ticket:** MCS-007

## Context

The new optional fields added to `TaskDefinition` in MCS-006 (types only) must now be wired into the workflow YAML loader so they are parsed, validated, and available at runtime. This makes `acceptance_criteria`, `scope_excluded`, `budget`, `phase`, and `requirement_ids` usable in workflows.

## Scope

1. Update `src/core/workflow-loader.ts` to parse and validate the new TaskDefinition fields.
2. Add Zod schema for the full TaskDefinition (including new optional fields) to the YAML loading pipeline.
3. Ensure the 4-layer merge (engine defaults → workflow defaults → task library → task inline) handles the new fields correctly.
4. Update any relevant test fixtures to confirm new fields round-trip through the loader.

## Acceptance Criteria

- scenario: "Task with acceptance_criteria loads correctly"
  given: "workflow YAML with a task containing acceptance_criteria (Gherkin format)"
  when: "workflow-loader parses the file"
  then:
    - "Task has acceptance_criteria as AcceptanceCriterion[] at runtime"
    - "Invalid Gherkin structure fails with ZodError at load time"

- scenario: "Task phase field available at runtime"
  given: "workflow YAML with task phase: planning"
  when: "engine runs"
  then:
    - "task.phase is 'planning' in the task context"
    - "Phase routing (MCS-015) can read it"

- scenario: "Existing workflow YAMLs still load"
  given: "all existing workflow fixtures in data/workflows/"
  when: "workflow-loader parses them"
  then:
    - "Zero ZodErrors"
    - "All 177 tests pass"

## Tests Required

- Workflow loader: task with `acceptance_criteria` → parsed as array
- Workflow loader: task with invalid `acceptance_criteria` (missing `then`) → ZodError at load
- Workflow loader: task with `budget.max_new_files: -1` → ZodError (nonneg constraint)
- Workflow loader: task with `scope_excluded: ["logging"]` → available in task context
- Integration: existing fixture workflows load without regression

## Dependency Section

**Blocked by:** MCS-006, MCS-001
**Blocks:** MCS-009a, MCS-009b, MCS-009c, MCS-012, MCS-013
