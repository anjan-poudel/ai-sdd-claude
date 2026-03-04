# Merged Proposal: coding-standards → ai-sdd (Foundation: `codex.md`)

Date: 2026-03-03
Inputs reviewed:
- `specs/merge-coding-standards/codex.md`
- `specs/merge-coding-standards/claude.md`
- `specs/merge-coding-standards/deepseek.md`

## 1. Foundation Choice and Rationale

I chose **`codex.md` as the foundation**.

Why:
1. It is the most implementation-oriented and least speculative.
2. It preserves `ai-sdd` runtime architecture (no invasive replacement of engine/state model).
3. It has clear incremental sequencing, explicit risks/mitigations, and concrete integration points.
4. It avoids overcommitting to long-range features that are not yet proven in this repo.

What I added from other proposals:
- From `claude.md`: high-value operational details that are immediately actionable (constitution, GO protocol, planning review overlay, scope budgets, diff-aware lock regeneration task, richer file mappings).
- From `deepseek.md`: Phase 0 MCP/query integration concept, stronger KPI framing, and adoption strategy improvements.

## 2. Comparative Review (Concise)

### `codex.md` strengths
1. Best baseline structure (A→E phases, low-risk order).
2. Strong focus on governance layers over current runtime.
3. Good non-goals and backward-compatibility stance.

### `claude.md` strengths
1. Best zero-code wins (agent constitution + confidence/GO protocol language).
2. Strong schema-level additions (acceptance criteria, scope_excluded, budgets).
3. Most concrete new overlay feature design (Planning Review overlay).

### `deepseek.md` strengths
1. Strong cross-project/MCP/query-engine framing.
2. Good organization-scale metrics and adoption framing.
3. Helpful emphasis on keeping ai-sdd strengths intact.

### Weaknesses to avoid in merged plan
1. Avoid monolithic “big merge”.
2. Avoid replacing ai-sdd state machine or orchestration model.
3. Avoid speculative advanced features before core governance controls are validated.

## 3. Merged Incremental Plan

## Phase 0 (New, from deepseek + codex constraints): MCP/Traceability Enablement
Goal: minimal MCP integration for governance tools without replacing ai-sdd MCP server.

Scope:
1. Register traceability/validation actions as MCP-exposed commands:
   - `traceability.gaps`
   - `traceability.validate_lock`
   - `traceability.coverage`
2. Keep existing `src/integration/mcp-server/server.ts` and extend tools, not server architecture.

Exit criteria:
1. MCP clients can trigger traceability checks through ai-sdd.
2. No regression in existing MCP tools (`status`, `run`, `hil` surfaces).

Why now:
- Unlocks tooling value early while keeping technical risk low.

---

## Phase A: Quality Gate Foundation (codex core + claude detail)
Goal: CI-level drift and reproducibility controls.

Scope:
1. Import/adapt scripts:
   - `spec-hash.sh`
   - `spec-hash-verify.sh`
   - `reproducibility-check.sh`
   - `semantic-drift-check.sh`
2. Add:
   - `toolgate.yaml` template
   - PR checklist template
   - CI workflow for gates
3. Add `check-budgets.sh` skeleton (from `claude.md`), initially `warn` mode.

Exit criteria:
1. PR gate workflow runs and fails predictably on drift violations.
2. Scope/budget checks are visible in CI output.

---

## Phase B: Requirements Lock + Intake Discipline (codex core + claude enhancements)
Goal: requirements-first governance in ai-sdd workflow preflight.

Scope:
1. Add requirements intake schemas and validator command path.
2. Add optional lock support in project config:
   - `governance.requirements_lock: off|warn|enforce`
   - lock mode validation (`greenfield|brownfield`)
3. Add spec-hash persistence in workflow state.
4. Add zero-code behavior from `claude.md`:
   - Agent constitution baseline
   - 90% confidence + explicit GO protocol in scaffold/BA prompts
   - planning artifact convention `plans/<feature>/`

Exit criteria:
1. `validate-config` validates intake/lock when present.
2. `run` enforces lock policy per governance mode.
3. Prompt templates include GO discipline and constitution guardrails.

---

## Phase C: Traceability + Policy Gate Expansion (codex core + claude detail + deepseek MCP use)
Goal: measurable REQ→TASK→TEST/CONTRACT traceability and enforcement.

Scope:
1. Integrate `tools/validators` and `tools/query-engine`.
2. Add CLI command `ai-sdd traceability`:
   - `validate-lock`
   - `gaps`
   - `coverage --requirement`
3. Expand task schema (from `claude.md`):
   - `acceptance_criteria` (Gherkin structure)
   - `requirement_ids`
   - `scope_excluded`
   - `budget` (max files/loc/apis)
4. Enforce in policy gate:
   - excluded-term violations
   - optional critical gap fail for T2

Exit criteria:
1. Gap report available in CLI + MCP.
2. T2 can be configured to block on critical traceability gaps.
3. Excluded-scope terms trigger deterministic gate failures.

---

## Phase D: New Overlay Capabilities (claude lead, codex-compatible)
Goal: pre-dispatch governance beyond post-task quality checks.

Scope:
1. Add `PlanningReviewOverlay` (opt-in first).
2. Chain order update:
   - `HIL -> Planning Review -> Policy Gate -> Review/Paired/Confidence`
3. Add `complete-task` extension for acceptance-criteria coverage evidence.

Exit criteria:
1. Planning review can block task execution before dispatch.
2. AC coverage can require rework when missing.

---

## Phase E: Governance Contracts + Model Routing + Release Ops
Goal: production hardening and scale-ready operations.

Scope:
1. Add schema checks for state/context examples in CI.
2. Add phase-based model routing profile support:
   - precedence: task override > routing profile > agent default
3. Add rollout/release-readiness checklists.
4. Add diff-aware lock regeneration task template.

Exit criteria:
1. Schema-validated ops artifacts in CI.
2. Phase-aware routing works in dry-run and live execution.
3. Release checklist used in first governance-enforced release.

## 4. Feature Attribution (What came from which proposal)

Selected from `codex.md`:
1. Entire incremental backbone (gates → lock → traceability → governance contracts → model routing).
2. Opt-in-to-enforce migration strategy.
3. Explicit non-goals to protect ai-sdd runtime architecture.

Selected from `claude.md`:
1. Agent constitution and 90% confidence + GO protocol.
2. `acceptance_criteria`, `requirement_ids`, `scope_excluded`, and `budget` schema additions.
3. Planning Review overlay design.
4. `check-budgets.sh` and diff-aware lock regeneration task concept.

Selected from `deepseek.md`:
1. Phase 0 MCP/query enablement framing.
2. Stronger KPI/adoption framing for org rollout.
3. Emphasis on extending ai-sdd MCP capabilities rather than creating parallel systems.

## 5. What We Explicitly Exclude for Now

1. Replacing ai-sdd state machine with coding-standards workflow YAML state machine.
2. Full multi-project/org-scale validation in first implementation wave.
3. Advanced predictive/ML features before baseline governance is proven.
4. Deep refactors of adapters/engine unrelated to governance merge.

## 6. Immediate Implementation Backlog (First 10 Tickets)

1. Add governance config block (`off|warn|enforce`) + type/schema wiring.
2. Import spec-hash + drift scripts and adapt for ai-sdd paths.
3. Add CI workflow to run governance gates.
4. Add `toolgate.yaml` + PR checklist templates to init output.
5. Update scaffold/BA agent templates with constitution + GO protocol.
6. Add requirements input schema validation in `validate-config`.
7. Add lock mode/hash preflight in `run`.
8. Add `ai-sdd traceability` CLI command scaffolding.
9. Extend policy gate with `scope_excluded` checks.
10. Expose traceability actions via MCP tools.

## 7. Success Criteria

Technical:
1. Deterministic gate outcomes in CI for the same input.
2. Traceability critical-gap count is measurable and trends down.
3. Reduced `NEEDS_REWORK` rate after planning review adoption.

Adoption:
1. % projects with governance mode at `enforce`.
2. % workflows using lock + acceptance criteria fields.
3. # releases passing readiness checklist without bypass.


