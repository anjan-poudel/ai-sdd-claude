# MCS-010: Expose Traceability Commands via MCP Tools

**Phase:** 0/C (MCP Enablement + Traceability)  
**Status:** DRAFT  
**Dependencies:** MCS-008  
**Size:** M (2 days)

## Context

Traceability must be accessible to tool-driven agents through the existing ai-sdd MCP server.

## Scope

1. Add MCP tools mapped to traceability commands:
   - `traceability.gaps`
   - `traceability.validate_lock`
   - `traceability.coverage`
2. Return structured outputs suited for agent consumption.
3. Keep backward compatibility with existing MCP tool set.

## Acceptance Criteria

1. MCP server exposes new traceability tools.
2. Tool output is deterministic JSON with success/failure fields.
3. Existing MCP tools remain functional.
4. Integration tests cover at least one successful and one failing traceability invocation.

## Deliverables

1. MCP server tool registration updates in `src/integration/mcp-server/server.ts`.
2. Tool handler wiring to CLI/core traceability logic.
3. MCP integration tests.

