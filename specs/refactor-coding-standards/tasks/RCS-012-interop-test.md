# RCS-012: Add ai-sdd Interop Test for MCP Server

**Phase:** 4
**Status:** PENDING
**Size:** S (1 day)
**Depends on:** RCS-009
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

Add an integration test that verifies the MCP server tools work correctly when
called with typical ai-sdd agent request patterns. This validates that the
coding-standards MCP server is a reliable dependency for ai-sdd workflows.

## Test Scenarios

### 1. Full workflow simulation

Simulate the sequence of MCP calls an ai-sdd agent would make during a typical
workflow:

```
1. validate_lock({ lockFile })          → check lock validity
2. find_gaps({ lockFile })              → identify missing coverage
3. coverage_report({ lockFile })        → get full coverage matrix
4. impact_analysis({ lockFile, reqId }) → trace downstream effects
5. available_tasks({ lockFile })        → find ready-to-work tasks
```

Assert each call returns structured JSON with the expected shape.

### 2. Error handling

Test that MCP tools return clean error responses (not crashes) for:

- Missing lock file path
- Malformed YAML content
- Non-existent requirement ID in impact_analysis
- Empty lock file

### 3. Graph tool + query tool interop

Test that the low-level graph tools (existing 6) and high-level query tools
(new 6 from RCS-009) produce consistent results when given the same input:

```
graph_init → graph_add_node (REQ-001) → graph_add_node (TASK-001) →
graph_add_edge (implements) → graph_query (coverage)
  vs.
coverage_report({ lockFile with REQ-001 → TASK-001 })
```

Both should report the same coverage status.

## Fixture

Create `tests/fixtures/ai-sdd-interop.lock.yaml` with:

- 3 requirements (REQ-001, REQ-002, REQ-003)
- 4 tasks (TASK-001 through TASK-004) with dependencies
- 2 test specs (TESTSPEC-001, TESTSPEC-002)
- 1 requirement with no implementing task (gap)
- 1 task with unmet dependencies (not available)

## Acceptance Criteria

```gherkin
Scenario: Full workflow simulation succeeds
  Given the interop fixture lock file
  When all 5 query tools are called in sequence
  Then each returns success with valid structured JSON

Scenario: Error responses are clean
  Given a missing lock file path
  When validate_lock is called
  Then it returns { error: "...", success: false }
  And does not crash the MCP server

Scenario: Graph and query tools agree
  Given the same traceability data
  When loaded via graph tools and via query tools
  Then both report the same coverage status for REQ-001
```

## Notes

- This test runs in the coding-standards repo's test suite
- It does NOT require ai-sdd to be installed — it simulates the call patterns
- Use the MCP server's in-process test harness (not stdio subprocess)
