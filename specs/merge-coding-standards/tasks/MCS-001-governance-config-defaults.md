# MCS-001: Governance Config Block in ai-sdd.yaml + defaults.ts

**Phase:** 2.2
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-006
**Effort:** 0.5d
**Ticket:** MCS-001

## Context

New governance and requirements_lock config blocks must be added to the ai-sdd.yaml schema and to `src/config/defaults.ts`. These are separate config namespaces (governance vs requirements_lock) to avoid conflation (Issue #3 from Opus review).

## Scope

1. Add `governance` and `requirements_lock` blocks to the ai-sdd.yaml config schema (Zod).
2. Update `src/config/defaults.ts` with default values.
3. Update config loader to merge new blocks.

## Config Blocks

### ai-sdd.yaml additions

```yaml
governance:
  requirements_lock: warn     # off | warn | enforce
  lock_mode: greenfield       # greenfield | brownfield

requirements_lock:
  path: ".ai-sdd/requirements.lock.yaml"
```

### src/config/defaults.ts additions

```typescript
governance: {
  requirements_lock: "warn",
  lock_mode: "greenfield",
},
requirements_lock: {
  path: ".ai-sdd/requirements.lock.yaml",
},
```

## Acceptance Criteria

- scenario: "Governance defaults applied when config omitted"
  given: "ai-sdd.yaml with no governance block"
  when: "config loaded"
  then:
    - "governance.requirements_lock is 'warn'"
    - "governance.lock_mode is 'greenfield'"
    - "requirements_lock.path is '.ai-sdd/requirements.lock.yaml'"

- scenario: "Invalid governance mode fails at config load"
  given: "ai-sdd.yaml with governance.requirements_lock: 'invalid'"
  when: "config loaded"
  then:
    - "Config load throws with actionable error message"

- scenario: "Backward compatibility preserved"
  given: "existing ai-sdd.yaml without governance fields"
  when: "config loaded"
  then:
    - "All 177 existing tests pass"

## Tests Required

- Config-to-behaviour: `governance.requirements_lock: warn` → engine emits warnings (not errors)
- Config-to-behaviour: `governance.requirements_lock: enforce` → engine throws on missing lock
- Config-to-behaviour: `governance.requirements_lock: off` → no governance gates fire
- Invalid mode → ZodError with readable message
- Missing block → defaults applied correctly

## Dependency Section

**Blocked by:** MCS-006
**Blocks:** MCS-007, MCS-009a
