# RMS-005: Add MCP Resource Endpoints for Documentation

**Phase:** 4
**Status:** PENDING
**Size:** S (0.5 days)
**Depends on:** RMS-002
**Target repo:** /Users/anjan/workspace/projects/ai/repeatability-mcp-server
**Package:** packages/requirement-lock-server

---

## What

Expose key RMS documentation as MCP resource endpoints so ai-sdd agents can
discover graph capabilities without needing file system access. This parallels
CS's resource endpoints (RCS-010) — CS exposes schemas, RMS exposes tooling docs.

## New Resources

| URI | Content | MIME |
|-----|---------|------|
| `rms://docs/node-types` | All supported node types with descriptions and valid fields | text/markdown |
| `rms://docs/edge-types` | All supported edge types with source→target constraints | text/markdown |
| `rms://docs/validation-rules` | All 13 validation rules: name, category, description, severity | text/markdown |
| `rms://docs/query-patterns` | All QueryEngine methods: name, input, output, use case | text/markdown |

## Implementation Notes

- Use MCP `resources/list` and `resources/read` handlers
- Content is generated from code introspection where possible:
  - Node types from `graph/types.ts` enum
  - Edge types from `graph/types.ts` enum
  - Validation rules from `validation/rules.ts` exports
  - Query patterns from `QueryEngine` method signatures
- Alternatively, maintain as static markdown files in `src/resources/`
- Resources are read-only

## Acceptance Criteria

```gherkin
Scenario: Resources are listed
  When resources/list is called
  Then 4 resource URIs are returned
  And each has a name and description

Scenario: Node types resource is readable
  When resources/read is called with "rms://docs/node-types"
  Then markdown content listing all node types is returned
  And each type has a description

Scenario: Validation rules resource is accurate
  When resources/read is called with "rms://docs/validation-rules"
  Then all 13 rules are listed
  And each has name, category, description, severity
```

## Test Strategy

- Unit test: verify all 4 resources listed
- Unit test: verify each resource returns non-empty markdown
- Integration test: verify resource content matches actual code (e.g., rule count matches)
