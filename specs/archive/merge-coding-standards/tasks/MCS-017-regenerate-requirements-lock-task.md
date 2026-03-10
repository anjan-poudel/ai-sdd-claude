# MCS-017: regenerate-requirements-lock Task Template

**Phase:** 4.5
**Status:** READY
**Priority:** P1
**Dependencies:** MCS-009c (governance features exist)
**Effort:** 0.5d
**Ticket:** MCS-017

## Context

Makes lock regeneration a workflow task (assigned to the architect agent) rather than a manual step. Produces a diff output classifying changes as breaking/significant/minor. Previously untracked.

## Scope

Create `data/task-library/regenerate-requirements-lock.yaml`.

## Template Content

```yaml
name: regenerate-requirements-lock
agent: architect
phase: planning
description: |
  Regenerate requirements.lock.yaml from existing code. Extract requirements
  from evidence only: OpenAPI specs, tests, public interfaces, domain logic.
  Never infer intent or invent requirements. Classify all changes as
  breaking, significant, or minor. Human approves via HIL before the
  new hash is written to workflow-state.json.
overlays:
  hil: { enabled: true }
  policy_gate: { risk_tier: T1 }
acceptance_criteria:
  - scenario: "Lock file regenerated from evidence"
    given: "Existing codebase with tests and interfaces"
    when: "Regeneration task runs"
    then:
      - "requirements.lock.yaml updated with current state"
      - "spec_hash updated in workflow-state.json"
      - "change_reason provided in handover_state"
      - "diff classification (breaking/significant/minor) provided"
outputs:
  - path: ".ai-sdd/requirements.lock.yaml"
  - path: ".ai-sdd/requirements.lock.diff.yaml"
```

## Acceptance Criteria

- scenario: "Task template loads correctly"
  given: "data/task-library/regenerate-requirements-lock.yaml"
  when: "workflow-loader parses a workflow using this task via 'use:'"
  then:
    - "Task loads without ZodError"
    - "agent is 'architect', phase is 'planning'"
    - "HIL enabled"
    - "Two output paths declared"

## Tests Required

- Task library: `regenerate-requirements-lock` template loads via workflow use: reference
- Outputs: both paths present in loaded task definition

## Dependency Section

**Blocked by:** MCS-009c
**Blocks:** None
