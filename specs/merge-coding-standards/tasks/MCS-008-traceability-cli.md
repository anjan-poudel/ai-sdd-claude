# MCS-008: ai-sdd Traceability CLI

**Phase:** 3b
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-011
**Effort:** 2.5d
**Ticket:** MCS-008

## Context

A new `ai-sdd traceability` CLI command providing 4 subcommands for requirements traceability validation. This is a prerequisite for MCP tool registration (MCS-010). Must be implemented natively (see MCS-011 spike decision).

## Scope

1. Create `src/cli/commands/traceability.ts` (new file).
2. Register via `registerTraceabilityCommand(program)` in `src/cli/index.ts`.

## Subcommands

| Command | Reads | Outputs | Exit code |
|---------|-------|---------|-----------|
| `validate-lock` | lock file + workflow-state.json | Hash match/mismatch | 0=match, 1=mismatch |
| `gaps` | lock file + workflow YAML | Unlinked requirements/tasks | 0=clean or warnings-only, 1=critical |
| `coverage` | workflow-state.json handover states | AC coverage per task | 0 always (informational) |
| `report --json` | all above | Combined JSON report | 0=clean, 1=critical gaps |

## gaps Critical Gap Definition (OD-5)

- **Critical (exit 1):** task has `requirement_ids` with IDs not in lock file, OR lock file has requirement with no linked task
- **Warning (exit 0):** task without `acceptance_criteria`, task without `requirement_ids`
- **brownfield lock_mode (OD-11):** unlinked tasks → warnings (exit 0) instead of critical gaps (exit 1)

## Acceptance Criteria

- scenario: "gaps exits 1 on critical gap"
  given: "task with requirement_ids: [REQ-999] but REQ-999 not in lock file"
  when: "ai-sdd traceability gaps"
  then:
    - "Exit code 1"
    - "Output lists unlinked requirement IDs"

- scenario: "gaps exits 0 on warnings only"
  given: "task without acceptance_criteria (warning only)"
  when: "ai-sdd traceability gaps"
  then:
    - "Exit code 0"
    - "Warning printed to stderr"

- scenario: "gaps brownfield mode downgrades unlinked tasks to warnings"
  given: "governance.lock_mode: brownfield, task with no requirement_ids"
  when: "ai-sdd traceability gaps"
  then:
    - "Exit code 0"
    - "Warning emitted (not critical)"

- scenario: "report --json produces parseable JSON"
  given: "any valid project"
  when: "ai-sdd traceability report --json"
  then:
    - "Output is valid JSON"
    - "Contains gaps, coverage, validate_lock fields"

## Tests Required

- `validate-lock`: lock file unchanged → exit 0
- `validate-lock`: lock file changed from stored hash → exit 1
- `gaps`: critical gap (unlinked requirement) → exit 1, lists gap
- `gaps`: warning-only (missing AC) → exit 0, warning on stderr
- `gaps`: brownfield mode → unlinked task exits 0
- `report --json`: produces valid parseable JSON
- CLI registration: `ai-sdd traceability --help` shows all subcommands
- Integration: command registered and callable via `runCli()`

## Dependency Section

**Blocked by:** MCS-011
**Blocks:** MCS-010
