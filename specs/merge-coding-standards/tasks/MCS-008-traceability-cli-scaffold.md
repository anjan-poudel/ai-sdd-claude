# MCS-008: Traceability CLI Command Scaffold

**Phase:** C (Traceability + Policy Gate Expansion)  
**Status:** DRAFT  
**Dependencies:** MCS-006, MCS-007  
**Size:** M (2-3 days)

## Context

Need a first-class CLI surface for requirements traceability operations.

## Scope

Add `ai-sdd traceability` command family:
1. `validate-lock`
2. `gaps`
3. `coverage --requirement <id>`

Initial focus: command scaffolding + output contracts (JSON + human-readable).

## Acceptance Criteria

1. `ai-sdd traceability --help` lists all subcommands.
2. Each subcommand has stable exit codes:
   - pass: 0
   - validation/gap failure: non-zero
3. JSON output mode is supported for machine consumption.

## Deliverables

1. New command module under `src/cli/commands/`.
2. Registration in `src/cli/index.ts`.
3. Tests for command parsing and basic output behavior.

