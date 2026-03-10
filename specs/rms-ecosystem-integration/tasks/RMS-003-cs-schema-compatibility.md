# RMS-003: CS Schema Compatibility + Round-Trip Test

**Phase:** 3
**Status:** PENDING
**Size:** S (0.5 days)
**Depends on:** RMS-001
**Target repo:** /Users/anjan/workspace/projects/ai/repeatability-mcp-server
**Package:** packages/requirement-lock-server

---

## What

Verify that RMS lock file exports conform to the coding-standards (CS) defined
schema. CS owns the schema (`rules/requirements-lock.md`,
`rules/requirements-input.schema.yaml`); RMS implements the tooling. This test
ensures format alignment between the two projects.

## Tests

### 1. Export matches CS schema

```
1. Build a graph with all supported node types (REQ, NFR, AC, TASK, TESTSPEC,
   CONTRACT, MODEL, DEC, ASSUMPTION, CONSTRAINT)
2. Add representative edges (implements, tests, satisfies, depends_on)
3. Export via RequirementsLockExporter
4. Validate output against CS schema structure:
   - Has metadata.version, metadata.project, metadata.hash
   - requirements[] has id, description, type fields
   - tasks[] has id, description, implements[] fields
   - test_specs[] has id, tests[] fields
   - decisions[] has id, rationale fields
```

### 2. Round-trip: export → import → export = identical

```
1. Build graph incrementally (graph_add_node / graph_add_edge)
2. Export to YAML (A)
3. Import via GraphBuilder.fromYAML()
4. Export again (B)
5. Assert A and B are semantically identical (ignoring whitespace/ordering)
```

### 3. Schema version field present

```
1. Export any graph
2. Assert metadata.version is present and equals "1.0"
3. Assert metadata.hash is a valid SHA256
```

## Implementation Notes

- Store the CS schema reference in `src/__tests__/fixtures/cs-schema-reference.yaml`
  (copy from CS repo's `rules/requirements-input.schema.yaml`)
- Use `js-yaml` to parse and compare structures
- Semantic comparison: sort arrays by `id` field before diffing

## Acceptance Criteria

```gherkin
Scenario: Export contains all required CS schema fields
  Given a fully populated graph
  When exported via RequirementsLockExporter
  Then the output contains metadata, requirements, tasks sections
  And metadata has version, project, hash fields

Scenario: Round-trip preserves data
  Given a graph with 3 REQ, 4 TASK, 2 TESTSPEC nodes
  When export → import → export
  Then both exports match semantically

Scenario: Empty graph exports valid structure
  Given an empty graph with only metadata
  When exported
  Then the output is valid YAML with empty sections
```

## Out of Scope

- Automated schema sync from CS repo (manual copy for now)
- Testing against every CS schema version (only current v1.0)
