# MCS-010: MCP Tool Registration — Traceability Tools

**Phase:** 3c
**Status:** READY
**Priority:** P1
**Dependencies:** MCS-008
**Effort:** 0.5d
**Ticket:** MCS-010

## Context

Register two new MCP tools backed by the traceability CLI (MCS-008). Must be registered only after the backing CLI commands exist — no stub registrations (P4 from Opus review).

## Scope

Extend `src/integration/mcp-server/server.ts`:
1. Add two entries to the `TOOLS` array.
2. Add two cases to the `CallToolRequestSchema` switch.

Both tools delegate via the existing `runCli()` subprocess exec pattern.

## Tools to Register

### `validate_requirements_lock`
- Calls: `runCli("traceability", "validate-lock", projectPath)`
- Returns: hash match status, current hash, stored hash
- Exit code semantics: 0=match, 1=mismatch

### `check_scope_drift`
- Calls: `runCli("traceability", "gaps", projectPath)`
- Returns: list of critical gaps and warnings
- Exit code semantics: 0=clean/warnings, 1=critical gaps

## Acceptance Criteria

- scenario: "validate_requirements_lock returns real data"
  given: "MCP server running, project with lock file"
  when: "validate_requirements_lock tool called"
  then:
    - "Returns actual hash comparison result (not stub)"
    - "Uses runCli() delegation pattern"

- scenario: "check_scope_drift returns real data"
  given: "MCP server running, project with workflow YAML"
  when: "check_scope_drift tool called"
  then:
    - "Returns actual gaps from traceability CLI"
    - "Not a stub response"

## Tests Required

- MCP: `validate_requirements_lock` tool returns real data (not stub)
- MCP: `check_scope_drift` tool returns real data (not stub)
- Integration: tool delegation uses runCli() subprocess exec pattern

## Dependency Section

**Blocked by:** MCS-008
**Blocks:** None (Phase 3c complete)
