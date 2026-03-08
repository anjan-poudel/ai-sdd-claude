# MCS-015: Phase-Based Model Routing + Multi-Adapter Auth Warnings

**Phase:** 4.3
**Status:** READY
**Priority:** P1
**Dependencies:** MCS-007 (phase field on TaskDefinition)
**Effort:** 1.5d
**Ticket:** MCS-015

## Context

Currently all tasks use the same adapter. Phase routing enables different models per workflow phase (planning, design, implementation, review). Precedence: task `adapter` override > `phase_routing[task.phase]` > `adapter` default. Multi-adapter auth warnings fire only for used adapters (OD from C1 Decision 6).

## Scope

1. Update `src/adapters/factory.ts` to support phase routing.
2. Update ai-sdd.yaml schema + Zod validation for `phase_routing`.
3. Update `src/config/defaults.ts`.
4. Emit auth warnings only for adapters referenced in active workflow + phase routing.

## Config

```yaml
adapter:
  type: claude_code
  phase_routing:
    planning:
      type: openai
      model: gpt-4o
    planning_review:
      type: claude_code
      model: claude-opus-4-6
    implementation:
      type: claude_code
      model: claude-sonnet-4-6
    review:
      type: openai
      model: gpt-4o
```

## Routing Precedence

1. Task-level `adapter` override (highest)
2. `phase_routing[task.phase]` (if task has phase)
3. Default `adapter.type` (lowest)

## Auth Warnings Logic

Only emit auth/credential warnings for:
- Adapters referenced in active workflow agent definitions
- Adapters referenced in phase_routing entries that match workflow tasks
- Silent for adapters configured but not used by any active agent or phase

## Acceptance Criteria

- scenario: "Task phase routes to phase_routing adapter"
  given: "task with phase: planning, phase_routing.planning configured"
  when: "adapter resolved for task"
  then:
    - "phase_routing.planning adapter selected"
    - "Not the default adapter"

- scenario: "Task adapter override takes precedence"
  given: "task with explicit adapter: openai and phase_routing configured"
  when: "adapter resolved for task"
  then:
    - "Task-level adapter used"
    - "phase_routing ignored for this task"

- scenario: "Task with no phase gets default adapter"
  given: "task with no phase field, default adapter: claude_code"
  when: "adapter resolved for task"
  then:
    - "Default claude_code adapter used"

- scenario: "Unused adapter auth warning suppressed"
  given: "openai configured in phase_routing but no tasks use planning phase"
  when: "engine starts"
  then:
    - "No auth warning for openai"

- scenario: "Used adapter missing auth → error at startup"
  given: "phase_routing.planning: openai but OPENAI_API_KEY not set, and tasks have phase: planning"
  when: "engine starts"
  then:
    - "Startup error: missing auth for openai"

## Tests Required

- Phase routing: task with phase=planning → phase_routing.planning adapter
- Phase routing: task with explicit adapter override → override wins
- Phase routing: task with no phase → default adapter
- Auth warnings: used adapter missing auth → error at startup
- Auth warnings: unused adapter (not referenced by any agent/phase) → no warning
- Config: invalid phase_routing entry (unknown adapter type) → ZodError

## Dependency Section

**Blocked by:** MCS-007
**Blocks:** None
