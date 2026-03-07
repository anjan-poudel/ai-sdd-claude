# RCS-009: Add High-Level Query Tools to MCP Server

**Phase:** 3
**Status:** PENDING
**Size:** M (2 days)
**Depends on:** RCS-001
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

The MCP server currently exposes 6 low-level graph tools (`graph_init`,
`graph_add_node`, `graph_add_edge`, `graph_validate`, `graph_query`,
`graph_export`). Add 6 high-level convenience tools that wrap the QueryEngine
and ValidationEngine for direct use by ai-sdd agents.

These tools operate on an existing `requirements.lock.yaml` file — they don't
require a graph session to be initialized first. This makes them suitable for
agents that want quick analysis without building graphs manually.

## New Tools

| Tool | Wraps | Input | Output |
|------|-------|-------|--------|
| `validate_lock` | ValidationEngine.validate() | `{ lockFile: string, rules?: string[] }` | `{ success, summary, violations[] }` |
| `find_gaps` | QueryEngine.findAllGaps() | `{ lockFile: string }` | `{ reqsWithoutTasks[], reqsWithoutTests[], tasksWithoutACs[], orphans[] }` |
| `impact_analysis` | QueryEngine.getImpactChain() | `{ lockFile: string, reqId: string }` | `{ affectedTasks[], affectedTests[], affectedContracts[] }` |
| `coverage_report` | QueryEngine.getRequirementCoverage() | `{ lockFile: string, reqId?: string }` | `{ requirements: [{ id, tasks[], tests[], covered }] }` |
| `dependency_chain` | QueryEngine.getDependencyChain() | `{ lockFile: string, taskId: string }` | `{ chain: string[], depth: number }` |
| `available_tasks` | QueryEngine.getAvailableTasks() | `{ lockFile: string }` | `{ tasks: [{ id, description, deps_met }] }` |

## Implementation Notes

- Each tool reads `lockFile` from disk, builds graph via `GraphBuilder.fromYAML()`,
  runs the query, and returns structured JSON
- Graph is built per-request (no session state needed)
- All tools are **read-only** — they never modify files
- Error handling: if lockFile doesn't exist or is malformed, return
  `{ error: "...", success: false }`

## Acceptance Criteria

```gherkin
Scenario: validate_lock returns violations
  Given a requirements.lock.yaml with a REQ that has no implementing TASK
  When validate_lock is called
  Then success is false
  And violations contains "coverage-req-tasks" rule violation

Scenario: find_gaps reports missing coverage
  Given a requirements.lock.yaml with REQ-001 but no TASK implementing it
  When find_gaps is called
  Then reqsWithoutTasks contains "REQ-001"

Scenario: impact_analysis traces downstream effects
  Given a requirements.lock.yaml with REQ-001 → TASK-001 → TESTSPEC-001
  When impact_analysis is called with reqId "REQ-001"
  Then affectedTasks contains "TASK-001"
  And affectedTests contains "TESTSPEC-001"

Scenario: available_tasks filters by dependency satisfaction
  Given TASK-001 depends on TASK-002 (completed) and TASK-003 (pending)
  When available_tasks is called
  Then TASK-001 is NOT in the available list
```

## Test Strategy

- Unit tests for each tool handler (mock GraphBuilder)
- Integration test with a real `requirements.lock.yaml` fixture
- Verify MCP server lists all 12 tools (6 existing + 6 new)
