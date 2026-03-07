# MCS-006: Requirements Input Schema Validation in `validate-config`

**Phase:** B (Requirements Lock + Intake Discipline)  
**Status:** DRAFT  
**Priority:** P0  
**Dependencies:** MCS-001  
**Size:** S (1-2 days)

## Context

`validate-config` currently validates project/workflow/agents but not requirements intake artifacts.

## Scope

1. Add optional validation of:
   - `.ai-sdd/requirements.input.yaml`
   - corresponding schema files
2. Report clear validation errors with file path and field.
3. Keep behavior non-breaking when intake file is absent.

## Acceptance Criteria

1. Valid requirements input passes.
2. Invalid requirements input fails `validate-config` with actionable diagnostics.
3. Missing requirements input file does not fail unless governance mode requires it.

## Deliverables

1. `src/cli/commands/validate-config.ts` updates.
2. Schema assets in repo path used by validator.
3. Tests covering pass/fail/missing-file cases.

## Dependency Section

**Blocked by:**
1. MCS-001

**Blocks:**
1. MCS-008
