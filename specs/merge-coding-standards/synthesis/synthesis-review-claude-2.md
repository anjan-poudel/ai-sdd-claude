# Synthesis Review: merged-claude.md vs merged-codex.md

**Date:** 2026-03-05
**Author:** Claude Sonnet 4.6 (synthesis review pass)
**Files reviewed:**
- `specs/merge-coding-standards/merged-claude.md` — merged by Claude Sonnet 4.6, dated 2026-03-04
- `specs/merge-coding-standards/merged-codex.md` — merged by Codex / GPT-4o, dated 2026-03-03
- `specs/merge-coding-standards/review_of_merged_claude-gemini.md` — reviewed by Gemini, dated 2026-03-04 (prior reviewer context only)

---

## 1. Document Overview

### `merged-claude.md`
A **hybrid implementation spec**: half architectural decision record, half implementation guide. It is structured as a justified merge decision followed by a four-phase implementation plan with TypeScript code snippets, exact file paths, exit criteria per phase, and a feature-to-file map. The author style is technical and direct — it names specific symbols (`VALID_TRANSITIONS`, `PolicyGateOverlay.postTask`, `complete-task.ts` Step 2.5) and writes working code rather than prose descriptions of code. The tone is confident and explicit about rejections with stated rationale. The document reads as if written by someone who actually explored the codebase before proposing changes.

### `merged-codex.md`
A **planning and sequencing document** that reads more like a project backlog with phase summaries than a technical spec. It is structured as an incremental plan (Phase 0 through E) with scope bullets and exit criteria, but without code snippets or concrete file-level guidance. The feature attribution table is brief (six lines for `claude.md` contributions). The author style is strategic rather than tactical — it describes what each phase accomplishes but leaves the how for implementers to figure out. It explicitly calls out the tristate governance flag and a 10-ticket backlog as its most concrete artifacts.

### Key characterisation difference
`merged-claude.md` is a **developer handoff document** — a competent engineer could implement from it without asking clarifying questions about structure. `merged-codex.md` is a **project manager handoff document** — it establishes what to do and in what order, but requires significant additional design work before implementation begins.

---

## 2. Pros and Cons — Per Document

### `merged-claude.md`

**Strengths**

1. **Codebase fidelity.** Every integration point names the specific file and symbol that will change. The scope drift gate is shown at the exact method level (`PolicyGateOverlay.postTask`). The AC coverage gate is placed at Step 2.5 of the `complete-task` six-step transaction. This eliminates an entire class of architectural error that occurs when a spec is vague about where something lives.

2. **Working code snippets.** TypeScript snippets for every schema change, every new gate, the spec hash check in `engine.ts`, and the AC coverage check in `complete-task.ts` are present. These are not pseudocode — they use the project's actual types and conventions (`createHash("sha256")`, `stateManager.patch`, `emitter.emit`).

3. **Explicit rejection table.** The "What NOT to Merge" section is the most valuable single section in either document. It categorically rejects `REQUIREMENTS_VALIDATED` as a new task state and lists seven other features with rationale. This prevents wasted implementation effort and architecture violations before they happen.

4. **Architectural invariant preservation.** It explicitly states that new overlay chain insertion point (`HIL → Planning Review → Evidence Gate → ...`) is a contract update to `src/overlays/composition-rules.ts`, and that all new task fields are `optional` to maintain backward compatibility. The merger took the architectural constraints seriously.

5. **Phase exit criteria are verifiable.** Each exit criterion is a concrete observable — a specific command produces a specific exit code, a specific event is emitted, a specific state transition occurs. These are testable, not aspirational.

6. **Sub-gate naming.** By adopting `deepseek.md`'s Gate 0/2/2b/4 naming and embedding it in failure messages, it creates a diagnostic convention that operators can use to debug gate failures without reading source code.

**Weaknesses**

1. **Loose `handover_state` contract for gates.** Gate 2b (budget check) and the AC coverage check in `complete-task` both read from `handover_state` fields (`new_files_created`, `loc_delta`, `ac_coverage`) that are not typed on the `HandoverState` interface. The code casts to `Record<string, unknown>` and uses `typeof hs[c.key] === "number"`. If an agent does not report these fields, the gates silently do nothing. This is the single most dangerous implementation gap in the document, because it creates a governance feature that looks active but isn't.

2. **No mention of how agents learn to populate `handover_state` fields.** The document adds schema fields to `TaskDefinition` and gates that read from `handover_state`, but it does not update the agent prompt templates or constitution to tell agents what they must report. Without this, agents will not know to include `ac_coverage`, `new_files_created`, etc. The Phase 1 agent constitution content does not mention `handover_state` reporting requirements.

3. **The `PlanningReviewOverlay` response parsing is underspecified.** The spec says "Parse response: `APPROVED` → proceed; `NEEDS_WORK` → `NEEDS_REWORK`" but does not say what happens when the reviewer returns neither token, returns partial JSON, or times out. For a new overlay that sits in the critical path before every dispatched task, this is an operational gap.

4. **Phase 4 CI template script paths are fragile.** The GitHub Actions template calls `.ai-sdd/scripts/reproducibility-check.sh` but the scripts are placed at `data/integration/scripts/` and copied by `ai-sdd init`. This means the CI template only works after `ai-sdd init` has been run and the scripts have been copied. This dependency is implicit.

5. **Success metrics (Section 7) are not linked to phase exit criteria.** Metric 2 ("80% of scope-drift class issues caught by Gate 2") has no baseline, no measurement mechanism, and no exit criterion in any phase that confirms this target is met. The metrics are adopted from `codex.md` but not operationalised.

6. **Imprecise framing of external modules as non-existent.** The "What NOT to Merge" section dismisses `tools/validators` and `tools/query-engine` as not present in the codebase. As a statement about `ai-sdd-claude` this is accurate — they do not exist inside this repo. However, both directories exist in the separate `coding-standards` repository (`tools/query-engine/` and `tools/validators/`). Calling them "hallucinated" is imprecise; the real issue is that `merged-codex.md` proposes a cross-repo integration dependency. Whether `ai-sdd-claude` should take such a dependency is an open integration architecture decision, not a settled factual question. The imprecise framing forecloses the decision without making it explicit.

---

### `merged-codex.md`

**Strengths**

1. **Phase ordering protects against over-reach.** By leading with Phase 0 (MCP/traceability enablement) before any schema changes, it ensures tooling delivers value before enforcement mechanisms are added. This is a safer adoption sequence than `merged-claude.md`'s Phase 1 (docs) → Phase 2 (schema + gates) ordering, because visibility precedes blocking.

2. **The 10-ticket backlog is immediately actionable.** Section 6 provides a flat, prioritised list of concrete implementation tickets. This is the most sprint-ready artifact in either document and requires no further decomposition by a project manager.

3. **Explicit non-goals are stated correctly.** It avoids multi-project/org-scale scope, state machine replacement, and deep adapter refactors — the same constraints as `merged-claude.md` but more prominently placed.

4. **Comparative review section (Section 2) is honest.** Acknowledging `claude.md`'s strengths ("best zero-code wins," "most concrete new overlay feature design") while choosing a different foundation is analytically credible.

5. **Success criteria in Section 7 include the `NEEDS_REWORK` rate metric.** This is the only place either document mentions measuring the planning review's downstream impact on rework rate. This is the right success metric for the overlay.

**Weaknesses**

1. **No code.** Not a single TypeScript snippet, type definition, or shell script appears in the entire document. For a project with strict architectural invariants and an existing complex overlay system, a plan without code is a plan that will be interpreted inconsistently by different implementers.

2. **Phase C proposes cross-repo integration of `coding-standards` modules.** Point 1 of Phase C scope says "Integrate `tools/validators` and `tools/query-engine`." Both directories exist in the `coding-standards` repository but are not part of `ai-sdd-claude`. `merged-codex.md` is proposing a cross-repo dependency — which may or may not be desirable. This is not a straightforward inclusion that `merged-claude.md` erred in rejecting; it is an open integration architecture decision (see Section 3.2).

3. **No overlay chain update.** Phase D says "Chain order update: `HIL -> Planning Review -> Policy Gate -> Review/Paired/Confidence`" but does not mention that `src/overlays/composition-rules.ts` enforces this order as a locked invariant. A developer following this plan could add the overlay in the wrong position and not discover the error until tests fail.

4. **File-level guidance is absent.** "Add `PlanningReviewOverlay` (opt-in first)" does not say where the file goes, what the class must implement, or how it registers with the overlay chain. "Add requirements intake schemas and validator command path" does not name the schema file, the command, or the code path.

5. **Phase 0 MCP enablement is sequenced before the traceability CLI exists.** Phase 0 registers MCP tools for `traceability.gaps` and `traceability.validate_lock`, but the CLI command that backs these tools is not built until Phase C. The MCP tools would be registered but non-functional for the duration of Phases A and B. This is an ordering error.

6. **The governance tristate flag is mentioned but not specified.** Phase B says "Add optional lock support: `governance.requirements_lock: off|warn|enforce`" and "lock mode validation (`greenfield|brownfield`)" — but `greenfield|brownfield` appears nowhere else in either document and is not defined. This appears to conflate the governance adoption tristate with a project-type flag from a different feature.

7. **Success criteria in Section 7 are weaker than the metrics in `merged-claude.md`.** "Reduced `NEEDS_REWORK` rate after planning review adoption" has no target percentage. "% releases passing readiness checklist without bypass" has no threshold. These are the right dimensions but they do not constitute measurable criteria.

---

## 3. Meaningful Differences

### 3.1 Foundation Choice Rationale

**merged-claude.md:** Chose `claude.md` as foundation because of codebase fidelity — naming specific files and symbols at every integration point. The foundation provides concrete TypeScript and a clear "What NOT to Merge" table.

**merged-codex.md:** Chose `codex.md` as foundation because of better incremental phase sequencing and lower over-commitment risk.

**Verdict: merged-claude.md is better.** The foundation choice is not really about the source document — it is about whether the merged output has codebase fidelity. `merged-codex.md` acknowledges `claude.md` has "best zero-code wins" and "most concrete new overlay feature design" but then uses `codex.md` as a foundation anyway, resulting in a plan without code or file references. The foundation should be whichever produces the better output, and by every technical measure, `merged-claude.md` produces the more implementable output.

---

### 3.2 Treatment of `tools/validators` and `tools/query-engine`

**merged-claude.md:** Excludes these as not present in `ai-sdd-claude`. The traceability CLI will be implemented natively in `src/cli/commands/traceability.ts`. The framing as "hallucinated" is imprecise — both directories exist in the `coding-standards` repo, they simply are not part of `ai-sdd-claude`.

**merged-codex.md:** Phase C, Point 1: "Integrate `tools/validators` and `tools/query-engine`." This implicitly proposes that `ai-sdd-claude` take a cross-repo dependency on `coding-standards/tools/`.

**Verdict: Open integration decision — see Open Decisions section.** `tools/validators` and `tools/query-engine` exist in the separate `coding-standards` repo but are not part of `ai-sdd-claude`. `merged-codex.md` proposes a cross-repo integration dependency. `merged-claude.md` excludes them as out-of-scope for this proposal. Neither is definitively right — this is an integration architecture decision: should `ai-sdd-claude` take a runtime dependency on `coding-standards/tools/`? The synthesis defers this as an explicit open decision rather than auto-accepting or auto-rejecting.

---

### 3.3 Phase Ordering: MCP Tooling vs. CLI Implementation

**merged-claude.md:** MCP tools are defined in Phase 3, after the traceability CLI is built in the same phase. The two MCP tools delegate to the CLI commands. Correct dependency order.

**merged-codex.md:** Phase 0 registers MCP tools before Phase C builds the underlying CLI. The MCP tools would exist but have no implementation behind them for the duration of two phases.

**Verdict: merged-claude.md has the correct ordering.** Registering MCP tools before the implementation exists is not "early value" — it is dead surface area that creates confusion when developers try to call it.

---

### 3.4 Depth of Planning Review Overlay Specification

**merged-claude.md:** Specifies the overlay file location (`src/overlays/planning-review/planning-review-overlay.ts`), its four-step `preTask` behaviour, the config block in `ai-sdd.yaml`, and the overlay chain position update to `composition-rules.ts`. Also specifies the `block_on_needs_work: true` config flag.

**merged-codex.md:** "Add `PlanningReviewOverlay` (opt-in first). Chain order update: `HIL -> Planning Review -> Policy Gate -> Review/Paired/Confidence`." Two sentences.

**Verdict: merged-claude.md is clearly better.** The composition rules enforcement is an invariant that the document must address explicitly. Two sentences do not constitute a specification.

---

### 3.5 Governance Tristate Flag Specification

**merged-claude.md:** Fully specifies the `GovernanceMode = "off" | "warn" | "enforce"` type, the `GovernanceConfig` interface, the `run` preflight behaviour for each mode (hard fail vs. warning event with continuation), and where the mode applies (lock enforcement, scope drift gate, AC coverage check).

**merged-codex.md:** Names the tristate flag in Phase B scope. Separately mentions "lock mode validation (`greenfield|brownfield`)" which appears to be a different, undefined concept from a different source.

**Verdict: merged-claude.md is better.** The `greenfield|brownfield` reference in `merged-codex.md` is unexplained and inconsistent — it conflates two separate concepts without defining either.

---

### 3.6 The `NEEDS_REWORK` Rate Success Metric

**merged-claude.md:** Does not include this metric. Success metrics focus on deterministic gate outcomes, scope-drift catch rate, and traceability gap trends.

**merged-codex.md:** Section 7: "Reduced `NEEDS_REWORK` rate after planning review adoption." This is the only place either document acknowledges that the planning review overlay's success should be measurable by its downstream effect on rework.

**Verdict: merged-codex.md introduces a metric that should be adopted.** The `NEEDS_REWORK` rate is a direct and meaningful proxy for the overlay's value. The metric needs a target percentage to be actionable, but the dimension is correct.

---

### 3.7 The 10-Ticket Implementation Backlog

**merged-claude.md:** Has a Feature-to-File map (Section 8) but no flat ticket list.

**merged-codex.md:** Section 6 provides 10 concrete, prioritised implementation tickets.

**Verdict: merged-codex.md's backlog is a useful addition.** The 10 tickets are generally correct and could be used directly to create sprint work. This section is complementary to, not in conflict with, `merged-claude.md`'s phase plan.

---

### 3.8 Explicit Non-Goals

Both documents have explicit non-goals. They are substantially the same: no state machine replacement, no org-scale tooling, no ML/predictive features, no monolithic merge. `merged-claude.md`'s list is more granular (9 items) and includes more specifics (e.g., names the `REQUIREMENTS_VALIDATED` state as a hard reject). `merged-codex.md`'s list is 4 items and is less specific.

**Verdict: merged-claude.md's non-goals section is more valuable** because it names the specific rejection reasons rather than just categories.

---

## 4. Points of Agreement

These are settled — both documents agree and there is no meaningful conflict:

1. The governance tristate flag (`off|warn|enforce`) is the right adoption mechanism. Not a boolean.
2. New `TaskDefinition` fields (`acceptance_criteria`, `requirement_ids`, `scope_excluded`, `budget`, `phase`) should be optional and additive.
3. `VALID_TRANSITIONS` must not be changed. `REQUIREMENTS_VALIDATED` is not a valid new state.
4. `PlanningReviewOverlay` should be opt-in (`enabled: false` by default).
5. The `ai-sdd traceability` command should be a standalone CLI command, not bundled into `validate-config`.
6. MCP tools for governance should extend `src/integration/mcp-server/server.ts`, not replace it.
7. Phase-based model routing should follow the precedence: task override > phase routing profile > adapter default.
8. Scripts and CI templates should be distributed via `ai-sdd init`, not manually installed.
9. Language-specific standards (Java, Kotlin) do not apply — ai-sdd is TypeScript-only.
10. Agent constitution and the confidence/GO protocol belong in agent `.md` prompt templates.

---

## 5. Proposed Synthesis

The following is a concrete merged standard that resolves all meaningful differences. It uses `merged-claude.md` as the structural foundation (because it has codebase fidelity and working code), augments it with the correct elements from `merged-codex.md`, and corrects the defects in both.

---

### SECTION 1: Foundation and Approach

1. `merged-claude.md` is the implementation reference. All code snippets, type definitions, file paths, and gate implementation details in `merged-claude.md` are adopted without modification.

2. `merged-codex.md`'s 10-ticket backlog (Section 6) is adopted as the sprint-level decomposition of Phase 1 and Phase 2 work. Ticket numbering maps to phase tasks.

3. `tools/validators` and `tools/query-engine` exist in the separate `coding-standards` repo but are not part of `ai-sdd-claude`. `merged-codex.md` proposes a cross-repo integration dependency; `merged-claude.md` excludes them as out-of-scope. This is an open integration architecture decision — see the Open Decisions section. Whether to integrate, adapt, or consciously implement equivalent functionality natively requires a deliberate, documented decision before Phase C begins.

---

### SECTION 2: Phase Ordering (Merged Decision)

Adopt `merged-claude.md`'s four-phase ordering with one correction: Phase 0 from `merged-codex.md` is rejected as an independent phase because it registers MCP tools before the implementation exists. MCP tool registration remains in Phase 3 (co-located with the traceability CLI), as `merged-claude.md` specifies.

Final phase sequence:

**Phase 1 — Zero-Code Wins** (1-2 days, zero risk)
- Agent constitution
- 90% confidence + GO protocol in scaffold/BA agents
- `toolgate.yaml` template distributed by `ai-sdd init`
- `plans/<feature>/` convention in CLAUDE.md

**Phase 2 — Schema Extensions + Governance Flag** (3-5 days, low risk)
- `GovernanceMode` tristate type and `GovernanceConfig` interface in `src/types/index.ts`
- `governance.requirements_lock` config block in `ai-sdd.yaml` schema
- `AcceptanceCriterion`, `TaskBudget` types; optional fields on `TaskDefinition`
- Spec hash tracking in `engine.ts run()` startup
- Gate 2 (scope drift) and Gate 2b (budget) in `PolicyGateOverlay.postTask`

**Phase 3 — Traceability CLI + Planning Review Overlay + MCP Tools** (5-8 days, medium risk)
Sequenced internally as:
  - 3a: Integration decision spike — resolve the open decision regarding `coding-standards/tools/validators` and `coding-standards/tools/query-engine` (see Open Decisions). Both exist in the separate `coding-standards` repo. Produce a go/no-go note covering: cross-repo dependency model, API stability, dependency footprint, and team alignment. Recommended default: implement natively.
  - 3b: `ai-sdd traceability` CLI (`src/cli/commands/traceability.ts`) — built using the outcome of 3a (implement natively by default; use `coding-standards` tools only if the integration decision explicitly approved it)
  - 3c: MCP tool registration (two tools only, delegating to 3b) — after 3b
  - 3d: `PlanningReviewOverlay` — parallelisable with 3b/3c
  - 3e: AC coverage gate in `complete-task` Step 2.5 — after Phase 2 governance flag exists

**Phase 4 — Tooling and CI/CD** (3-5 days, low risk)
- Adapted drift scripts in `data/integration/scripts/`
- GitHub Actions template (with corrected script path dependency documented)
- `check-budgets.sh`
- Phase-based model routing in `src/adapters/factory.ts`
- `data/task-library/regenerate-requirements-lock.yaml`

---

### SECTION 3: Schema and Types (Adopted from merged-claude.md verbatim)

All type definitions from `merged-claude.md` Phase 2 are adopted without modification:

```typescript
export type GovernanceMode = "off" | "warn" | "enforce";

export interface GovernanceConfig {
  requirements_lock?: GovernanceMode;
}

export interface AcceptanceCriterion {
  scenario: string;
  given: string | string[];
  when: string;
  then: string[];
  and?: string[];
}

export interface TaskBudget {
  max_new_files?: number;
  max_loc_delta?: number;
  max_new_public_apis?: number;
}
```

Added to existing `TaskDefinition`:
- `acceptance_criteria?: AcceptanceCriterion[]`
- `requirement_ids?: string[]`
- `scope_excluded?: string[]`
- `budget?: TaskBudget`
- `phase?: string`

All fields are `optional`. No existing field is modified. `VALID_TRANSITIONS` is not touched.

---

### SECTION 4: The `handover_state` Contract Gap (NEW — not in either document)

**Rule:** Before implementing Gate 2b (budget check) and the AC coverage gate in `complete-task`, a `GatedHandoverState` interface must be defined and agents must be told to populate it.

4.1 Add to `src/types/index.ts`:

```typescript
export interface GatedHandoverState {
  ac_coverage?: Record<string, boolean>;   // keyed by AcceptanceCriterion.scenario
  new_files_created?: number;
  loc_delta?: number;
  new_public_apis?: number;
  tests_passed?: boolean;
  blockers?: string[];
}
```

4.2 Gate 2b and AC coverage check must use this typed interface rather than `Record<string, unknown>`. Unknown `handover_state` shapes should produce a warning event (`governance.handover_state.untyped`) rather than silently doing nothing.

4.3 Add to the agent constitution (Phase 1):

```markdown
7. When a task has `budget` fields, report `new_files_created`, `loc_delta`, and
   `new_public_apis` in `handover_state`.
8. When a task has `acceptance_criteria`, report `ac_coverage` in `handover_state`
   as a map from scenario name to boolean.
```

This closes the most dangerous implementation gap in the plan. Without this rule, governance gates exist but never trigger.

---

### SECTION 5: Planning Review Overlay (Adopted from merged-claude.md with one addition)

All specification from `merged-claude.md` Phase 3.3 is adopted. One gap is closed:

**Rule:** The `PlanningReviewOverlay` must handle three response cases, not two:
- `APPROVED` (case-insensitive, may be embedded in prose) — proceed
- `NEEDS_WORK` (case-insensitive, may be embedded in prose) — `NEEDS_REWORK`
- Any other response (timeout, parse failure, ambiguous) — emit `planning_review.parse_failure` event; if `block_on_needs_work: true`, treat as `NEEDS_WORK`; if false, log warning and proceed

This prevents silent pass-through on reviewer failure.

The overlay chain order update in `src/overlays/composition-rules.ts` is mandatory and must be implemented as part of Phase 3c, not treated as optional documentation.

---

### SECTION 6: Success Metrics (Merged from both documents)

Technical metrics (from `merged-claude.md`):
1. PR gate outcomes are deterministic for the same input (0 flaky gate runs).
2. Greater than 80% of scope-drift class issues caught by Gate 2 before merge (baseline measured in first 4 sprints after Phase 2 deploy).
3. Traceability critical-gap count trends downward release-over-release.
4. Mean time to diagnose failed workflow run is measurable via schema-validated state artifacts.

Adoption metrics (from `merged-claude.md`):
1. Percentage of projects using `requirements.lock.yaml` with `governance.requirements_lock: enforce`.
2. Percentage of workflows executed with at least one task with `acceptance_criteria` declared.
3. Number of releases passing `ai-sdd traceability report` with zero critical gaps.

Additional metric (from `merged-codex.md` Section 7 — adopted with threshold):
4. `NEEDS_REWORK` rate for tasks in workflows that have `PlanningReviewOverlay` enabled, compared to a pre-adoption baseline. Target: at least 15% reduction within 60 days of Phase 3 completion. If no reduction is observed, the overlay's reviewer agent prompt should be revised before wider rollout.

---

### SECTION 7: What NOT to Implement (Synthesised and Definitive)

The following are rejected for this merge cycle. These are closed decisions, not to be reopened without a separate proposal:

| Feature | Reason |
|---------|--------|
| `REQUIREMENTS_VALIDATED` task state | Hard reject. Breaks `VALID_TRANSITIONS`. Architectural invariant. |
| `tools/validators` / `tools/query-engine` — cross-repo dependency | Open integration decision (see Open Decisions). Both modules exist in the separate `coding-standards` repo. Whether `ai-sdd-claude` should depend on them is an explicit open decision, not auto-accepted or auto-rejected. Recommended default: implement natively unless cross-repo dependency is justified and documented. |
| Phase 0 MCP registration before traceability CLI | Ordering error. MCP tools must be backed by implementation before registration. |
| Phase 5 ML / drift prediction (deepseek) | Defer indefinitely. Needs proven governance baseline first. |
| Multi-candidate evaluation engine | Out of scope. Changes the agent execution model. |
| Full MCP server unification (deepseek) | Separate project. Existing MCP server is working and in use. |
| `workflow/state-machine.yaml` from coding-standards | Superseded by TypeScript `VALID_TRANSITIONS`. YAML advisory is weaker. |
| `scripts/dryrun.sh`, `scripts/run-phase.sh` | Superseded by `--dry-run` and `--task` flags. |
| Language-specific standards (Java, Kotlin) | N/A. ai-sdd is TypeScript. |
| `greenfield|brownfield` lock mode flag | Undefined concept. Not in scope. If this refers to something specific, requires a new proposal. |

---

### SECTION 8: CI Template Path Dependency (NEW — gap from merged-claude.md)

**Rule:** The GitHub Actions template in `data/integration/.github/workflows/ai-sdd-gates.yml` must include a comment or conditional guard that makes the `ai-sdd init` dependency explicit:

```yaml
# PREREQUISITE: Run `ai-sdd init` to copy scripts to .ai-sdd/scripts/
# Without init, these script steps will fail with "file not found"
- name: Check scripts exist
  run: |
    test -f .ai-sdd/scripts/reproducibility-check.sh || \
      (echo "Run ai-sdd init first" && exit 1)
```

This prevents silent CI failures on projects that add the workflow template without running init.

---

## 6. What the Prior Gemini Review Adds

The Gemini review (`review_of_merged_claude-gemini.md`) reviewed only `merged-claude.md`. Its three recommendations:

### Recommendation 1: Formalise the `handover_state` schema for gates
**Worth incorporating: Yes, and this review has done so** as Section 4 above, which is more specific than the Gemini proposal. Gemini proposed a `GatedHandoverState` interface — this synthesis adopts that name and specifies the exact fields, plus adds the agent constitution rules that tell agents to populate these fields. Gemini identified the problem but did not close it; the synthesis closes it.

### Recommendation 2: De-risk Phase 3 by sequencing sub-tasks (3a/3b/3c/3d)
**Worth incorporating: Yes, and this review has adopted the sequencing** in Section 2 Phase 3 above. The sub-task ordering (CLI first, MCP second, overlay parallelisable, AC gate last) is the correct implementation sequence. This is the most practically useful addition from the Gemini review.

### Recommendation 3: Add a "Documentation & Onboarding" task
**Partially worth incorporating.** The concern is real: new governance features will not be adopted without documentation. However, "add a documentation task" is too vague as a synthesis recommendation. The more concrete response is:
- The agent constitution additions (Section 4.3 in this document) serve as the developer-facing contract for what agents must report.
- A user guide should be added to Phase 4 scope, not as a separate phase. One task: update `data/integration/claude-code/agents/constitution.md` (or equivalent) with the governance feature usage guide.

**Points from the Gemini review this synthesis disagrees with:** None. The three recommendations are all directionally correct, though this review provides more specific guidance than the Gemini review did. The Gemini review's tone ("exceptionally well-structured") was somewhat effusive given the `handover_state` gap it identified — a structural gap in a governance feature that renders it silently inoperative is not a minor risk.

---

## 7. Open Decisions

The following decisions require project-specific human input. Each includes a recommended default.

---

**OD-1: Does the `spec_hash` live in `workflow-state.json` or a separate `.ai-sdd/spec-hash.txt` file?**

`merged-claude.md` puts it in `workflow-state.json` under `requirements_lock.spec_hash`. The CI drift scripts in `merged-claude.md`'s Phase 4 also read it from there. This creates a single source of truth but means CI needs to parse JSON to read the hash.

**Recommended default:** Keep the hash in `workflow-state.json` as proposed. The traceability CLI (`ai-sdd traceability validate-lock`) already reads this file and can expose the hash without shell scripts needing to parse JSON directly.

---

**OD-2: What is the default `governance.requirements_lock` mode for new projects created by `ai-sdd init`?**

The choices are `off` (safest, lowest friction), `warn` (visible without blocking), or `enforce` (maximum protection, highest friction).

**Recommended default: `warn`.** `off` is too permissive as a default — it means governance is invisible on new projects. `enforce` will block workflows on projects that have not yet created a `requirements.lock.yaml`, breaking the init experience. `warn` makes governance visible from day one without blocking teams who have not set up the lock file.

---

**OD-3: Should the `PlanningReviewOverlay` run on every task in a workflow, or only tasks tagged with `phase: planning`?**

`merged-claude.md` does not restrict by phase — it is enabled globally when the overlay is on. This means it runs on implementation and review tasks too, which may be unnecessary overhead.

**Recommended default:** Restrict to tasks with `phase: planning` or `phase: design` when the overlay is enabled. Add a `phases: [planning, design]` config field to the overlay config block. A global enable with no phase filter is likely to generate reviewer fatigue and spurious `NEEDS_REWORK` transitions on tasks that do not produce plans.

---

**OD-4: What exact token does the reviewer agent emit to approve or reject in `PlanningReviewOverlay`?**

`merged-claude.md` uses `APPROVED` and `NEEDS_WORK` as unquoted parse tokens. These may collide with natural language in the reviewer's prose response.

**Recommended default:** Require the reviewer to emit a structured JSON block:

```json
{"planning_review": "APPROVED"}
```
or
```json
{"planning_review": "NEEDS_WORK", "reason": "..."}
```

This makes parsing unambiguous. The reviewer agent prompt template must include this output format requirement explicitly. The existing `handover_state` JSON convention is already established — this follows the same pattern.

---

**OD-5: Should `ai-sdd traceability gaps` exit with a non-zero code only on "critical" gaps, or on any gap?**

The plan says "`ai-sdd traceability gaps` returns non-zero exit code when critical gaps exist" (Phase 3 exit criterion 1). But "critical" is not defined.

**Recommended default:** A gap is critical when a task with `requirement_ids` declared has no corresponding requirement in `requirements.lock.yaml`, or vice versa — an unlinked requirement with no task. Gaps that are warnings only (e.g., no AC declared on a task) should produce exit code 0 with a warning message. This gives CI scripts a clean signal without over-triggering on partial adoption.

---

**OD-6: Who owns the `requirements.lock.yaml` in a project — the BA agent, the architect agent, or the human?**

`merged-claude.md` includes a `data/task-library/regenerate-requirements-lock.yaml` task assigned to `agent: architect`. The original coding-standards has the BA producing the requirements lock. The GO protocol in Phase 1 also involves the BA.

**Recommended default:** The BA agent produces the initial `requirements.lock.yaml` as the output of the requirements phase. The architect agent regenerates it (using the `regenerate-requirements-lock` task) when architectural drift is detected. The human reviews and approves any change to the lock file through a HIL gate. The current plan does not specify this ownership chain — it should be added to the agent constitution as a sentence.

---

**OD-7: Integration decision: `coding-standards/tools/` dependency**
`merged-codex.md` proposes using `tools/validators` and `tools/query-engine` from the `coding-standards` repo. `merged-claude.md` excludes them as out-of-scope. These modules exist in a separate repo. The question is whether `ai-sdd-claude` should depend on them. Recommended default: keep `ai-sdd-claude` self-contained and implement equivalent functionality natively, unless the `coding-standards` tools have a stable versioned API and the teams are aligned. Document this decision explicitly in the synthesis — do not leave it implicit.
