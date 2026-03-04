# MCS-007: `run` Preflight for Lock Mode + Spec Hash State Tracking

**Phase:** B (Requirements Lock + Intake Discipline)  
**Status:** DRAFT  
**Dependencies:** MCS-001, MCS-002  
**Size:** M (2-3 days)

## Context

`run` should enforce governance policy before dispatch:
1. validate lock mode when lock exists/required
2. persist and compare lock hash across runs

## Scope

1. Add preflight checks in `src/cli/commands/run.ts` and/or engine startup:
   - lock exists (when enforce)
   - mode is valid (`greenfield|brownfield`)
2. Extend workflow state with lock hash metadata.
3. Emit event when lock hash changes between runs.

## Acceptance Criteria

1. Invalid lock mode blocks run in `enforce`, warns in `warn`.
2. Hash is stored in state after successful preflight.
3. Lock-hash change emits observable event and visible status signal.
4. Existing workflows without lock keep working in default/off mode.

## Deliverables

1. Run/engine preflight updates.
2. State schema/type extensions.
3. Tests for enforce/warn/off behavior and hash-change signaling.

