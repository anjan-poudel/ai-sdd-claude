# RCS-012: Add ai-sdd Interop Test for MCP Server

**Phase:** 4
**Status:** PENDING
**Size:** S (1 day)
**Depends on:** RCS-010
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

Add an integration test that verifies the CS MCP server's resource endpoints and
existing graph tools work correctly when called with typical ai-sdd agent request
patterns. Also verify cross-project compatibility: CS graph tool results should be
consistent with RMS results when given the same lock file input.

## Test Scenarios

### 1. Resource endpoint verification

Verify all 4 MCP resource endpoints return correct content:

```
1. resources/list                                        → 4 resources listed
2. resources/read("coding-standards://schemas/requirements-input")    → YAML content
3. resources/read("coding-standards://schemas/requirements-input-po") → YAML content
4. resources/read("coding-standards://docs/requirements-lock")        → markdown content
5. resources/read("coding-standards://docs/acceptance-criteria-format") → markdown content
```

### 2. Existing graph tools still work (regression)

Simulate the sequence of MCP calls an ai-sdd agent would make:

```
1. graph_init()                     → session created
2. graph_add_node(REQ-001)          → node added
3. graph_add_node(TASK-001)         → node added
4. graph_add_edge(implements)       → edge added
5. graph_validate()                 → validation results
6. graph_query(coverage)            → coverage data
7. graph_export()                   → lock YAML
```

Assert each call returns structured JSON with the expected shape.

### 3. Error handling

Test that MCP tools return clean error responses (not crashes) for:

- Missing lock file path in graph_init
- Malformed YAML content
- Non-existent node ID in graph_query
- Empty graph validation

### 4. CS↔RMS compatibility check (informational)

If RMS is available as a dev dependency, verify that CS and RMS produce
equivalent results for basic operations (same lock file → same coverage report).
This test should be **skippable** if RMS is not installed — it's a compatibility
check, not a hard requirement.

## Fixture

Create `tests/fixtures/ai-sdd-interop.lock.yaml` with:

- 3 requirements (REQ-001, REQ-002, REQ-003)
- 4 tasks (TASK-001 through TASK-004) with dependencies
- 2 test specs (TESTSPEC-001, TESTSPEC-002)
- 1 requirement with no implementing task (gap)
- 1 task with unmet dependencies (not available)

## Acceptance Criteria

```gherkin
Scenario: Resource endpoints return valid content
  When all 4 resource URIs are read
  Then each returns content with the correct MIME type
  And content is non-empty

Scenario: Graph tools regression
  Given the interop fixture lock file
  When graph tools are called in the standard sequence
  Then each returns success with valid structured JSON

Scenario: Error responses are clean
  Given malformed input
  When graph tools are called
  Then they return { error: "...", success: false }
  And do not crash the MCP server
```

## Notes

- This test runs in the coding-standards repo's test suite
- It does NOT require ai-sdd to be installed — it simulates the call patterns
- Use the MCP server's in-process test harness (not stdio subprocess)
- The CS↔RMS compatibility test is opt-in (skip if RMS not in node_modules)
