# RCS-009: Redirect Query Tools to RMS + Add DEPRECATION.md

**Phase:** 3
**Status:** PENDING
**Size:** XS (0.5 days) — reduced from M; doc-only change in CS
**Depends on:** RCS-001
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

The original plan proposed adding 6 high-level query tools (validate_lock,
find_gaps, impact_analysis, coverage_report, dependency_chain, available_tasks)
to the CS MCP server. **This work is now redirected to repeatability-mcp-server
(RMS)**, which already has equivalent — and more powerful — implementations.

See `docs/ecosystem-proposal-opus.md` §"What RCS-009 Becomes" for the full
mapping of proposed CS tools to existing RMS equivalents.

## What CS Does Instead

1. **Add `tools/mcp-server/DEPRECATION.md`** explaining:
   - CS graph tools (6 MCP tools) are functional but frozen
   - New graph/query/validation features go to RMS
   - Table mapping CS tool names to RMS equivalents
   - Timeline: CS tools remain working indefinitely; deprecation is a
     recommendation, not a removal

2. **Update `tools/mcp-server/README.md`** to:
   - Add "For advanced queries, use repeatability-mcp-server" section
   - Link to RMS repo and its MCP tool documentation
   - Note that CS's 9 validators are a subset of RMS's 20+ rules

3. **Update `tools/query-engine/README.md`** similarly

## Why Not Both?

Maintaining graph tools in two places creates confusion about which project
owns the graph model, validation rules, and query patterns. The ecosystem
proposal assigns these unambiguously to RMS. CS's role is standards library:
prompts, schemas, language rules, and CI scripts.

## Acceptance Criteria

```gherkin
Scenario: DEPRECATION.md exists and is accurate
  Given the tools/mcp-server/ directory
  When DEPRECATION.md is read
  Then it contains a mapping table of CS tools → RMS equivalents
  And it states that CS tools remain functional
  And it states that new features go to RMS

Scenario: MCP server README references RMS
  Given the tools/mcp-server/README.md
  When the README is read
  Then it contains a section pointing to RMS for advanced queries
  And it links to the RMS repository

Scenario: Existing tools still work
  Given the MCP server with no code changes
  When npm test is run
  Then all existing tests pass
```

## Out of Scope

- Adding convenience wrappers in RMS (tracked in RMS repo)
- Removing CS graph tools (they remain frozen but functional)
- Wiring RMS into ai-sdd (tracked in ecosystem proposal Phase 2)
