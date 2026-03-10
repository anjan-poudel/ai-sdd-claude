# Refactor Plan: coding-standards Post-Merge Cleanup

**Date:** 2026-03-07
**Branch:** feature/merge-coding-standards
**Status:** READY FOR REVIEW
**Target repo:** /Users/anjan/workspace/projects/coding-standards
**Companion plan:** specs/merge-coding-standards/MERGE-PLAN-v2.md

---

## 1. Context

The merge plan (MERGE-PLAN-v2.md) originally defined a two-project split. The
ecosystem has since grown to **three projects** with clear, non-overlapping roles
(see `docs/ecosystem-proposal-opus.md`):

| Project | Role | One-liner |
|---------|------|-----------|
| **repeatability-mcp-server (RMS)** | Traceability Engine | Builds, validates, queries, and exports requirements traceability graphs |
| **coding-standards (CS)** | Standards Library | Provides agent prompts, language-specific coding rules, schemas, and CI validation scripts |
| **ai-sdd** | Orchestrator | Dispatches tasks to agents, manages workflow state, and enforces governance |

The merge direction (coding-standards → ai-sdd) is complete or in-progress via the
18 MCS tasks. This plan covers the **reverse direction**: pruning coding-standards to
eliminate redundancy, update documentation to point at ai-sdd for enforcement,
redirect graph/query tooling to RMS, and ensure the remaining content works cleanly
as a standalone standards library.

**Key ecosystem insight:** CS's graph tools (6 MCP tools, 9 validators, 11 query
methods) are a simplified fork of RMS (6 MCP tools, 20+ validators, 14 query
patterns). Rather than enhancing CS's graph tools, new graph/query features should
go to RMS. CS should evolve toward being a pure knowledge base: prompts + standards
+ schemas + scripts.

---

## 2. Inventory: What coding-standards Contains Today

### Tools (3 NPM packages) — KEEP (deprecation path planned)

| Package | Location | Purpose | Verdict |
|---------|----------|---------|---------|
| `@coding-standards/mcp-server` | `tools/mcp-server/` | Graph building + querying (6 MCP tools) | **KEEP** — deprecated once RMS integration is live |
| `@coding-standards/validators` | `tools/validators/` | 9 validation rules (informational lint) | **KEEP** — superset in RMS (20+ rules) |
| `@coding-standards/query-engine` | `tools/query-engine/` | 11 graph query methods + CLI | **KEEP** — superset in RMS (14 patterns) |

> **Deprecation note:** These packages work today and should continue to work for
> non-ai-sdd users. However, new graph/query/validation features should be added
> to **repeatability-mcp-server**, not here. Once RMS is wired into ai-sdd (Phase 2
> of ecosystem proposal), CS graph tools become redundant. See `docs/ecosystem-proposal-opus.md` §Migration.

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

### Phase 3 — MCP Server: Resources + RMS Redirect (1.5 days)

With the three-project ecosystem clarified, CS's MCP server role is to expose
**schemas and standards as resources** — not to duplicate graph/query tooling that
RMS already provides.

#### 3.1 Redirect query tools to RMS (NO new tools in CS)

~~The original plan proposed adding 6 high-level query tools to the CS MCP server.~~
**This is now redirected to repeatability-mcp-server (RMS)**, which already has
equivalent (and more powerful) implementations:

| Originally Proposed for CS | RMS Equivalent |
|---------------------------|----------------|
| `validate_lock` | `graph_validate` with all rulesets (20+ rules vs CS's 9) |
| `find_gaps` | `graph_query` pattern `gaps` / `QueryEngine.findAllGaps()` |
| `impact_analysis` | `graph_query` pattern `impact_chain` / `QueryEngine.getImpactChain()` |
| `coverage_report` | `QueryEngine.getRequirementCoverage()` / `getFullyCoveredRequirements()` |
| `dependency_chain` | `graph_query` pattern `dependency_chain` / `QueryEngine.getDependencyChain()` |
| `available_tasks` | `graph_query` pattern `available_tasks` / `QueryEngine.getAvailableTasks()` |

**RCS-009 is now:** Add convenience wrapper tools to RMS (load lock → build graph →
run query → return JSON). This work is tracked in the RMS repo, not here.

**What CS does instead:** Add a brief `tools/mcp-server/DEPRECATION.md` noting
that new query/validation features go to RMS, and update the MCP server README
to reference RMS for advanced queries.

**Ticket: RCS-009** (reduced from M to XS — doc-only change in CS)

#### 3.2 Add resource endpoints

Expose key schemas as MCP resources so agents can read them without file access.
This is squarely in CS's domain — schemas ARE standards:

- `requirements-input.schema.yaml`
- `requirements-input.po.schema.yaml`
- `requirements-lock.md` (immutability contract)
- `acceptance-criteria-format.md`

**Ticket: RCS-010** (no longer depends on RCS-009)

---

### Phase 4 — CI Template Updates (0.5 days)

Update CI templates and scripts to clarify which project handles what.

#### 4.1 Update CI references

If any CI templates in coding-standards reference enforcement commands that are now
in ai-sdd, update them to call `ai-sdd` CLI instead (or document the split).

**Ticket: RCS-011**

#### 4.2 Add ai-sdd interop test

Add a test that verifies the CS MCP server resource endpoints and existing graph
tools work correctly when called with typical ai-sdd agent request patterns.
Also verify that CS graph tool results are consistent with RMS results when given
the same lock file input (cross-project compatibility).

**Ticket: RCS-012** (no longer depends on RCS-009 — tests existing tools + resources)

---

## 4. Task Summary

| ID | Phase | Description | Size | Depends |
|----|-------|-------------|------|---------|
| RCS-001 | 1 | Archive redundant files to `archive/merged-to-ai-sdd/` | XS | — |
| RCS-002 | 2 | Add ai-sdd + RMS integration section to README.md | XS | RCS-001 |
| RCS-003 | 2 | Remove orchestration from CLAUDE.md, add ai-sdd pointer | S | RCS-001 |
| RCS-004 | 2 | Add ai-sdd note to AGENTS.md | XS | RCS-001 |
| RCS-005 | 2 | Add cross-references to agents/constitution.md | XS | RCS-001 |
| RCS-006 | 2 | Add overlay cross-reference to toolgate.yaml | XS | RCS-001 |
| RCS-007 | 2 | Update workflow/index.md after archival | XS | RCS-001 |
| RCS-008 | 2 | Add ai-sdd integration section to MANUAL.md | S | RCS-001 |
| RCS-009 | 3 | Add DEPRECATION.md + redirect query tools to RMS | XS | RCS-001 |
| RCS-010 | 3 | Add MCP resource endpoints for schemas | S | RCS-001 |
| RCS-011 | 4 | Update CI template references | XS | RCS-001 |
| RCS-012 | 4 | Add ai-sdd interop test (resources + graph tools) | S | RCS-010 |

**Total estimate: ~3 days** (reduced — RCS-009 is now doc-only in CS)

---

## 5. What Does NOT Change (now)

- MCP server graph tools (`graph_init`, `graph_add_node`, etc.) — **functional but frozen**; no new features (go to RMS instead)
- QueryEngine (11 query methods) — **functional but frozen**; RMS has 14 patterns
- ValidationEngine (9 rules) — **functional but frozen**; RMS has 20+ rules
- All bash analysis scripts except archived 2 — untouched
- All schemas (`requirements-input`, `requirements-lock`) — untouched; **CS owns these permanently**
- All examples and templates — untouched
- `java/` and `kotlin/` language standards — untouched
- Agent prompts (`coder.md`, `code-reviewer.md`, etc.) — untouched; **CS owns these permanently**
- `plans/` directory — untouched
- `tests/` directory — untouched (existing tests still run; no new graph tool tests)

> **"Frozen" means:** The code works, tests pass, non-ai-sdd users can still use it.
> But new graph/query/validation features go to RMS, not here. Eventually (Phase 3
> of the ecosystem migration), these packages will be deprecated once ai-sdd agents
> use RMS directly.

---

## 6. Verification

After refactor:

1. `npm test` in `tools/mcp-server/` — passes (existing 6 tools still work)
2. `npm test` in `tools/validators/` — passes
3. `npm test` in `tools/query-engine/` — passes
4. All remaining bash scripts run without errors
5. MCP server starts and responds to 6 tools + 4 resource endpoints
6. No dangling references to archived files in documentation
7. README.md clearly states the three-project ecosystem and CS's role
8. Archived files have prepended notes explaining the move
9. `DEPRECATION.md` in `tools/mcp-server/` explains RMS as the future for graph tools

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Breaking coding-standards for non-ai-sdd users | No tools removed; only docs updated and redundant files archived |
| Archive creates confusion | Clear archive header with ai-sdd pointers |
| MCP server changes break existing clients | Existing 6 graph tools untouched; only resource endpoints added |
| CI templates reference wrong project | RCS-011 audits and updates all CI references |
| RMS not ready when CS graph tools are frozen | CS tools still work indefinitely; "frozen" means no new features, not removed |
| Three-repo coordination overhead | Lock file format is the only shared contract; versioned with `metadata.version` |
| Users confused about CS vs RMS for graph queries | DEPRECATION.md + README explain which project to use for what |
