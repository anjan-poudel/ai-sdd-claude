# MCS-001: Governance Config Block and Schema Wiring

**Phase:** B (Requirements Lock + Intake Discipline)  
**Status:** DRAFT  
**Dependencies:** None  
**Size:** S (1-2 days)

## Context

Merged proposal requires a governance mode that lets teams adopt controls incrementally:
- `off` (no enforcement)
- `warn` (soft checks)
- `enforce` (hard fail)

This must be represented in shared types and validated in config loader.

## Scope

1. Add governance config typing in `src/types/index.ts`.
2. Add zod schema validation in `src/cli/config-loader.ts`.
3. Ensure defaults merge cleanly with existing config behavior.
4. Add unit tests for valid/invalid governance values.

## Acceptance Criteria

1. Config supports:
   - `governance.requirements_lock: off|warn|enforce`
2. Invalid governance mode fails config load with actionable error.
3. Omitted governance block preserves backward compatibility.
4. Tests cover all enum values and one invalid value.

## Deliverables

1. Type updates in `src/types/index.ts`.
2. Schema updates in `src/cli/config-loader.ts`.
3. Tests in `tests/` for config loader behavior.

