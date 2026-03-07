# Refactor Plan: coding-standards Post-Merge Cleanup

**Date:** 2026-03-07
**Branch:** feature/merge-coding-standards
**Status:** READY FOR REVIEW
**Target repo:** /Users/anjan/workspace/projects/coding-standards
**Companion plan:** specs/merge-coding-standards/MERGE-PLAN-v2.md

---

## 1. Context

The merge plan (MERGE-PLAN-v2.md) defined a two-project split:

- **ai-sdd** — enforcement + orchestration (blocks tasks, transitions state)
- **coding-standards** — read-only analysis + queries (MCP server, validators, scripts)

The merge direction (coding-standards → ai-sdd) is complete or in-progress via the
18 MCS tasks. This plan covers the **reverse direction**: pruning coding-standards to
eliminate redundancy, update documentation to point at ai-sdd for enforcement, and
ensure the remaining tools work cleanly as a standalone analysis toolkit.

---

## 2. Inventory: What coding-standards Contains Today

### Tools (3 NPM packages) — ALL STAY

| Package | Location | Purpose | Verdict |
|---------|----------|---------|---------|
| `@coding-standards/mcp-server` | `tools/mcp-server/` | Graph building + querying (6 MCP tools) | **KEEP** |
| `@coding-standards/validators` | `tools/validators/` | 9 validation rules (informational lint) | **KEEP** |
| `@coding-standards/query-engine` | `tools/query-engine/` | 11 graph query methods + CLI | **KEEP** |

### Scripts (13 bash) — MIXED

| Script | Purpose | Verdict | Reason |
|--------|---------|---------|--------|
| `reproducibility-check.sh` | Multi-gate validation (spec hash, OpenAPI, scope, arch) | **KEEP** | Core analysis tool; gates are informational when run standalone |
| `semantic-drift-check.sh` | Drift detection (spec hash + OpenAPI diff) | **KEEP** | Core analysis |
| `canon-openapi.sh` | OpenAPI schema normalization + comparison | **KEEP** | Analysis utility |
| `spec-hash.sh` | SHA256 of spec files | **KEEP** | Used by drift detection |
| `spec-hash-verify.sh` | Verify spec hashes match | **KEEP** | Used by drift detection |
| `validate-requirements-input.sh` | JSON schema validation of requirements input | **KEEP** | Schema validation |
| `validate-context.sh` | Context file validation | **KEEP** | Analysis |
| `validate-state-store.sh` | State store validation | **KEEP** | Analysis |
| `planlock-check.sh` | Plan lock verification | **KEEP** | Analysis |
| `dryrun.sh` | Dry-run preview | **KEEP** | Utility |
| `run-phase.sh` | Phase-based model dispatch orchestration | **ARCHIVE** | Redundant: ai-sdd has adapter-based dispatch |
| `check-iteration-limits.sh` | Iteration count validation | **ARCHIVE** | Redundant: ai-sdd enforces `max_rework_iterations` in engine |

### Workflow (orchestration layer) — ARCHIVE

| File | Purpose | Verdict | Reason |
|------|---------|---------|--------|
| `workflow/state-machine.yaml` | 17-state GitHub-event-driven state machine | **ARCHIVE** | Redundant: ai-sdd has `VALID_TRANSITIONS` + state-manager + overlays |
| `workflow/events-contract.md` | GitHub + Slack event envelope + routing | **ARCHIVE** | GitHub integration scope; not core analysis |
| `workflow/context.schema.json` | Handoff context model | **KEEP** | Schema reference |
| `workflow/index.md` | Documentation index | **UPDATE** | Remove references to archived files |
| `workflow/release-readiness-v1.md` | Release checklist | **KEEP** | Documentation |
| `workflow/task-graph.template.json` | DAG template | **KEEP** | Used by MCP server |
| `workflow/trial-week-plan.md` | Rollout plan | **KEEP** | Documentation |
| `workflow/production-rollout-checklist.md` | Rollout checklist | **KEEP** | Documentation |

### Agents & Rules — MIXED

| File | Purpose | Verdict | Reason |
|------|---------|---------|--------|
| `agents/constitution.md` | 10 mandatory agent rules | **UPDATE** | Keep but add "enforcement now handled by ai-sdd" note |
| `agents/model-routing.yaml` | Phase→provider routing config | **KEEP** | Reference config; useful standalone |
| `agents/requirements-lock/` | Diff-aware schemas | **KEEP** | Analysis tooling |
| `rules/requirements-input.schema.yaml` | Structured input schema | **KEEP** | Core schema |
| `rules/requirements-input.po.schema.yaml` | PO/business task schema | **KEEP** | Core schema |
| `rules/requirements-lock.md` | Immutability contract | **KEEP** | Governance documentation |
| `rules/acceptance-criteria-format.md` | AC format spec | **KEEP** | Standards documentation |
| `rules/*.example.yaml` | Example payloads | **KEEP** | Reference |
| `toolgate.yaml` | Tool gates + budgets template | **UPDATE** | Keep but add ai-sdd overlay cross-reference |

### Documentation — ALL STAY

| File | Verdict | Notes |
|------|---------|-------|
| `README.md` | **UPDATE** | Add ai-sdd integration section |
| `MANUAL.md` | **UPDATE** | Add "for enforcement, use ai-sdd" section |
| `ARCHITECTURE.md` | **KEEP** | Reference |
| `COMPARATIVE-ANALYSIS.md` | **KEEP** | Design rationale |
| `CLAUDE.md` | **UPDATE** | Remove orchestration instructions; point to ai-sdd |
| `AGENTS.md` | **UPDATE** | Add "orchestration handled by ai-sdd" note |
| `docs/COMBINED-AGENTIC-LOOP.md` | **ARCHIVE** | Historical design doc |
| `docs/AGENT-LOOP-PATTERN.md` | **ARCHIVE** | Historical design doc |
| All `docs/reference/` | **KEEP** | Frozen historical docs |
| All `docs/REPEATABILITY-MCP-*` | **KEEP** | MCP integration docs |

---

## 3. Phased Implementation

### Phase 1 — Archive Redundant Files (0.5 days)

Move files that are now redundant with ai-sdd into an `archive/merged-to-ai-sdd/`
directory. Do NOT delete — preserve for reference.

**Files to archive:**
- `workflow/state-machine.yaml` → `archive/merged-to-ai-sdd/state-machine.yaml`
- `workflow/events-contract.md` → `archive/merged-to-ai-sdd/events-contract.md`
- `scripts/run-phase.sh` → `archive/merged-to-ai-sdd/run-phase.sh`
- `scripts/check-iteration-limits.sh` → `archive/merged-to-ai-sdd/check-iteration-limits.sh`
- `docs/COMBINED-AGENTIC-LOOP.md` → `archive/merged-to-ai-sdd/COMBINED-AGENTIC-LOOP.md`
- `docs/AGENT-LOOP-PATTERN.md` → `archive/merged-to-ai-sdd/AGENT-LOOP-PATTERN.md`

**Add to each archived file (prepend):**
```markdown
> **Archived:** This feature was merged into [ai-sdd](https://github.com/<org>/ai-sdd)
> as part of the coding-standards → ai-sdd integration. See ai-sdd's
> `specs/merge-coding-standards/MERGE-PLAN-v2.md` for details.
>
> The ai-sdd equivalents are:
> - State machine → `src/types/index.ts` (VALID_TRANSITIONS) + `src/core/state-manager.ts`
> - Event routing → `src/observability/emitter.ts`
> - Phase dispatch → `src/adapters/` + `src/core/engine.ts`
> - Iteration limits → `max_rework_iterations` in engine defaults
```

**Ticket: RCS-001**

---

### Phase 2 — Update Documentation (1 day)

Update coding-standards documentation to clarify the split and point users to ai-sdd
for enforcement features.

#### 2.1 README.md — Add integration section

Add a new "Integration with ai-sdd" section explaining:
- coding-standards provides analysis tools; ai-sdd provides enforcement
- How to use coding-standards MCP server alongside ai-sdd
- What was moved to ai-sdd and where to find it

**Ticket: RCS-002**

#### 2.2 CLAUDE.md — Remove orchestration instructions

The coding-standards CLAUDE.md contains orchestration directives (requirements-first
protocol, phase routing, pre-flight checklists) that are now ai-sdd's responsibility.

- Remove or reduce orchestration sections
- Keep coding-standards-specific analysis instructions
- Add "For task orchestration and enforcement, see ai-sdd" pointer

**Ticket: RCS-003**

#### 2.3 AGENTS.md — Add ai-sdd note

Add a brief note at the top: "Task orchestration, state management, and governance
enforcement are handled by ai-sdd. This project provides read-only analysis tools."

**Ticket: RCS-004**

#### 2.4 agents/constitution.md — Add cross-reference

Keep the 10 rules (they're still good guidance) but add:
- Note that rules #2 (requirements.lock immutability), #4 (no gold-plating), and
  #5 (planning review) are now enforced at runtime by ai-sdd overlays
- Cross-reference to ai-sdd's constitution resolver

**Ticket: RCS-005**

#### 2.5 toolgate.yaml — Add overlay cross-reference

Add comment header explaining that tool gates are now enforced by ai-sdd's
`PolicyGateOverlay` and this file serves as a reference template.

**Ticket: RCS-006**

#### 2.6 workflow/index.md — Update after archival

Remove references to archived files. Update links.

**Ticket: RCS-007**

#### 2.7 MANUAL.md — Add ai-sdd section

Add a section in the manual explaining the ai-sdd integration pattern:
- coding-standards as MCP server called by ai-sdd agents during execution
- coding-standards CLI called by CI pipelines
- ai-sdd handles orchestration, coding-standards handles analysis

**Ticket: RCS-008**

---

### Phase 3 — MCP Server Enhancement (2 days)

With the split clarified, enhance the MCP server to be the primary interface for
ai-sdd agents calling coding-standards tools.

#### 3.1 Add high-level query tools to MCP server

The MCP server currently exposes 6 graph-level tools. Add convenience tools that
wrap the QueryEngine and ValidationEngine for direct use by ai-sdd agents:

| Tool | Wraps | Purpose |
|------|-------|---------|
| `validate_lock` | ValidationEngine | Run all 9 rules, return violations |
| `find_gaps` | QueryEngine.findAllGaps() | Aggregate gap analysis |
| `impact_analysis` | QueryEngine.getImpactChain() | What breaks if X changes |
| `coverage_report` | QueryEngine.getRequirementCoverage() | REQ→TASK→TEST chains |
| `dependency_chain` | QueryEngine.getDependencyChain() | Task ordering analysis |
| `available_tasks` | QueryEngine.getAvailableTasks() | Ready-to-work tasks |

These are all **read-only** — they report without blocking.

**Ticket: RCS-009**

#### 3.2 Add resource endpoints

Expose key schemas as MCP resources so agents can read them without file access:
- `requirements-input.schema.yaml`
- `requirements-lock.md` (immutability contract)
- `acceptance-criteria-format.md`

**Ticket: RCS-010**

---

### Phase 4 — CI Template Updates (0.5 days)

Update CI templates and scripts to clarify which project handles what.

#### 4.1 Update CI references

If any CI templates in coding-standards reference enforcement commands that are now
in ai-sdd, update them to call `ai-sdd` CLI instead (or document the split).

**Ticket: RCS-011**

#### 4.2 Add ai-sdd interop test

Add a test that verifies the MCP server tools work correctly when called with
typical ai-sdd agent request patterns.

**Ticket: RCS-012**

---

## 4. Task Summary

| ID | Phase | Description | Size | Depends |
|----|-------|-------------|------|---------|
| RCS-001 | 1 | Archive redundant files to `archive/merged-to-ai-sdd/` | XS | — |
| RCS-002 | 2 | Add ai-sdd integration section to README.md | XS | RCS-001 |
| RCS-003 | 2 | Remove orchestration from CLAUDE.md, add ai-sdd pointer | S | RCS-001 |
| RCS-004 | 2 | Add ai-sdd note to AGENTS.md | XS | RCS-001 |
| RCS-005 | 2 | Add cross-references to agents/constitution.md | XS | RCS-001 |
| RCS-006 | 2 | Add overlay cross-reference to toolgate.yaml | XS | RCS-001 |
| RCS-007 | 2 | Update workflow/index.md after archival | XS | RCS-001 |
| RCS-008 | 2 | Add ai-sdd integration section to MANUAL.md | S | RCS-001 |
| RCS-009 | 3 | Add 6 high-level query tools to MCP server | M | RCS-001 |
| RCS-010 | 3 | Add MCP resource endpoints for schemas | S | RCS-009 |
| RCS-011 | 4 | Update CI template references | XS | RCS-001 |
| RCS-012 | 4 | Add ai-sdd interop test for MCP server | S | RCS-009 |

**Total estimate: ~4 days**

---

## 5. What Does NOT Change

- MCP server graph tools (`graph_init`, `graph_add_node`, etc.) — untouched
- QueryEngine (11 query methods) — untouched
- ValidationEngine (9 rules) — untouched
- All bash analysis scripts except archived 2 — untouched
- All schemas (`requirements-input`, `requirements-lock`) — untouched
- All examples and templates — untouched
- `java/` and `kotlin/` language standards — untouched
- `plans/` directory — untouched
- `tests/` directory — untouched

---

## 6. Verification

After refactor:

1. `npm test` in `tools/mcp-server/` — passes
2. `npm test` in `tools/validators/` — passes
3. `npm test` in `tools/query-engine/` — passes
4. All remaining bash scripts run without errors
5. MCP server starts and responds to all 6 + 6 new tools
6. No dangling references to archived files in documentation
7. README.md clearly states the ai-sdd integration pattern
8. Archived files have prepended notes explaining the move

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Breaking coding-standards for non-ai-sdd users | No tools removed; only docs updated and redundant files archived |
| Archive creates confusion | Clear archive header with ai-sdd pointers |
| MCP server changes break existing clients | New tools are additive; existing 6 tools untouched |
| CI templates reference wrong project | RCS-011 audits and updates all CI references |
