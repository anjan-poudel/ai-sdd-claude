# RMS-002: Add 6 lock_* Convenience MCP Tools

**Phase:** 2
**Status:** PENDING
**Size:** M (2 days)
**Depends on:** RMS-001
**Target repo:** /Users/anjan/workspace/projects/ai/repeatability-mcp-server
**Package:** packages/requirement-lock-server

---

## What

Add 6 new MCP tools prefixed with `lock_*` that operate on existing lock files
without requiring graph session management. These are the tools originally proposed
for CS (RCS-009) but redirected to RMS where the implementation is richer.

Each tool: read lock file path → `GraphBuilder.fromYAML()` → run query/validation
→ return structured JSON.

## New Tools

### lock_validate

| Field | Value |
|-------|-------|
| Input | `{ lockFile: string, rules?: string[] }` |
| Wraps | `ValidationEngine.validate(graph, rulesets)` |
| Output | `{ success: boolean, summary: string, violations: [{ rule, severity, message, nodeIds? }] }` |
| Notes | `rules` defaults to `['all']`; accepts category names: `coverage`, `justification`, `structure`, `anti_overeng`, `contract` |

### lock_find_gaps

| Field | Value |
|-------|-------|
| Input | `{ lockFile: string }` |
| Wraps | `QueryEngine.findAllGaps()` |
| Output | `{ reqsWithoutTasks: string[], reqsWithoutTests: string[], tasksWithoutACs: string[], orphans: string[] }` |

### lock_impact_analysis

| Field | Value |
|-------|-------|
| Input | `{ lockFile: string, reqId: string }` |
| Wraps | `QueryEngine.getImpactChain(reqId)` |
| Output | `{ affectedTasks: string[], affectedTests: string[], affectedContracts: string[] }` |
| Notes | Returns empty arrays if reqId not found (not an error) |

### lock_coverage_report

| Field | Value |
|-------|-------|
| Input | `{ lockFile: string, reqId?: string }` |
| Wraps | `QueryEngine.getRequirementCoverage(reqId)` or full scan |
| Output | `{ requirements: [{ id, tasks: string[], tests: string[], covered: boolean }] }` |
| Notes | If `reqId` omitted, reports all requirements |

### lock_dependency_chain

| Field | Value |
|-------|-------|
| Input | `{ lockFile: string, taskId: string }` |
| Wraps | `QueryEngine.getDependencyChain(taskId)` |
| Output | `{ chain: string[], depth: number }` |

### lock_available_tasks

| Field | Value |
|-------|-------|
| Input | `{ lockFile: string }` |
| Wraps | `QueryEngine.getAvailableTasks()` |
| Output | `{ tasks: [{ id: string, description: string, deps_met: boolean }] }` |

## Implementation Notes

### Shared helper

```typescript
async function withLockGraph<T>(
  lockFile: string,
  fn: (graph: IGraphStore) => Promise<T>
): Promise<T | { error: string, success: false }> {
  try {
    const content = await readFile(lockFile, 'utf-8');
    const graph = GraphBuilder.fromYAML(content);
    return await fn(graph);
  } catch (err) {
    return { error: String(err), success: false };
  }
}
```

### Registration

Add tool definitions in `index.ts` after the existing `graph_health_check` tool.
Use the same `server.setRequestHandler(CallToolRequestSchema, ...)` pattern,
matching on `lock_*` tool names.

### Naming convention

`lock_*` prefix (not `graph_*`) because:
- These operate on files, not sessions
- No side effects (pure read-only)
- Clear distinction from session-based `graph_*` tools

## Acceptance Criteria

```gherkin
Scenario: lock_validate returns violations for incomplete graph
  Given a lock file with REQ-001 but no implementing TASK
  When lock_validate is called
  Then success is false
  And violations contains a "coverage" category violation

Scenario: lock_find_gaps identifies missing coverage
  Given a lock file with REQ-001, REQ-002 but only TASK for REQ-001
  When lock_find_gaps is called
  Then reqsWithoutTasks contains "REQ-002"

Scenario: lock_impact_analysis traces downstream
  Given a lock file with REQ-001 → TASK-001 → TESTSPEC-001
  When lock_impact_analysis is called with reqId "REQ-001"
  Then affectedTasks contains "TASK-001"
  And affectedTests contains "TESTSPEC-001"

Scenario: lock_available_tasks filters by deps
  Given TASK-001 depends on TASK-002 (not completed)
  When lock_available_tasks is called
  Then TASK-001 is NOT in the available list

Scenario: Missing lock file returns error
  Given a non-existent file path
  When any lock_* tool is called
  Then it returns { error: "...", success: false }
  And does not crash the server

Scenario: MCP server lists all 13 tools
  When tools/list is called
  Then response contains 7 graph_* tools + 6 lock_* tools
```

## Test Strategy

- Unit tests per tool handler using test fixture lock files
- Integration test: full 6-tool sequence on a single fixture
- Error handling tests: missing file, malformed YAML, non-existent IDs
- MCP transport test: verify tool listing and schema correctness
