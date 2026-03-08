# Coding Standards → ai-sdd Merge Plan

**Date:** 2026-03-06
**Branch:** feature/merge-coding-standards
**Status:** READY FOR IMPLEMENTATION

---

## Quorum Summary

Five model reviews were synthesised across four passes (Claude Sonnet 4.6 ×2, Codex/GPT-4o ×1, Gemini ×2). Decisions are annotated with the model(s) that drove them and approximate weight of agreement.

| Shorthand | Full identity |
|-----------|--------------|
| C2 | Claude Sonnet 4.6 (synthesis-review-claude-2.md) |
| CX | Codex / GPT-4o (synthesis-review-codex.md) |
| G1 | Gemini (synthesis-review-gemini.md) |
| G2 | Gemini — critical (critical_synthesis_review.md) |
| G3 | Gemini — final (final_synthesis_review.md) |

---

## Resolved Principles

These are fully agreed across all reviewers and are non-negotiable in implementation.

| # | Principle | Agreement |
|---|-----------|-----------|
| P1 | Native TypeScript implementation; no cross-repo runtime dependency on `coding-standards/tools/*` | 5/5 (all) |
| P2 | `VALID_TRANSITIONS` state machine is untouched; no `REQUIREMENTS_VALIDATED` state | 5/5 (all) |
| P3 | All new `TaskDefinition` fields are `optional`; zero breaking changes to existing workflows | 5/5 (all) |
| P4 | MCP tools registered only after backing CLI commands exist (MCP must not be dead surface area) | C2, G1, G2, G3 — 4/5 |
| P5 | Governance features default to `warn`; `enforce` is opt-in | C2, CX, G1 — 3/5 |
| P6 | `PlanningReviewOverlay` is opt-in (`enabled: false` default) | 5/5 (all) |
| P7 | Agent constitution and GO protocol belong in agent `.md` prompt templates | 5/5 (all) |
| P8 | Scripts and CI templates distributed via `ai-sdd init`, not manual install | 5/5 (all) |
| P9 | `GatedHandoverState` typed interface required before gates that read from `handover_state` | C2 (identified gap), G1 (adopted) |
| P10 | `coding-standards/tools/` directories exist in a separate repo; integration requires explicit go/no-go spike before Phase 3 | CX, C2 — 2/5 (others favoured outright native) |

---

## Resolved Open Decisions

Each decision records the recommendation adopted and which models drove it.

### OD-1: `spec_hash` location
**Decision:** Store in `workflow-state.json` under `requirements_lock.spec_hash`.
*Traceability CLI reads it; CI does not need to parse JSON directly.*
**Models:** C2 (recommended), G1 (agreed) — **80 % C2 / 20 % G1**

### OD-2: Default governance mode for `ai-sdd init`
**Decision:** `warn`.
*`off` is invisible; `enforce` blocks projects without a lock file on day one.*
**Models:** C2 (primary), CX (aligned), G1 (aligned) — **60 % C2 / 20 % CX / 20 % G1**

### OD-3: `PlanningReviewOverlay` phase scope
**Decision:** Restrict to tasks tagged `phase: planning` or `phase: design` via `phases: [planning, design]` config field. Global enable without phase filter → reviewer fatigue.
**Models:** C2 (primary recommendation) — **100 % C2**

### OD-4: Planning review response token format
**Decision:** Structured JSON: `{"planning_review": "APPROVED"}` or `{"planning_review": "NEEDS_WORK", "reason": "..."}`. Unambiguous; consistent with existing `handover_state` convention.
**Models:** C2 (primary), G1 (aligned) — **70 % C2 / 30 % G1**

### OD-5: `traceability gaps` exit code threshold
**Decision:** Non-zero exit only on *critical* gaps: (a) task with `requirement_ids` whose IDs have no match in lock file, (b) lock file requirement with no linked task. Warnings only (exit 0) for tasks missing AC declarations.
**Models:** C2 (defined "critical"), G2 (endorsed) — **60 % C2 / 40 % G2**

### OD-6: `requirements.lock.yaml` ownership chain
**Decision:** BA agent produces initial lock; Architect regenerates it on drift (via `regenerate-requirements-lock` task template); Human approves changes through HIL gate. Constitution must document this ownership.
**Models:** C2 (primary) — **100 % C2**

### OD-7: Cross-repo tools integration
**Decision:** Run feasibility spike (MCS-011) before Phase 3. Default recommendation: implement natively. The spike may approve selective import with a compatibility adapter; it must produce a documented go/no-go note before traceability CLI implementation begins.
**Models:** CX (spike approach), C2 (native default), G1 (gate with adapter) — **50 % CX / 30 % C2 / 20 % G1**

---

## Architecture Constraints (ai-sdd native)

All new features must use existing ai-sdd primitives:

- **New gates** → sub-checks inside `PolicyGateOverlay.postTask` (not new overlays unless pre-task)
- **New pre-task review** → new `PlanningReviewOverlay` slotted via `composition-rules.ts`
- **New CLI commands** → `src/cli/commands/` following existing commander.js pattern
- **New types** → `src/types/index.ts` (optional fields only)
- **New config** → `ai-sdd.yaml` schema with Zod validation; default in `src/config/defaults.ts`
- **MCP tools** → extend `src/integration/mcp-server/server.ts`; delegate to CLI commands

---

## Phased Implementation Plan

### Phase 1 — Zero-Code Foundations
**Effort: 1–2 days | Risk: None | Tickets: MCS-004, MCS-005**

All changes are documentation, prompt templates, and config file templates — no TypeScript compilation required, no breaking changes possible.

#### 1.1 Agent Constitution (CS-09)
**What:** Create `data/integration/claude-code/agents/constitution.md`. Add a preamble to each of the 6 agent MD files referencing it.

**Non-negotiable rules to include:**
1. Treat `requirements.lock.yaml` as source of truth when present.
2. Do not mark work complete unless all ACs are implemented and validated.
3. Surface blockers and deviations in `handover_state`.
4. No gold-plating (no unrequested features, logging, retries, caching, error handling).
5. Mandatory Planning Review before implementation; confidence score does not bypass it.
6. Every code change must trace to an AC in the task definition.
7. When `budget` fields are present: report `new_files_created`, `loc_delta`, `new_public_apis` in `handover_state`.
8. When `acceptance_criteria` are present: report `ac_coverage` as `Record<scenario, boolean>` in `handover_state`.
9. BA produces initial `requirements.lock.yaml`; Architect regenerates it on drift; Human approves via HIL.

*Rule 7–9 are critical — they close the silent-governance-failure gap identified by C2/G1.*

**Models driving this:** C2 (identified agent instruction gap — 60%), G1 (adopted — 40%)

#### 1.2 90% Confidence + GO Protocol (CS-02)
**What:** Update `data/integration/claude-code/agents/sdd-scaffold.md` and `ba.md` with confidence scoring step + explicit GO gate before any output is produced.

**Protocol text to embed (verbatim):**
```markdown
## Confidence Protocol (Mandatory)
1. Deconstruct the request: list every explicitly stated requirement.
2. Identify ambiguities: what is unclear, missing, or assumed?
3. Calculate confidence 0–100. If <90%: stop and ask clarifying questions only.
4. If ≥90%: present LOCKED REQUIREMENTS summary and ask user to respond "GO".
5. Write specifications ONLY after receiving "GO".

All specification outputs begin with:
  LOCKED REQUIREMENTS
  Confidence: [score]%
  Approved: [timestamp]
```

**Models driving this:** C2 (full spec — 70%), CX (aligned — 30%)

#### 1.3 Toolgate Template (CS-12)
**What:** Add `data/integration/toolgate.yaml`. `ai-sdd init` copies it to the project root.

**Models driving this:** C2 (content spec — 60%), CX (concept — 40%)

#### 1.4 Planning Artefacts Convention (CS-14)
**What:** Add to `CLAUDE.md`: planning artefacts live in `plans/<feature-name>/` (spec.md, plan.md, tasks/*.md).

**Models driving this:** C2, CX — equal weight — **50 % / 50 %**

---

### Phase 2 — Schema Extensions + Governance Flag
**Effort: 3–5 days | Risk: Low | Tickets: MCS-001, MCS-006, MCS-007, MCS-009**

All schema fields are optional. Zero breaking changes.

#### 2.1 Types in `src/types/index.ts`

Add the following (all new, no existing symbol modified):

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

// Typed handover contract for governance gates — prevents silent gate no-ops
export interface GatedHandoverState {
  ac_coverage?: Record<string, boolean>;  // keyed by AcceptanceCriterion.scenario
  new_files_created?: number;
  loc_delta?: number;
  new_public_apis?: number;
  tests_passed?: boolean;
  blockers?: string[];
}
```

Additive fields on existing `TaskDefinition` (all `optional`):
- `acceptance_criteria?: AcceptanceCriterion[]`
- `requirement_ids?: string[]`
- `scope_excluded?: string[]`
- `budget?: TaskBudget`
- `phase?: string`

**Models driving this:** C2 (full type spec — 60%), G1-G2-G3 (GatedHandoverState — 40%)

#### 2.2 `ai-sdd.yaml` governance config block

```yaml
governance:
  requirements_lock: warn  # off | warn | enforce
```

Default in `src/config/defaults.ts`: `governance.requirements_lock = "warn"`.

**Models driving this:** CX (flag concept — 40%), C2 (full spec — 40%), G1 (validation — 20%)

#### 2.3 Spec hash tracking in `src/core/engine.ts`

At `run()` startup, if `config.requirements_lock.path` exists:
1. SHA256 the file
2. Compare to `state.requirements_lock?.spec_hash`
3. Emit `requirements.lock.changed` event if different
4. Write current hash to state via `stateManager.patchState`

**Models driving this:** C2 (full spec — 80%), CX (concept — 20%)

#### 2.4 Gate 2 — Scope Drift in `PolicyGateOverlay.postTask`

After existing T0/T1/T2 evidence checks, add:
```typescript
const excluded = ctx.task_definition.scope_excluded ?? [];
if (excluded.length > 0 && result.handover_state?.raw_output) {
  const violations = excluded.filter(term =>
    (result.handover_state.raw_output as string)
      .toLowerCase().includes(term.toLowerCase())
  );
  if (violations.length > 0) {
    failures.push(`Gate 2 scope drift: excluded terms found: ${violations.join(", ")}`);
  }
}
```

*Scans `handover_state.raw_output` only — not file contents — to avoid false positives.*

**Models driving this:** C2 (full implementation — 70%), CX (concept from deepseek gate naming — 30%)

#### 2.5 Gate 2b — Budget Check in `PolicyGateOverlay.postTask`

```typescript
const budget = ctx.task_definition.budget;
const hs = result.handover_state as GatedHandoverState | undefined;
if (budget && hs) {
  checkBudgetField("new_files_created", budget.max_new_files, hs.new_files_created, failures);
  checkBudgetField("loc_delta", budget.max_loc_delta, hs.loc_delta, failures);
  checkBudgetField("new_public_apis", budget.max_new_public_apis, hs.new_public_apis, failures);
} else if (budget && !hs) {
  emitter.emit("governance.handover_state.untyped", { task_id: ctx.task_id });
}
```

*If `handover_state` does not conform to `GatedHandoverState`, emit warning event — do NOT silently pass.*

**Models driving this:** C2 (gate spec — 60%), G1 (identified silent-pass risk — 40%)

**Phase 2 exit criteria (all gates enforce P3 — no breakage):**
1. Existing workflows without `scope_excluded`, `budget`, or `acceptance_criteria` pass with no change in behaviour.
2. `governance.requirements_lock: warn` causes warning events, not errors, when lock file is absent.
3. `governance.requirements_lock: enforce` causes hard fail when lock file is absent.
4. Budget gate emits `governance.handover_state.untyped` when `handover_state` is missing.

---

### Phase 3 — Traceability CLI + Planning Review Overlay + MCP
**Effort: 5–8 days | Risk: Medium | Tickets: MCS-008, MCS-010, MCS-011, MCS-012, MCS-013**

**Internal sequencing is mandatory** (3a must complete before 3b; 3c must follow 3b; 3d parallelisable with 3b/3c; 3e after Phase 2 governance flag exists).

#### 3a — Feasibility Spike (MCS-011)
**What:** Evaluate `coding-standards/tools/validators` and `coding-standards/tools/query-engine` for reuse. Produce a go/no-go note covering: language/runtime, API stability, dependency footprint, compatibility adapter cost.
**Outcome:** Written note in `specs/merge-coding-standards/tools-spike-decision.md`. Default: implement natively.

**Models driving this:** CX (spike approach — 50%), C2 (native default — 30%), G1 (adapter gate — 20%)

#### 3b — `ai-sdd traceability` CLI (MCS-008)
**File:** `src/cli/commands/traceability.ts`
**Subcommands:**
- `validate-lock` — verify `requirements.lock.yaml` hash matches `workflow-state.json`
- `gaps` — report requirement↔task links; exit non-zero only on critical gaps (OD-5)
- `coverage` — report AC coverage per task from `handover_state`
- `report` — combined machine-readable JSON output

Uses native TypeScript (or wraps spike-approved tools behind an adapter, per 3a decision).

**Models driving this:** C2 (command design — 60%), G1/G2/G3 (native preference — 40%)

#### 3c — MCP Tool Registration (MCS-010) — after 3b
**File:** extend `src/integration/mcp-server/server.ts`
**Tools to add (two only):**
- `validate_requirements_lock` — delegates to `traceability validate-lock`
- `check_scope_drift` — delegates to `traceability gaps`

No stub registrations. Both tools must be backed by 3b before this ticket begins.

**Models driving this:** C2 (sequencing — 60%), G1 (early MCP value — 20%), CX (concept — 20%)

#### 3d — `PlanningReviewOverlay` (MCS-012) — parallelisable with 3b/3c
**File:** `src/overlays/planning-review/planning-review-overlay.ts`

**Config block in `ai-sdd.yaml`:**
```yaml
overlays:
  planning_review:
    enabled: false           # opt-in
    reviewer_agent: reviewer
    phases: [planning, design]
    block_on_needs_work: true
```

**Overlay chain update in `src/overlays/composition-rules.ts`:**
```
HIL → PlanningReview → Evidence Gate → Agentic Review → Paired → Confidence → Dispatch
```

**`preTask` behaviour:**
1. Skip if task `phase` not in `phases` config (or `phases` not set → skip all)
2. Build prompt: task definition + ACs + `scope_excluded` + `requirement_ids`
3. Dispatch to `reviewer_agent`
4. Parse for `{"planning_review": "APPROVED" | "NEEDS_WORK", "reason": "..."}` (structured JSON — OD-4)
5. Three cases:
   - `APPROVED` → proceed
   - `NEEDS_WORK` → `{ proceed: false }` → task → `NEEDS_REWORK`
   - Parse failure / timeout → emit `planning_review.parse_failure`; if `block_on_needs_work: true` treat as `NEEDS_WORK`; else warn and proceed

*Composition rules update is mandatory as part of this ticket — not optional documentation.*

**Models driving this:** C2 (full overlay spec — 55%), G1 (3-case parse handling — 25%), CX (concept — 20%)

#### 3e — AC Coverage Gate in `complete-task` (MCS-013) — after Phase 2
**File:** `src/cli/commands/complete-task.ts` — add Step 2.5 between sanitize and contract-validate:

```typescript
// Step 2.5: AC coverage check (when governance.requirements_lock != "off")
const declaredACs = loadDeclaredACs(projectPath, taskId);  // reads task definition
if (declaredACs && declaredACs.length > 0) {
  const hs = handoverState as GatedHandoverState;
  const coverage = hs?.ac_coverage ?? {};
  const uncovered = declaredACs.filter(ac => !coverage[ac.scenario]);
  if (uncovered.length > 0) {
    if (governanceMode === "enforce") {
      // transition to NEEDS_REWORK with list of uncovered scenarios
    } else {
      emitter.emit("governance.ac_coverage.incomplete", { uncovered });
    }
  }
}
```

**Models driving this:** C2 (step 2.5 spec — 70%), G1 (tristate respect — 30%)

**Phase 3 exit criteria:**
1. `ai-sdd traceability gaps` exits non-zero only on critical gaps; machine-readable JSON output on `--json`.
2. MCP tools functional (call CLI, return structured output) — not stubbed.
3. `PlanningReviewOverlay` blocks on `NEEDS_WORK` and on parse failure when `block_on_needs_work: true`.
4. `complete-task` transitions to `NEEDS_REWORK` for uncovered ACs when `governance: enforce`.

---

### Phase 4 — Tooling and CI/CD
**Effort: 3–5 days | Risk: Low | Tickets: MCS-002, MCS-003, MCS-014, MCS-015**

#### 4.1 Adapted Drift Scripts (CS-10)
**Files:** `data/integration/scripts/reproducibility-check.sh`, `data/integration/scripts/semantic-drift-check.sh`

Adaptations from `coding-standards`:
- Check `.ai-sdd/requirements.lock.yaml` (not bare `requirements.lock.yaml`)
- Gate 0: read `spec_hash` from `workflow-state.json` via `ai-sdd traceability validate-lock`
- Gate 2: read `scope_excluded` from first task in the workflow YAML
- Replace `./gradlew test` → `bun test`

**Models driving this:** C2 (adaptation spec — 60%), CX (inclusion — 40%)

#### 4.2 GitHub Actions Template
**File:** `data/integration/.github/workflows/ai-sdd-gates.yml`

**Must include an explicit init prerequisite guard** (CI template gap identified by C2):
```yaml
- name: Check ai-sdd init was run
  run: |
    test -f .ai-sdd/scripts/reproducibility-check.sh || \
      (echo "ERROR: Run 'ai-sdd init' first to install scripts." && exit 1)
```

**Models driving this:** C2 (gap + fix — 70%), G1/G2 (template concept — 30%)

#### 4.3 Phase-Based Model Routing (CS-08) (MCS-015)
**Files:** `src/adapters/factory.ts`, `ai-sdd.yaml` schema

Precedence: **task `adapter` override > `phase_routing[task.phase]` > `adapter` default**

```yaml
adapter:
  type: claude_code
  phase_routing:
    planning:
      type: openai
      model: gpt-4o
    planning_review:
      type: claude_code
      model: claude-opus-4-6
    implementation:
      type: claude_code
      model: claude-sonnet-4-6
    review:
      type: openai
      model: gpt-4o
```

Phase routing is entirely optional — existing adapter config continues to work unchanged.

**Models driving this:** C2 (precedence spec — 55%), CX (concept — 30%), G1 (concept — 15%)

#### 4.4 `regenerate-requirements-lock` Task Template
**File:** `data/task-library/regenerate-requirements-lock.yaml`

Assigned to `agent: architect`, `phase: planning`, includes AC scenarios for lock completeness, hash update, and diff classification (breaking/significant/minor).

**Models driving this:** C2 (full template — 80%), CX (concept — 20%)

#### 4.5 Governance Onboarding Docs (MCS-014)
**What:** Update `data/integration/claude-code/agents/constitution.md` with usage guide for governance features. Document what each governance mode does, how to declare ACs and budgets, and how to read traceability reports.

**Models driving this:** G1 (documentation task recommendation — 60%), C2 (scope — 40%)

**Phase 4 exit criteria:**
1. `ai-sdd init` copies scripts, CI template, toolgate.yaml, and requirements lock example non-destructively.
2. CI template fails with human-readable error if init was not run.
3. Phase routing precedence verified in dry-run tests.
4. Budget and drift scripts fail deterministically on violations.

---

## Ticket Mapping

| Ticket | Phase | Description |
|--------|-------|-------------|
| MCS-004 | 1 | Agent constitution + handover reporting instructions |
| MCS-005 | 1 | GO protocol in scaffold/BA agents + toolgate.yaml template |
| MCS-001 | 2 | GovernanceMode tristate type + governance config in ai-sdd.yaml |
| MCS-006 | 2 | AcceptanceCriterion, TaskBudget, GatedHandoverState types |
| MCS-007 | 2 | Optional fields on TaskDefinition + Zod schema update |
| MCS-009 | 2 | Spec hash tracking in engine.ts + Gate 2 + Gate 2b in PolicyGateOverlay |
| MCS-011 | 3a | Feasibility spike: coding-standards/tools/* decision |
| MCS-008 | 3b | ai-sdd traceability CLI (validate-lock, gaps, coverage, report) |
| MCS-010 | 3c | MCP tool registration (validate_requirements_lock, check_scope_drift) |
| MCS-012 | 3d | PlanningReviewOverlay + composition-rules.ts update |
| MCS-013 | 3e | AC coverage gate in complete-task Step 2.5 |
| MCS-002 | 4 | Drift scripts (reproducibility-check.sh, semantic-drift-check.sh) |
| MCS-003 | 4 | GitHub Actions template with init prerequisite guard |
| MCS-015 | 4 | Phase-based model routing in factory.ts |
| MCS-014 | 4 | Governance onboarding docs |

New tickets needed (not in existing MCS set):
- `MCS-011` — spike note only (already added above)

---

## Feature-to-File Map

| Feature | Source (coding-standards) | Target (ai-sdd) |
|---------|--------------------------|-----------------|
| Agent constitution | `agents/constitution.md` | `data/integration/claude-code/agents/constitution.md` (new) |
| GO protocol | `CLAUDE.md §Confidence Protocol` | `data/integration/claude-code/agents/sdd-scaffold.md` + `ba.md` |
| Toolgate template | `toolgate.yaml` | `data/integration/toolgate.yaml` (new, copied by init) |
| Requirements lock example | `rules/example.requirements.lock.yaml` | `data/integration/requirements.lock.example.yaml` (new) |
| GovernanceMode type | — | `src/types/index.ts` |
| AcceptanceCriterion type | `rules/acceptance-criteria-format.md` | `src/types/index.ts` |
| GatedHandoverState type | — | `src/types/index.ts` |
| TaskBudget type | `toolgate.yaml budgets` | `src/types/index.ts` |
| Governance config | — | `ai-sdd.yaml` schema + `src/config/defaults.ts` |
| Spec hash tracking | `scripts/spec-hash.sh` | `src/core/engine.ts run()` startup |
| Gate 2 scope drift | `scripts/semantic-drift-check.sh Gate 2` | `src/overlays/policy-gate/gate-overlay.ts` |
| Gate 2b budget | `toolgate.yaml budgets` | `src/overlays/policy-gate/gate-overlay.ts` |
| Traceability CLI | `tools/query-engine` (reference only) | `src/cli/commands/traceability.ts` (new, native) |
| MCP tools | — | `src/integration/mcp-server/server.ts` (extended) |
| PlanningReviewOverlay | `agents/planning-reviewer.md` | `src/overlays/planning-review/planning-review-overlay.ts` (new) |
| Overlay chain update | — | `src/overlays/composition-rules.ts` |
| Phase-based routing | `agents/model-routing.yaml` | `src/adapters/factory.ts` + `ai-sdd.yaml` |
| AC coverage gate | `rules/pull-request-checklist.md` | `src/cli/commands/complete-task.ts` Step 2.5 |
| Drift scripts | `scripts/reproducibility-check.sh`, `semantic-drift-check.sh` | `data/integration/scripts/` (adapted, new) |
| CI template | `.github/workflows/framework-gates-sample.yml` | `data/integration/.github/workflows/ai-sdd-gates.yml` (new) |
| Lock regen task | `agents/requirements-lock/` | `data/task-library/regenerate-requirements-lock.yaml` (new) |

---

## What Is Explicitly NOT Implemented

Closed decisions — require a new proposal to reopen:

| Feature | Reason |
|---------|--------|
| `REQUIREMENTS_VALIDATED` task state | Hard reject — breaks VALID_TRANSITIONS. Models: 5/5. |
| `coding-standards/tools/*` cross-repo runtime dependency | Gate behind MCS-011 spike; default is native. Models: 4/5. |
| Phase 0 MCP registration before traceability CLI | Ordering error — MCP without backing implementation. Models: C2, G1, G2, G3 — 4/5. |
| `greenfield\|brownfield` flag | Undefined concept; not in any consistent model spec. Models: C2 — 1/5 (others silent). |
| ML/drift prediction (deepseek Phase 5) | Defer indefinitely; needs governance baseline first. Models: C2 — consensus. |
| Multi-candidate evaluation engine | Changes agent execution model; out of scope. |
| Full MCP server unification | Separate project; existing MCP server is functional. |
| `workflow/state-machine.yaml` from coding-standards | Superseded by TypeScript VALID_TRANSITIONS. |
| `scripts/dryrun.sh`, `run-phase.sh` | Superseded by `--dry-run` and `--task` flags. |
| Java/Kotlin standards | Not applicable — ai-sdd is TypeScript. |

---

## Success Metrics

### Technical (from C2 — 60%, CX — 20%, G1 — 20%)
1. PR gate outcomes are deterministic for the same input (0 flaky gate runs).
2. >80% of scope-drift class issues caught by Gate 2 before merge (baseline: first 4 sprints post Phase 2 deploy).
3. Critical traceability gap count trends downward release-over-release.
4. Mean time to diagnose failed workflow run is measurable via schema-validated state artefacts.

### Adoption (from C2 — 70%, CX — 30%)
1. % projects using `requirements.lock.yaml` with `governance.requirements_lock: enforce`.
2. % workflows with at least one task with `acceptance_criteria` declared.
3. Releases passing `ai-sdd traceability report` with zero critical gaps.

### Rework Impact (from CX — 100% on this metric)
4. `NEEDS_REWORK` rate for `PlanningReviewOverlay`-enabled workflows vs pre-adoption baseline. Target: **≥15% reduction within 60 days of Phase 3**. If not met: revise reviewer agent prompt before wider rollout.

---

## Risks and Controls

| Risk | Control | Source |
|------|---------|--------|
| Silent governance failures from untyped handover payloads | GatedHandoverState interface + `governance.handover_state.untyped` warning event | C2 (identified), G1 (adopted) |
| MCP tools non-functional at registration | Hard sequencing: 3c must follow 3b | C2, G1, G2, G3 |
| Cross-repo dependency lock-in | MCS-011 spike with explicit go/no-go note | CX, C2 |
| Reviewer fatigue from unconstrained PlanningReviewOverlay | `phases: [planning, design]` filter; disabled by default | C2 |
| CI template silently fails on uninitialised projects | Explicit init prerequisite guard step in YAML | C2 (identified gap) |
| Operator friction from over-enforcement | Default `warn`; `enforce` is explicit opt-in | C2, CX, G1 |
| Budget gate self-reporting allows agent cheating | Phase 4 `check-budgets.sh` provides out-of-process verification | C2 |
