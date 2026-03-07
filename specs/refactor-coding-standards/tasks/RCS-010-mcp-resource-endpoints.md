# RCS-010: Add MCP Resource Endpoints for Schemas

**Phase:** 3
**Status:** PENDING
**Size:** S (1 day)
**Depends on:** RCS-009
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

Expose key schemas and governance documents as MCP resource endpoints so that
ai-sdd agents can read them without needing direct file system access.

## New Resources

| URI | Source File | Content Type |
|-----|------------|-------------|
| `coding-standards://schemas/requirements-input` | `rules/requirements-input.schema.yaml` | application/yaml |
| `coding-standards://schemas/requirements-input-po` | `rules/requirements-input.po.schema.yaml` | application/yaml |
| `coding-standards://docs/requirements-lock` | `rules/requirements-lock.md` | text/markdown |
| `coding-standards://docs/acceptance-criteria-format` | `rules/acceptance-criteria-format.md` | text/markdown |

## Implementation Notes

- Use MCP resource protocol (`resources/list` and `resources/read`)
- Each resource reads the file from disk at request time (no caching needed)
- Resources are read-only — no `resources/write` support
- File paths are relative to the coding-standards project root
- If a file doesn't exist, return a clear error with the expected path

## Acceptance Criteria

```gherkin
Scenario: MCP server lists all resources
  When resources/list is called
  Then the response contains all 4 resource URIs
  And each has a name and description

Scenario: Reading a schema resource returns YAML
  When resources/read is called with "coding-standards://schemas/requirements-input"
  Then the response contains the full YAML schema content
  And the MIME type is application/yaml

Scenario: Reading a doc resource returns markdown
  When resources/read is called with "coding-standards://docs/requirements-lock"
  Then the response contains the full markdown content
  And the MIME type is text/markdown

Scenario: Reading a missing resource returns error
  Given the requirements-input.schema.yaml file has been moved
  When resources/read is called for it
  Then a clear error is returned with the expected file path
```

## Test Strategy

- Unit tests for resource handlers (mock file system)
- Integration test verifying all 4 resources are listed and readable
- Verify MCP server lists resources alongside tools
