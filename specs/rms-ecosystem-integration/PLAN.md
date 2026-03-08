# Plan: RMS Ecosystem Integration

**Date:** 2026-03-08
**Status:** READY FOR REVIEW
**Target repo:** /Users/anjan/workspace/projects/ai/repeatability-mcp-server
**Ecosystem context:** docs/ecosystem-proposal-opus.md
**Related:** specs/refactor-coding-standards/REFACTOR-PLAN.md (CS side of same ecosystem)

---

## 1. Context

The three-project ecosystem proposal assigns **repeatability-mcp-server (RMS)** the
role of **Traceability Engine** — the single source of truth for building, validating,
querying, and exporting requirements traceability graphs.

RMS is currently a standalone monorepo (`ai-agent-toolkit`) with three packages:

| Package | Purpose | Status |
|---------|---------|--------|
| `requirement-lock-server` | MCP server: 7 tools (graph_init, add_node, add_edge, validate, query, export, health_check), QueryEngine (14 methods), ValidationEngine (13 rules, 5 categories), LadybugDB backend, AST extractors, eval framework | Mature |
| `planlock-cli` | CLI for lock file operations (canonicalize, validate, diff, export) | Functional |
| `agent-constitution-server` | MCP server for constitution documents | Minimal |

**What RMS needs to become ai-sdd-ready:**

1. **Convenience lock-file tools** — Currently RMS requires a graph session (graph_init → add nodes → query). Agents calling from ai-sdd need tools that take a `lockFile` path and return results directly, without session management.

2. **Lock file import** — RMS can export to `requirements.lock.yaml` but has no `fromYAML()` builder to load an existing lock file back into a graph for querying. This is the critical missing piece.

3. **Documentation** — README is a project scaffold description, not an ecosystem-aware doc.

4. **CS schema compatibility** — RMS exports lock files but must verify they match the CS-defined schema exactly (CS owns the schema, RMS implements the tooling).

---

## 2. Inventory: What RMS Has Today

### MCP Tools (7)

| Tool | Purpose |
|------|---------|
| `graph_init` | Create session with InMemory or LadybugDB backend |
| `graph_add_node` | Add typed node (REQ, NFR, AC, TASK, TESTSPEC, CONTRACT, MODEL, DEC, ASSUMPTION, CONSTRAINT) |
| `graph_add_edge` | Add typed edge (implements, tests, satisfies, depends_on, etc.) |
| `graph_validate` | Run validation rules (5 categories, 13 rules) |
| `graph_query` | Run query patterns (14 available) |
| `graph_export` | Export graph to requirements.lock.yaml |
| `graph_health_check` | Server health status |

### QueryEngine (14 methods)

| Method | Returns |
|--------|---------|
| `findOrphans()` | Disconnected nodes |
| `getImplementingTasks()` | Tasks for a requirement |
| `getCoveringTests()` | Tests for a requirement |
| `getDependentTasks()` | Tasks depending on a given task |
| `findAllGaps()` | All coverage gaps (reqs→tasks, reqs→tests, tasks→ACs, orphans) |
| `getRequirementCoverage()` | Coverage chain for a requirement |
| `getFullyCoveredRequirements()` | Requirements with complete coverage |
| `getAvailableTasks()` | Tasks with all dependencies met |
| `getUnjustifiedContracts()` | Contracts without rationale |
| `getDependencyChain()` | Recursive task dependency chain |
| `getImpactChain()` | Downstream effects of changing a requirement |
| + 3 more | Various graph traversals |

### ValidationEngine (13 rules, 5 categories)

| Category | Rules |
|----------|-------|
| Coverage | coverageReqTasks, coverageTaskAc, coverageReqTests, coverageNfrTests |
| Justification | justificationContracts, justificationModels |
| Structure | structureOrphans, structureTaskDeps |
| Anti-overengineering | antiOverengAbstractions |
| Contract | contractStability, contractJustification, contractValidation, contractVersionChain |

### What's Missing

| Gap | Impact |
|-----|--------|
| No lock file import (fromYAML) | Can't query existing lock files without rebuilding graph manually |
| No sessionless convenience tools | Agents must manage sessions for simple queries |
| README doesn't reflect ecosystem role | New users don't understand how RMS fits with ai-sdd and CS |
| No CS schema compatibility test | Lock export might drift from CS-defined format |
| No MCP resource endpoints | Agents can't read RMS docs/schemas via MCP protocol |

---

## 3. Phased Implementation

### Phase 1 — Lock File Importer (1.5 days)

Build a `GraphBuilder.fromYAML()` that reads a `requirements.lock.yaml` and
populates an InMemory graph. This is the foundation for all convenience tools.

**Implementation:**
- Parse YAML → extract requirements, tasks, tests, contracts, decisions
- Create nodes with correct types and metadata
- Create edges by inferring relationships from the lock file structure
  (e.g., task.implements_requirement → `implements` edge)
- Return a populated `IGraphStore` ready for QueryEngine/ValidationEngine

**Ticket: RMS-001**

---

### Phase 2 — Convenience Lock-File Tools (2 days)

Add 6 new MCP tools that operate on lock files directly — no session required.
Each tool: read lock file → build graph via `GraphBuilder.fromYAML()` → run
query/validation → return structured JSON.

| Tool | Wraps | Input | Output |
|------|-------|-------|--------|
| `lock_validate` | ValidationEngine.validate() | `{ lockFile, rules? }` | `{ success, summary, violations[] }` |
| `lock_find_gaps` | QueryEngine.findAllGaps() | `{ lockFile }` | `{ reqsWithoutTasks[], reqsWithoutTests[], tasksWithoutACs[], orphans[] }` |
| `lock_impact_analysis` | QueryEngine.getImpactChain() | `{ lockFile, reqId }` | `{ affectedTasks[], affectedTests[], affectedContracts[] }` |
| `lock_coverage_report` | QueryEngine.getRequirementCoverage() | `{ lockFile, reqId? }` | `{ requirements: [{ id, tasks[], tests[], covered }] }` |
| `lock_dependency_chain` | QueryEngine.getDependencyChain() | `{ lockFile, taskId }` | `{ chain: string[], depth }` |
| `lock_available_tasks` | QueryEngine.getAvailableTasks() | `{ lockFile }` | `{ tasks: [{ id, description, deps_met }] }` |

**Naming convention:** `lock_*` prefix distinguishes these from the existing session-based `graph_*` tools. Both coexist — `graph_*` for incremental building, `lock_*` for querying existing files.

**Ticket: RMS-002**

---

### Phase 3 — CS Schema Compatibility (0.5 days)

Add a test that validates RMS lock export matches the CS-defined schema:

1. Build a graph with all node/edge types
2. Export via `RequirementsLockExporter`
3. Validate output against `rules/requirements-input.schema.yaml` from CS
4. Round-trip: export → import via `GraphBuilder.fromYAML()` → export again → diff = zero

**Ticket: RMS-003**

---

### Phase 4 — Documentation & Ecosystem Alignment (1 day)

#### 4.1 Rewrite README.md

Replace the placeholder README with ecosystem-aware documentation:
- Role: Traceability Engine in three-project ecosystem
- Relationship to ai-sdd (Orchestrator) and coding-standards (Standards Library)
- Package descriptions with usage examples
- Lock file format: "schema defined by CS, tooling implemented here"
- Quick start: both session-based (graph_*) and file-based (lock_*) workflows

**Ticket: RMS-004**

#### 4.2 Add MCP resource endpoints

Expose key documentation as MCP resources:
- `rms://docs/node-types` — descriptions of all 10+ node types
- `rms://docs/edge-types` — descriptions of all 12+ edge types
- `rms://docs/validation-rules` — all 13 rules with descriptions
- `rms://docs/query-patterns` — all 14 query methods with usage

**Ticket: RMS-005**

#### 4.3 ai-sdd integration test

End-to-end test simulating ai-sdd's call patterns:
1. `lock_validate` → `lock_find_gaps` → `lock_coverage_report` → `lock_impact_analysis` → `lock_available_tasks`
2. Error handling (missing file, malformed YAML, non-existent IDs)
3. Consistency check: `graph_*` session workflow vs `lock_*` on same data

**Ticket: RMS-006**

---

## 4. Task Summary

| ID | Phase | Description | Size | Depends |
|----|-------|-------------|------|---------|
| RMS-001 | 1 | Build `GraphBuilder.fromYAML()` lock file importer | M | — |
| RMS-002 | 2 | Add 6 `lock_*` convenience MCP tools | M | RMS-001 |
| RMS-003 | 3 | CS schema compatibility + round-trip test | S | RMS-001 |
| RMS-004 | 4 | Rewrite README with ecosystem context | S | — |
| RMS-005 | 4 | Add MCP resource endpoints for docs | S | RMS-002 |
| RMS-006 | 4 | ai-sdd integration test (call pattern simulation) | S | RMS-002 |

**Total estimate: ~5 days**

---

## 5. What Does NOT Change

- Existing 7 MCP tools (`graph_*` + `health_check`) — untouched
- QueryEngine (14 methods) — untouched (convenience tools wrap them)
- ValidationEngine (13 rules) — untouched
- LadybugDB adapter — untouched
- AST contract extractors (TS, Java, Kotlin) — untouched
- LLM eval framework — untouched
- planlock-cli — untouched
- agent-constitution-server — untouched

---

## 6. Verification

After implementation:

1. `pnpm test` in `packages/requirement-lock-server/` — passes (existing + new)
2. MCP server lists all 13 tools (7 existing + 6 new `lock_*`)
3. `lock_*` tools return correct results for the test fixture
4. Round-trip test: export → import → export produces identical output
5. Lock export validates against CS schema
6. README clearly states ecosystem role
7. MCP resources list and read correctly

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Lock file format drift between CS schema and RMS export | RMS-003 adds automated compatibility test |
| `fromYAML` can't infer all edge types from lock structure | Lock file may need to include explicit relationship data; check CS schema |
| Convenience tools add latency (parse → build → query per call) | InMemory graph is <2ms per op; lock parse is one-time; acceptable for agent use |
| Breaking existing MCP clients | New tools use `lock_*` prefix; existing `graph_*` tools unchanged |
| RMS monorepo build complexity | All changes in one package (`requirement-lock-server`); no cross-package deps |

---

## 8. Cross-Project Coordination

| This Plan (RMS) | CS Refactor Plan (RCS) | ai-sdd Ecosystem |
|-----------------|----------------------|------------------|
| RMS-001: lock importer | — | Enables Phase 2 of ecosystem |
| RMS-002: lock_* tools | RCS-009: DEPRECATION.md pointing to RMS | ai-sdd agents call RMS instead of CS for queries |
| RMS-003: CS schema compat | RCS-010: CS exposes schemas as MCP resources | Shared contract verification |
| RMS-004: README | RCS-002: CS README mentions RMS | Consistent ecosystem narrative |
| RMS-006: integration test | RCS-012: CS integration test | Both sides verify interop |
