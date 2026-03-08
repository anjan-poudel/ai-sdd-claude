# RMS-001: Build GraphBuilder.fromYAML() Lock File Importer

**Phase:** 1
**Status:** PENDING
**Size:** M (1.5 days)
**Depends on:** —
**Target repo:** /Users/anjan/workspace/projects/ai/repeatability-mcp-server
**Package:** packages/requirement-lock-server

---

## What

Build a `GraphBuilder.fromYAML()` static method that reads a `requirements.lock.yaml`
file and populates an InMemoryGraph with the correct nodes and edges. This is the
foundation for all `lock_*` convenience tools (RMS-002).

Currently, the only way to populate a graph is incrementally via `graph_add_node` /
`graph_add_edge`. There is no way to load an existing lock file back into a queryable
graph — which is exactly what ai-sdd agents need for validation and gap analysis.

## Location

New file: `src/graph/GraphBuilder.ts`

## Interface

```typescript
import type { IGraphStore } from './IGraphStore';

export class GraphBuilder {
  /**
   * Parse a requirements.lock.yaml string and populate a graph.
   * Returns an InMemoryGraph ready for QueryEngine / ValidationEngine.
   */
  static fromYAML(yamlContent: string): IGraphStore;

  /**
   * Load a lock file from disk and build a graph.
   */
  static fromFile(filePath: string): IGraphStore;
}
```

## Implementation Notes

The lock file format (defined by CS in `rules/requirements-lock.md`) contains:

```yaml
metadata:
  version: "1.0"
  project: "..."
  generated_at: "..."
  hash: "..."

requirements:
  - id: REQ-001
    description: "..."
    type: functional
    acceptance_criteria:
      - id: AC-001
        description: "..."

non_functional_requirements:
  - id: NFR-001
    description: "..."

tasks:
  - id: TASK-001
    description: "..."
    implements: [REQ-001]
    depends_on: [TASK-002]

test_specs:
  - id: TESTSPEC-001
    description: "..."
    tests: [REQ-001]

decisions:
  - id: DEC-001
    description: "..."
    rationale: "..."
    satisfies: [REQ-001]

contracts:
  - id: CONTRACT-001
    description: "..."
```

**Mapping to graph:**

| Lock Section | Node Type | Edge Type |
|-------------|-----------|-----------|
| requirements[].id | REQ | — |
| requirements[].acceptance_criteria[].id | AC | AC → REQ: `satisfies` |
| non_functional_requirements[].id | NFR | — |
| tasks[].id | TASK | TASK → REQ: `implements` (from tasks[].implements) |
| tasks[].depends_on | — | TASK → TASK: `depends_on` |
| test_specs[].id | TESTSPEC | TESTSPEC → REQ: `tests` (from test_specs[].tests) |
| decisions[].id | DEC | DEC → REQ: `satisfies` (from decisions[].satisfies) |
| contracts[].id | CONTRACT | CONTRACT → REQ: `satisfies` (inferred) |

**Edge cases:**
- Missing sections (e.g., no `test_specs`) → skip gracefully
- Unknown node types → warn and skip
- Duplicate IDs → throw with clear error message
- Malformed YAML → throw with line number if possible

## Acceptance Criteria

```gherkin
Scenario: Import a complete lock file
  Given a requirements.lock.yaml with REQ, TASK, TESTSPEC, AC, DEC nodes
  When GraphBuilder.fromYAML() is called
  Then the graph contains all nodes with correct types
  And all edges are created from relationship fields

Scenario: Round-trip export → import → export
  Given a graph built via graph_add_node / graph_add_edge
  When exported via RequirementsLockExporter
  And re-imported via GraphBuilder.fromYAML()
  And re-exported
  Then the two exports are semantically identical

Scenario: Missing sections handled gracefully
  Given a lock file with only requirements (no tasks, tests, etc.)
  When GraphBuilder.fromYAML() is called
  Then a graph is returned with only REQ nodes
  And no errors are thrown

Scenario: Malformed YAML throws clear error
  Given invalid YAML content
  When GraphBuilder.fromYAML() is called
  Then an error is thrown with a descriptive message

Scenario: Duplicate node IDs throw
  Given a lock file with two nodes sharing the same ID
  When GraphBuilder.fromYAML() is called
  Then an error is thrown identifying the duplicate
```

## Test Strategy

- Unit tests in `src/__tests__/GraphBuilder.test.ts`
- Test fixtures: `src/__tests__/fixtures/` with valid and invalid YAML files
- Round-trip test using existing `RequirementsLockExporter`
- Integration with QueryEngine: import lock → run findAllGaps() → verify results
