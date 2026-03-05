# Synthesis Review: merged-claude.md vs merged-codex.md

**Date:** 2026-03-05
**Reviewer:** Claude Sonnet 4.6
**Inputs:**
- `specs/merge-coding-standards/merged-claude.md` (foundation: claude.md, dated 2026-03-04)
- `specs/merge-coding-standards/merged-codex.md` (foundation: codex.md, dated 2026-03-03)
- `specs/merge-coding-standards/review_of_merged_claude-gemini.md` (prior review, dated 2026-03-04)

---

## 1. Document Overview

### merged-claude.md

This document was authored by Claude Sonnet 4.6 as a three-way review and merge of the original `claude.md`, `codex.md`, and `deepseek.md` proposals. It chose `claude.md` as its foundation on the explicit grounds of codebase fidelity: every integration point names a specific file and TypeScript symbol in the existing ai-sdd repo. The document is structured as a decision record — it explains what was chosen, what was adopted from others, what was rejected and why, and then presents a phased implementation plan with inline TypeScript code snippets and concrete exit criteria per phase. Its perspective is that of a developer who already knows the codebase deeply and wants to make safe, additive changes to it.

### merged-codex.md

This document was authored by a different agent (likely the same model running with a different persona or instruction set) and chose `codex.md` as its foundation on the grounds that it is the most incrementally structured and least speculative. It is written as a lean project plan with phase goals, scope bullets, and exit criteria, but without inline code. It is more architectural in character: it identifies what to do and in what order, but defers implementation detail to the reader. Its perspective is that of a project planner who wants sequencing to be correct and risk to be low.

---

## 2. Pros and Cons — Per Document

### merged-claude.md

**Strengths**

1. **Codebase specificity.** Every proposed change names an actual file in the ai-sdd repo. The TypeScript snippets for Gate 2, Gate 2b, spec-hash tracking, and AC coverage in `complete-task` are ready to drop into files. This is the difference between a plan and an implementation spec.

2. **Disciplined rejection table.** Section 5 ("What NOT to Merge") explicitly tables coding-standards features that ai-sdd already handles and explains why importing them would create redundancy or break invariants. This is the highest-value section in either document. Without it, an implementer could waste days on things already done.

3. **Architectural invariant awareness.** The hard rejection of `REQUIREMENTS_VALIDATED` as a new task state is correct and clearly argued: it would break `VALID_TRANSITIONS` and all downstream tests. No equivalent discipline appears in `merged-codex.md`.

4. **Backward compatibility discipline.** Every new field is `optional`. New overlays default to `enabled: false`. New CLI commands are additive. This is stated as a principle, not just practiced implicitly.

5. **Exit criteria are testable.** "Workflow with `scope_excluded` fails policy gate when output contains excluded term" is a real test case. "PR gate workflow runs and fails predictably on drift violations" is not.

6. **Feature-to-file map (Section 8).** A direct mapping from feature to target file. This is production-quality planning documentation.

**Weaknesses**

1. **Phase 3 is too dense.** The traceability CLI, Planning Review overlay, MCP tools, and AC coverage gate are bundled in one phase with a 5–8 day estimate. These are four distinct deliverables with different risk profiles. There is no internal sequencing and no dependency graph within the phase.

2. **`handover_state` contract is loose.** The Gate 2b budget check casts `handover_state` to `Record<string, unknown>`. There is no mechanism ensuring agents actually populate `new_files_created`, `loc_delta`, or `new_public_apis`. If an agent does not supply these fields, the gate silently passes. This is a silent stub violation per the project's own development standards.

3. **Planning Review overlay chain update is underspecified.** Section 3.3 adds `Planning Review` to the overlay chain: `HIL → Planning Review → Evidence Gate → ...`. But `src/overlays/composition-rules.ts` enforces the chain order as an invariant. The document does not address whether this file needs to be updated or how the new slot is validated.

4. **Out-of-scope framing of external modules.** Section 2 rejects `tools/validators` and `tools/query-engine` as not present in `ai-sdd-claude`. This is correct as a statement about the `ai-sdd-claude` codebase — these modules do not exist inside it. However, both directories exist in the separate `coding-standards` repository (`tools/query-engine/` and `tools/validators/`, each with `src/`, `tests/`, and `package.json`). `merged-codex.md` proposes a cross-repo integration dependency. `merged-claude.md` excludes them as out-of-scope for this proposal. Neither position is definitively right — this is an integration architecture decision: should `ai-sdd-claude` take a runtime dependency on `coding-standards/tools/`? Labelling them "hallucinated" is imprecise; the real question is deferred as an open integration decision rather than resolved by a false factual claim.

5. **MCP tool delegation is underspecified.** `validate_requirements_lock` is described as "delegates to `ai-sdd traceability validate-lock`." This is either an in-process call or a subprocess exec. The document does not say which, and that decision has security and reliability implications.

---

### merged-codex.md

**Strengths**

1. **Cleaner phase sequencing.** Six phases (0, A, B, C, D, E) are in a logical dependency order: MCP foundation → CI gates → requirements lock → traceability → overlay → production ops. Each phase has a single, clear goal. This is easier to track as a project backlog than `merged-claude.md`'s four phases where Phase 3 is overloaded.

2. **Phase 0 MCP enablement is a good idea.** Registering traceability/validation actions as MCP tools before the traceability CLI is even complete enables early IDE integration. This sequencing de-risks the MCP wiring step by doing it before the CLI logic gets complex.

3. **Explicit non-goals section.** Section 5 lists what is excluded for the first wave, which is necessary for scope control. It is less detailed than `merged-claude.md`'s rejection table but still present.

4. **Simpler and faster to read.** For a senior architect reviewing the plan, the reduced verbosity of `merged-codex.md` makes it quicker to evaluate sequencing and risk. The absence of inline code means the plan can be read without being distracted by implementation choices.

5. **Success criteria are complete.** Section 7 has both technical and adoption metrics, matching `merged-claude.md`'s Section 7. Neither is better than the other here.

6. **Phase C proposes cross-repo integration of `coding-standards` modules.** Phase C includes "Integrate `tools/validators` and `tools/query-engine`." Both directories exist in the `coding-standards` repository but are not part of `ai-sdd-claude`. `merged-codex.md` is proposing a cross-repo integration dependency. Whether this is desirable is an open integration architecture decision — not a straightforward inclusion that `merged-claude.md` erred in rejecting.

**Weaknesses**

1. **No code specificity.** The traceability CLI is described as "Add CLI command `ai-sdd traceability`" with three sub-commands. There is no indication of which files to touch, what types to add, or how the command fits into the existing `src/cli/` structure. A developer receiving this plan starts from scratch on design decisions that `merged-claude.md` has already resolved.

2. **Architectural invariant blindness.** `merged-codex.md` does not mention `VALID_TRANSITIONS`, the overlay chain lock in `composition-rules.ts`, or the `complete-task` atomic boundary. It does not reject `REQUIREMENTS_VALIDATED` state explicitly. This means it would pass through without catching the same risks.

3. **Phase D overlay chain update is also vague.** "Chain order update: HIL -> Planning Review -> Policy Gate -> Review/Paired/Confidence" appears but with no mention of how `composition-rules.ts` gets updated or whether this breaks the locked chain order invariant.

4. **No feature-to-file map.** There is no equivalent of `merged-claude.md`'s Section 8. A developer has to infer target files from the description.

5. **Immediate backlog (Section 6) contains a contradiction.** Ticket 1 says "Add governance config block" and Ticket 10 says "Expose traceability actions via MCP tools" — but Phase 0 says MCP enablement should come first. The backlog is inconsistent with the phase plan.

---

## 3. Meaningful Differences

### 3.1 Foundation choice and approach to specificity

- **merged-claude.md:** Uses `claude.md` as foundation, justifying it on codebase fidelity, and produces implementation-level detail (file paths, code snippets, types).
- **merged-codex.md:** Uses `codex.md` as foundation, justifying it on incremental sequencing, and produces architectural-level detail (phase goals, scope bullets).
- **Verdict:** `merged-claude.md` is better for implementation. `merged-codex.md`'s phase structure is better for project management. The synthesis should take `merged-claude.md`'s implementation detail and `merged-codex.md`'s phase ordering — specifically, promoting MCP enablement earlier (Phase 0) and splitting the dense Phase 3 into finer-grained phases.

### 3.2 MCP tool timing

- **merged-claude.md:** MCP tools (Section 3.2) come after the traceability CLI is built, in Phase 3.
- **merged-codex.md:** Phase 0 registers MCP tools before the traceability CLI is implemented.
- **Verdict:** `merged-codex.md`'s sequencing is better here. Registering placeholder MCP tools early enables IDE integration to be tested and iterated on while the backing implementation is developed. It is a lower-risk step that provides early value. The synthesis should adopt Phase 0 MCP stub registration.

### 3.3 Phase density vs. phase count

- **merged-claude.md:** Four phases, with Phase 3 containing four major deliverables (CLI, MCP tools, Planning Review overlay, AC gate).
- **merged-codex.md:** Six phases, each with a single clear goal.
- **Verdict:** `merged-codex.md`'s phase granularity is better. Phase 3 of `merged-claude.md` is a multi-week chunk that would be difficult to track, review, and ship incrementally. The synthesis should adopt `merged-codex.md`'s phase count while filling each phase with `merged-claude.md`'s implementation detail.

### 3.4 Treatment of `tools/validators` and `tools/query-engine`

- **merged-claude.md:** Excludes these as not present in `ai-sdd-claude`, and implements the traceability CLI natively in `src/cli/commands/traceability.ts` without them. The framing as "hallucinated" is imprecise — the modules exist, but in a different repo.
- **merged-codex.md:** Retains them in Phase C scope for integration, implicitly proposing a cross-repo dependency on `coding-standards`.
- **Verdict:** Open integration decision — see Open Decisions section. `tools/validators` and `tools/query-engine` exist in the separate `coding-standards` repo but are not part of `ai-sdd-claude`. `merged-codex.md` proposes a cross-repo integration dependency. `merged-claude.md` excludes them as out-of-scope for this proposal. Neither is definitively right — the question is whether `ai-sdd-claude` should take a runtime dependency on `coding-standards/tools/`. The synthesis defers this as an explicit open decision rather than auto-accepting or auto-rejecting.

### 3.5 Rejection of `REQUIREMENTS_VALIDATED` state

- **merged-claude.md:** Hard-rejects this as a breaking change to `VALID_TRANSITIONS`.
- **merged-codex.md:** Does not address this at all.
- **Verdict:** `merged-claude.md`'s explicit rejection is necessary. The synthesis must preserve this rejection.

### 3.6 Feature-to-file mapping

- **merged-claude.md:** Has a complete feature-to-file map (Section 8) with 18 entries.
- **merged-codex.md:** Has no equivalent.
- **Verdict:** `merged-claude.md`'s map is essential for implementation handoff. The synthesis must include it.

### 3.7 Composition rules chain update

- Both documents update the overlay chain order but neither addresses the implication for `src/overlays/composition-rules.ts`, which is described in the CLAUDE.md as enforcing the overlay chain order. Both documents are equally incomplete on this point.

---

## 4. Points of Agreement (Settled Ground)

The following topics are agreed by both documents and can be adopted in the synthesis without debate:

1. **Governance tristate flag.** Both adopt `governance.requirements_lock: off|warn|enforce` from `codex.md`. This is the correct approach over a boolean.

2. **No state machine replacement.** Neither document replaces `VALID_TRANSITIONS` or `src/types/index.ts` state machine with a YAML equivalent.

3. **No engine refactoring.** Both documents are additive. No changes to the engine orchestration model.

4. **Traceability CLI command.** Both adopt `ai-sdd traceability` with sub-commands `validate-lock`, `gaps`, `coverage`, and `report`. Implementation location is `src/cli/commands/traceability.ts`.

5. **Planning Review overlay.** Both adopt the `PlanningReviewOverlay` as opt-in, defaulting to `enabled: false`.

6. **Task schema extensions.** Both adopt `acceptance_criteria`, `requirement_ids`, `scope_excluded`, and `budget` as optional fields on `TaskDefinition`.

7. **Agent constitution + GO protocol.** Both adopt zero-code wins from `claude.md`: constitution baseline, 90% confidence threshold, GO confirmation before specification writing.

8. **Phase routing.** Both adopt `adapter.phase_routing` mapping `planning`, `review`, `implementation` to different adapter/model configs. Precedence: task override > phase routing > adapter default.

9. **Lock regeneration task library entry.** Both adopt a `regenerate-requirements-lock.yaml` task template with evidence-only constraint.

10. **Success metrics.** Both adopt both technical metrics (gate determinism, gap trend, rework rate) and adoption metrics (% projects at enforce, % workflows with ACs, releases passing readiness check).

11. **No multi-candidate evaluation engine, no ML/predictive features** in this merge cycle. Both defer these.

---

## 5. Proposed Synthesis

The synthesis below resolves all differences, retains the best guidance from each document, and is structured as a usable standard. It uses `merged-claude.md`'s implementation depth as its spine and adopts `merged-codex.md`'s phase structure.

---

### Synthesis: coding-standards → ai-sdd Merge Standard

**Status:** Proposed
**Supersedes:** merged-claude.md, merged-codex.md

---

#### S1. Foundational Decisions

**Rule S1.1:** All changes are additive. New fields on `TaskDefinition` are `optional`. New overlays default to `enabled: false`. New CLI commands do not modify existing commands. No changes to `VALID_TRANSITIONS` or the overlay chain contract in `src/overlays/composition-rules.ts`.

**Rule S1.2:** `REQUIREMENTS_VALIDATED` as a task state is a hard reject. It breaks `VALID_TRANSITIONS` in `src/types/index.ts`. Requirements validation is implemented as a preflight check in `engine.ts run()` and as a gate in `PolicyGateOverlay.postTask`, not as a state transition.

**Rule S1.3:** `tools/validators` and `tools/query-engine` exist in the separate `coding-standards` repo but are not part of `ai-sdd-claude`. `merged-codex.md` proposes a cross-repo integration dependency; `merged-claude.md` excludes them as out-of-scope. This is an open integration architecture decision: should `ai-sdd-claude` take a runtime dependency on `coding-standards/tools/`? The recommended default is to keep `ai-sdd-claude` self-contained and implement equivalent functionality natively, unless the `coding-standards` tools have a stable versioned API and the teams are aligned. Before Phase C, this decision must be made explicitly with a stated justification and documented — do not leave it implicit.

**Rule S1.4:** The existing MCP server architecture (`src/integration/mcp-server/server.ts`) is extended, not replaced. No alternative MCP server is created.

---

#### S2. What Is NOT Merged

The following coding-standards features are explicitly excluded because ai-sdd already has superior equivalents:

| coding-standards feature | ai-sdd equivalent | Decision |
|---|---|---|
| `workflow/state-machine.yaml` | `VALID_TRANSITIONS` in `src/types/index.ts` (TypeScript-enforced) | Skip — YAML advisory is weaker than compiled enforcement |
| `workflow/context.schema.json` | `src/core/context-manager.ts` typed assembly | Skip — already covered |
| `workflow/events-contract.md` | `src/observability/emitter.ts` typed events | Skip — already covered |
| `scripts/check-iteration-limits.sh` | `max_rework_iterations` in engine state machine | Skip — engine enforces this |
| `tools/validators` / `tools/query-engine` — cross-repo dependency | Open integration decision (see Open Decisions) | Evaluate — both modules exist in `coding-standards` repo (not in `ai-sdd-claude`); whether `ai-sdd-claude` should depend on them is deferred as an explicit open decision, not auto-accepted or auto-rejected |
| Language-specific standards (java/, kotlin/) | N/A | Skip — ai-sdd is TypeScript |
| `REQUIREMENTS_VALIDATED` task state | Governance flag + preTask check (see S1.2) | Hard reject — breaks VALID_TRANSITIONS |
| Multi-candidate eval engine | Out of scope | Defer — changes execution model |
| Phase 5 ML / drift prediction | Speculative | Defer — needs baseline first |
| Full MCP server unification | Existing MCP server is sufficient | Scope reduction — extend, don't replace |

---

#### S3. Schema and Type Extensions

All additions are in `src/types/index.ts`.

**Rule S3.1 — Governance config:**
```typescript
export type GovernanceMode = "off" | "warn" | "enforce";

export interface GovernanceConfig {
  requirements_lock?: GovernanceMode;
}
```

**Rule S3.2 — Acceptance criteria (Gherkin structure):**
```typescript
export interface AcceptanceCriterion {
  scenario: string;
  given: string | string[];
  when: string;
  then: string[];
  and?: string[];
}
```

**Rule S3.3 — Task budget:**
```typescript
export interface TaskBudget {
  max_new_files?: number;
  max_loc_delta?: number;
  max_new_public_apis?: number;
}
```

**Rule S3.4 — Additions to `TaskDefinition` (all optional):**
```typescript
acceptance_criteria?: AcceptanceCriterion[];
requirement_ids?: string[];
scope_excluded?: string[];
budget?: TaskBudget;
phase?: string;
```

**Rule S3.5 — Addition to `WorkflowState`:**
```typescript
requirements_lock?: { spec_hash: string; path: string; locked_at: string };
```

**Rule S3.6 — Gated handover state (formalizes the agent contract for gates):**
```typescript
export interface GatedHandoverState {
  ac_coverage?: Record<string, boolean>;
  new_files_created?: number;
  loc_delta?: number;
  new_public_apis?: number;
  tests_passed?: boolean;
  blockers?: string[];
  raw_output?: string;
}
```

The `PolicyGateOverlay` and `complete-task` step 2.5 use `GatedHandoverState` not `Record<string, unknown>`. Agents that do not populate these fields are safe: the gate skips the check rather than silently passing on fabricated data. The gate logs a warning when a budget or AC field is declared but the agent did not report it.

---

#### S4. Configuration Extensions (`ai-sdd.yaml`)

```yaml
governance:
  requirements_lock: warn        # off | warn | enforce
  # Default governance mode at init is "standard" (T1 policy gate, HIL enabled).
  # Users escalate to "strict" for regulated/safety-critical workflows. (Decision 2)

lock_mode: greenfield            # greenfield | brownfield — default is greenfield. (Decision 1)
                                 # Brownfield projects set lock_mode: brownfield to allow
                                 # partial requirement coverage without enforcement failures.

requirements_lock:
  path: .ai-sdd/requirements.lock.yaml
  enforce: false                  # deprecated; use governance.requirements_lock

adapter:
  type: claude_code
  phase_routing:
    planning:        { type: openai,      model: gpt-4o,            temperature: 0.2 }
    review:          { type: claude_code, model: claude-opus-4-6,   temperature: 0.0 }
    implementation:  { type: claude_code, model: claude-sonnet-4-6, temperature: 0.1 }
  # Auth warnings are only emitted for adapters referenced in the active workflow's
  # agent definitions. Unused adapters are silent. (Decision 6)

overlays:
  planning_review:
    enabled: false
    reviewer_agent: "reviewer"
    block_on_needs_work: true
    timeout_hours: 24             # fail-closed after this duration; set to 0 for T2 (no timeout). (Decision 4)
```

Phase routing precedence: task-level `adapter` override > `phase_routing[task.phase]` > top-level `adapter` default.

---

#### S5. Implementation Phases

Phase ordering follows `merged-codex.md`'s six-phase structure. Implementation detail follows `merged-claude.md`.

---

##### Phase 0: MCP Stub Registration
**Effort:** 0.5 days | **Risk:** None

Register two MCP tools as stubs in `src/integration/mcp-server/server.ts` before the traceability CLI is implemented. This enables IDE integration and end-to-end wiring tests to begin independently.

```typescript
{ name: "validate_requirements_lock", description: "Validate requirements.lock.yaml integrity and task linkage" }
{ name: "check_scope_drift",          description: "Check last completed task output for scope drift violations" }
```

Both tools return `{ status: "not_implemented" }` until Phase C wires them to the traceability CLI.

**Exit criteria:**
1. Both tools appear in `ai-sdd serve --mcp` tool listing.
2. No regression in existing MCP tools.

---

##### Phase A: Zero-Code Wins + CI Gate Foundation
**Effort:** 2–3 days | **Risk:** None

**A.1 Agent constitution** — `data/integration/claude-code/agents/constitution.md` (new file):
```markdown
## Agent Constitution (Mandatory — Non-Negotiable Baseline)

1. Treat `requirements.lock.yaml` as the source of truth when present.
2. Do not mark work complete unless ALL acceptance criteria are explicitly addressed.
3. Do not add features, logging, retries, caching, or error handling not in the task
   definition. This is gold-plating. It is forbidden.
4. Surface blockers and ambiguities in `handover_state.blockers`.
5. Every code change must trace to an acceptance criterion or requirement ID in the task
   definition.
6. A Planning Review runs before implementation. Your confidence score does not bypass it.
7. When the task declares `acceptance_criteria`, populate `handover_state.ac_coverage` with
   `{ claimed: N, total: M, uncovered: ["AC-ID", ...] }`. This is a first-class evidence field,
   not a narrative comment. The reviewer agent will verify this claim. (Decision 5)
```

All 6 agent MD files in `data/integration/claude-code/agents/` must reference `constitution.md`.

**A.2 GO Protocol** added to `sdd-scaffold.md` and `sdd-ba.md`:
```markdown
## Confidence Protocol (Mandatory Before Output)

1. List every explicitly stated requirement.
2. Identify ambiguities. Ask clarifying questions if confidence < 90%.
3. At confidence >= 90%: present LOCKED REQUIREMENTS summary. Ask user to respond "GO".
4. Write specifications ONLY after receiving "GO".

Output header for all specification files:
  LOCKED REQUIREMENTS | Confidence: [N]% | Approved: [timestamp]
```

**A.3 Toolgate template** — `data/integration/toolgate.yaml` (new, copied by `ai-sdd init`).

**A.4 Plans convention** — add `plans/<feature>/` directory convention to `CLAUDE.md`.

**A.5 CI gate template** — `data/integration/.github/workflows/ai-sdd-gates.yml`:
```yaml
name: ai-sdd Gates
on:
  pull_request: { branches: [main, master] }
jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run typecheck
      - run: bun test
      - run: .ai-sdd/scripts/reproducibility-check.sh
      - run: BASE_REF=origin/main .ai-sdd/scripts/semantic-drift-check.sh
      - run: bun run src/cli/index.ts traceability report --json > gap-report.json
      - uses: actions/upload-artifact@v4
        with: { name: gap-report, path: gap-report.json }
```

**A.6 Drift scripts** — `data/integration/scripts/reproducibility-check.sh` and `semantic-drift-check.sh` adapted from coding-standards (replace gradle with `bun run typecheck`, replace standalone spec-hash file with `workflow-state.json` spec_hash field).

**Exit criteria:**
1. All 6 agent MD files reference `constitution.md`.
2. `sdd-scaffold.md` has the confidence + GO protocol section.
3. `toolgate.yaml` is in `data/integration/` and copied by `ai-sdd init`.
4. CI gate template runs on a test PR and fails predictably when reproducibility-check.sh fails.

---

##### Phase B: Schema Extensions + Governance Flag
**Effort:** 3–5 days | **Risk:** Low

**B.1** Add `GovernanceMode`, `GovernanceConfig`, `AcceptanceCriterion`, `TaskBudget`, and `GatedHandoverState` to `src/types/index.ts` per Section S3.

**B.2** Governance tristate in `src/core/engine.ts run()` startup:
```typescript
if (config.requirements_lock?.path) {
  const lockFile = resolve(projectPath, config.requirements_lock.path);
  if (existsSync(lockFile)) {
    const hash = createHash("sha256").update(readFileSync(lockFile)).digest("hex");
    const prev = state.requirements_lock?.spec_hash;
    if (!prev) {
      // First run: no baseline exists. Store hash and warn — do not block. (Decision 3)
      emitter.emit("requirements.lock.baseline_set", { hash, path: lockFile });
    } else if (prev !== hash) {
      // Subsequent run: hash changed without acknowledgement — block. (Decision 3)
      if (!flags.acknowledgeSpecChange) {
        throw new ConfigError(
          "requirements.lock.yaml has changed since last run. " +
          "Re-run with --acknowledge-spec-change=<reason> to proceed. " +
          "The reason will be recorded in the audit log."
        );
      }
      emitter.emit("requirements.lock.changed", { previous_hash: prev, current_hash: hash, reason: flags.acknowledgeSpecChange });
    }
    await stateManager.patch({ requirements_lock: { spec_hash: hash, path: lockFile, locked_at: new Date().toISOString() } });
  } else if (governanceMode === "enforce") {
    throw new ConfigError("requirements.lock.yaml not found; governance mode is enforce");
  } else if (governanceMode === "warn") {
    emitter.emit("requirements.lock.missing", { path: lockFile });
  }
}
```

**B.3** PolicyGateOverlay sub-gates added to `src/overlays/policy-gate/gate-overlay.ts`:

- Gate 0: spec hash match
- Gate 2: scope_excluded term scan
- Gate 2b: budget check using `GatedHandoverState` (not raw cast)

When a budget field (`new_files_created`, etc.) is declared in the task but absent from `GatedHandoverState`, emit a warning event and continue — do not silently pass or silently fail.

**B.4** Add `governance.requirements_lock` to `ai-sdd.yaml` schema validation in `validate-config`.

**Exit criteria:**
1. `bun run typecheck` passes with new types.
2. Workflow with `scope_excluded` fails policy gate when output contains excluded term.
3. `governance.requirements_lock: enforce` causes `run` preflight hard fail when lock missing.
4. Spec hash stored in `workflow-state.json` and `requirements.lock.changed` event emitted on change.
5. Budget gate logs a warning when field is declared but agent did not report it.

---

##### Phase C: Traceability CLI + MCP Wiring + AC Gate
**Effort:** 5–7 days | **Risk:** Medium

Explicitly sequenced within the phase:

**C.0 Integration decision: `coding-standards/tools/` dependency** — before writing any traceability CLI code, resolve the open integration decision (see Open Decisions section) regarding `coding-standards/tools/validators` and `coding-standards/tools/query-engine`. These modules exist in the separate `coding-standards` repo. `merged-codex.md` proposes using them; `merged-claude.md` implements the traceability CLI natively instead. Produce a short go/no-go import note covering: cross-repo dependency model, compatibility, dependency footprint, API stability, and team alignment. The recommended default is to keep `ai-sdd-claude` self-contained and implement natively unless the spike concludes that the cross-repo dependency is justified. The decision must be explicit and documented before C.1 begins.

**C.1 Traceability CLI** — `src/cli/commands/traceability.ts` (new), registered in `src/cli/index.ts`:
```typescript
// ai-sdd traceability validate-lock
// ai-sdd traceability gaps
// ai-sdd traceability coverage --req REQ-001
// ai-sdd traceability report --json
```
Reads `requirements.lock.yaml` and `workflow-state.json`. Computes: requirements declared but not linked to any task; tasks with ACs but no coverage in last run; `tests_passed` distribution. Integration with `coding-standards` tools is contingent on the outcome of the C.0 integration decision spike — native implementation is the default unless the cross-repo dependency is explicitly approved.

**C.2 MCP wiring** — once C.1 is complete, update Phase 0 stubs in `src/integration/mcp-server/server.ts` to delegate to `traceability validate-lock` and `traceability gaps` respectively. The delegation is an in-process call (not subprocess exec) using the same implementation the CLI calls.

**C.3 Planning Review overlay** — `src/overlays/planning-review/planning-review-overlay.ts` (new, opt-in):

`preTask` behaviour: build review prompt (task definition + ACs + `scope_excluded` + `requirement_ids` + agent description) → dispatch to `reviewer_agent` → parse response (`APPROVED` → proceed; `NEEDS_WORK` → `{ proceed: false }` → `NEEDS_REWORK`).

Overlay chain update in `src/overlays/composition-rules.ts`:
```
HIL → Planning Review → Evidence Gate → Agentic Review → Paired → Confidence → Dispatch
```
`composition-rules.ts` must be updated to include the new slot and validate that Planning Review is only present when `overlays.planning_review.enabled: true`.

**C.4 AC coverage gate in `complete-task`** — `src/cli/commands/complete-task.ts`, new step 2.5 between sanitize and contract-validate:
```typescript
// Step 2.5: AC coverage check (when governance mode is warn or enforce)
const declaredACs = await loadDeclaredACs(projectPath, taskId);
if (declaredACs.length > 0) {
  const hs = handoverState as GatedHandoverState;
  const coverage = hs.ac_coverage ?? {};
  const uncovered = declaredACs.filter(ac => !coverage[ac.scenario]);
  if (uncovered.length > 0) {
    const msg = `AC coverage missing for: ${uncovered.map(ac => ac.scenario).join("; ")}`;
    if (governanceMode === "enforce") {
      return transitionToNeedsRework(taskId, msg);
    } else if (governanceMode === "warn") {
      emitter.emit("ac.coverage.incomplete", { task_id: taskId, uncovered });
    }
  }
}
```

**Exit criteria:**
1. `ai-sdd traceability gaps` returns non-zero exit code when critical gaps exist.
2. `validate_requirements_lock` MCP tool returns real data (not stub response) after C.2.
3. Planning Review overlay blocks dispatch with `NEEDS_REWORK` on reviewer rejection.
4. `complete-task` with `governance.requirements_lock: enforce` transitions to `NEEDS_REWORK` on uncovered AC.
5. `composition-rules.ts` validates the Planning Review slot correctly.

---

##### Phase D: Tooling and CI Hardening
**Effort:** 2–3 days | **Risk:** Low

**D.1** Budget enforcement script — `data/integration/scripts/check-budgets.sh`: reads `toolgate.yaml`, uses `git diff --stat`, exits non-zero on violation.

**D.2** Lock regeneration task library entry — `data/task-library/regenerate-requirements-lock.yaml`:
```yaml
id: regenerate-requirements-lock
description: |
  Regenerate requirements.lock.yaml from existing code.
  Extract requirements from evidence only: OpenAPI specs, tests, public interfaces.
  Never infer intent. Never invent requirements.
agent: architect
phase: planning
acceptance_criteria:
  - scenario: "Lock regenerated from evidence"
    given: "Existing codebase with tests and interfaces"
    when: "Regeneration task completes"
    then:
      - "requirements.lock.yaml updated with current state"
      - "spec_hash updated in workflow-state.json"
      - "change_reason provided for any breaking changes"
      - "diff classification provided: breaking | significant | minor"
```

**D.3** Phase-based model routing — `src/adapters/factory.ts` resolves: task-level adapter override > `phase_routing[task.phase]` > top-level adapter default.

**D.4** `ai-sdd init` copies scripts, CI template, `toolgate.yaml`, and `requirements.lock.example.yaml` to project.

**D.5** Developer documentation — add a section to the project wiki or CLAUDE.md explaining governance and traceability features, how to configure them, and what each error message means. This is a required deliverable, not optional. (Addresses prior review Recommendation 3.)

**Exit criteria:**
1. `ai-sdd init` copies all new templates.
2. CI gate runs on PR; fails on spec hash mismatch.
3. Budget check script exits non-zero when `toolgate.yaml` limits exceeded.
4. Phase routing selects correct adapter per `task.phase` in `--dry-run` output.
5. Documentation exists and covers at least: governance modes, AC declaration format, traceability CLI usage.

---

##### Phase E: Production Hardening
**Effort:** 2–3 days | **Risk:** Low

1. Schema-validated state and context artifacts in CI.
2. Release readiness checklist template.
3. Adoption reporting: add `--adoption-metrics` flag to `ai-sdd status` showing % tasks with ACs, governance mode, lock presence.

---

#### S6. Feature-to-File Map

| Feature | Source | ai-sdd target file |
|---|---|---|
| Agent constitution | `agents/constitution.md` | `data/integration/claude-code/agents/constitution.md` (new) |
| GO protocol | `CLAUDE.md` §Confidence | `data/integration/claude-code/agents/sdd-scaffold.md`, `sdd-ba.md` |
| Toolgate template | `toolgate.yaml` | `data/integration/toolgate.yaml` (new) |
| Governance type + config | codex.md C1 | `src/types/index.ts` GovernanceConfig, `ai-sdd.yaml` schema |
| GatedHandoverState type | synthesis addition | `src/types/index.ts` |
| Requirements lock schema | `example.requirements.lock.yaml` | `data/integration/requirements.lock.example.yaml` (new) |
| Spec hash tracking | `scripts/spec-hash.sh` | `src/core/engine.ts` run() startup |
| AcceptanceCriterion type | AC format rules | `src/types/index.ts` |
| TaskBudget type | toolgate.yaml budgets | `src/types/index.ts` |
| Scope excluded gate (Gate 2) | Gate 2 of drift check | `src/overlays/policy-gate/gate-overlay.ts` |
| Budget gate (Gate 2b) | toolgate budgets | `src/overlays/policy-gate/gate-overlay.ts` |
| Traceability CLI | codex.md C2, natively implemented | `src/cli/commands/traceability.ts` (new) |
| MCP governance tools | deepseek.md D2 | `src/integration/mcp-server/server.ts` |
| Planning Review overlay | `agents/planning-reviewer.md` | `src/overlays/planning-review/planning-review-overlay.ts` (new) |
| Composition rules update | synthesis requirement | `src/overlays/composition-rules.ts` |
| AC coverage in complete-task | AC validation rules | `src/cli/commands/complete-task.ts` step 2.5 |
| Phase routing | `agents/model-routing.yaml` | `src/adapters/factory.ts` + `ai-sdd.yaml` |
| Drift scripts | `scripts/reproducibility-check.sh` etc. | `data/integration/scripts/` (new) |
| CI template | `.github/workflows/framework-gates-sample.yml` | `data/integration/.github/workflows/ai-sdd-gates.yml` (new) |
| Budget check script | toolgate enforcement | `data/integration/scripts/check-budgets.sh` (new) |
| Lock regeneration task | `agents/requirements-lock/` approach | `data/task-library/regenerate-requirements-lock.yaml` (new) |

---

#### S7. Success Metrics

**Technical:**
1. PR gate outcomes are deterministic for the same input (0 flaky gate runs).
2. > 80% of scope-drift class issues caught by Gate 2 before merge.
3. Traceability critical-gap count trends downward release-over-release.
4. Mean time to diagnose a failed workflow run is reduced (schema-validated state artifacts).

**Adoption:**
1. % projects with `governance.requirements_lock: enforce`.
2. % workflows using lock + acceptance_criteria fields.
3. Number of releases passing `ai-sdd traceability report` with zero critical gaps.

---

#### S8. Explicit Non-Goals (first merge cycle)

1. Replacing the ai-sdd state machine with a YAML equivalent.
2. Mandating lock-based workflow on all existing projects immediately.
3. Rewriting existing overlays, adapters, or the engine before governance assets land.
4. Multi-project or org-scale validation tooling.
5. Speculative ML/predictive drift features.
6. Full MCP server unification.

---

## 6. What the Prior Review (review_of_merged_claude-gemini.md) Adds

The Gemini review was written against `merged-claude.md` only. Its observations:

### Points to incorporate into the synthesis

**Gemini Recommendation 1: Formalize the `handover_state` schema.**
This is the most valuable point in the review. The loosely typed `Record<string, unknown>` cast in Gate 2b is a real problem: it creates a silent pass condition when agents do not populate the expected fields. The synthesis has adopted this as Rule S3.6 (`GatedHandoverState` interface) and applied it throughout the policy gate and `complete-task` logic. Agents that do not report budget fields get a warning, not a silent pass.

**Gemini Recommendation 2: De-risk Phase 3 by sequencing sub-tasks.**
Also correct. The synthesis has broken `merged-claude.md`'s Phase 3 into explicit C.1 → C.2 → C.3 → C.4 sequence with stated dependencies. C.1 (traceability CLI) must complete before C.2 (MCP wiring). C.3 (Planning Review overlay) is parallelizable with C.1/C.2.

**Gemini Recommendation 3: Add documentation as a required deliverable.**
Agreed and adopted. Phase D.5 makes developer documentation a required exit criterion, not an optional task.

### Points where the prior review is incomplete or I disagree

**The Gemini review does not address `merged-codex.md` at all.** It reviews only `merged-claude.md`. This means it missed the imprecise framing in `merged-claude.md` (which calls `tools/validators` and `tools/query-engine` "hallucinated" when they exist in the separate `coding-standards` repo — the real issue is an open cross-repo integration decision, not whether the modules exist) and the lack of architectural invariant awareness in `merged-codex.md`. These gaps are consequential for anyone using either document as the plan.

**Time estimate critique is soft.** The Gemini review notes that "5-8 days for Phase 3 appears optimistic" but does not propose revised estimates or justify why. The synthesis addresses this structurally (by splitting the phase and providing clearer sub-task boundaries) rather than just flagging the risk.

**The Gemini review does not address `composition-rules.ts`.** Both documents add Planning Review to the overlay chain without specifying that `composition-rules.ts` must be updated. The synthesis calls this out explicitly.

---

## 7. Open Decisions

The following decisions require explicit resolution before or during the indicated phase.

---

**Integration decision: `coding-standards/tools/` dependency**
`merged-codex.md` proposes using `tools/validators` and `tools/query-engine` from the `coding-standards` repo. `merged-claude.md` excludes them as out-of-scope. These modules exist in a separate repo. The question is whether `ai-sdd-claude` should depend on them. Recommended default: keep `ai-sdd-claude` self-contained and implement equivalent functionality natively, unless the `coding-standards` tools have a stable versioned API and the teams are aligned. Document this decision explicitly in the synthesis — do not leave it implicit.

---

## 8. Resolved Decisions

The following decisions were previously open questions. Each is now resolved with rationale.

**Decision 1 — Lock mode (`greenfield|brownfield`)**
Decision: **Default to `greenfield`, explicitly overridable in `ai-sdd.yaml` under `lock_mode:`**.
Rationale: ai-sdd already uses a scale concept (`quickfix`/`feature`/`greenfield`/`regulated`). Making lock mode a required field adds friction with no benefit for the common case. Defaulting to `greenfield` means new spec-driven workflows get full traceability from the start. Brownfield projects explicitly opt in by setting `lock_mode: brownfield`, which signals intentional relaxation of invariants (e.g. allowing partial requirement coverage). This is consistent with the project's pattern of explicit opt-out of safety features rather than opt-in.

**Decision 2 — Default governance mode at `init`**
Decision: **`standard` (equivalent to T1 policy gate, HIL enabled)**.
Rationale: The engine's existing defaults are already `hil.enabled: true` and `policy_gate.risk_tier: T1`. The governance mode at init should match these defaults — not more restrictive (would block simple projects), not silent (would defeat the purpose of SDD). `standard` means all gates are present and advisory reviews run, but T2 human sign-off is only triggered when explicitly configured. Users escalate to `strict` for regulated/safety-critical workflows.

**Decision 3 — First-run spec hash behaviour**
Decision: **Warn on first run (no baseline), block on subsequent runs where the hash has changed without an explicit `--acknowledge-spec-change` flag.**
Rationale: First run is inherently a baseline-establishment operation — blocking it serves no purpose since there is no prior state to protect. Subsequent runs with a changed spec hash indicate the specification was modified after implementation began, which is a material event that should require explicit acknowledgement. This matches the project's principle: "block intentional changes, warn exploratory/initial state." The flag `--acknowledge-spec-change` must be recorded in the audit log with a reason.

**Decision 4 — Planning Review timeout: fail-open or fail-closed**
Decision: **Fail-closed (block workflow) with a configurable timeout (default 24h) and a `--waive-planning-review` flag that requires a written reason.**
Rationale: Planning Review is a design gate that prevents implementation work from starting on an underspecified plan. Fail-open would make the gate meaningless — a stuck or slow review would silently allow implementation to proceed. Fail-closed matches the project's safety-critical philosophy: "if you want to bypass a gate, you must explicitly say so and your reason is recorded." The 24h default is long enough for async review workflows. Safety-critical projects (T2) should override the timeout to `0` (no timeout — must be explicitly resolved).

**Decision 5 — AC coverage reporting responsibility**
Decision: **Dev agent asserts coverage in `handover_state`; reviewer agent verifies it.**
Specifically:
- Dev agent must include `ac_coverage: { claimed: N, total: M, uncovered: ["AC-ID", ...] }` in its `handover_state` output.
- Reviewer agent must verify the claimed coverage against the task's Gherkin scenarios and reject (`NO_GO`) if coverage is understated or scenarios are missing.
- This splits the responsibility cleanly: dev *claims*, reviewer *validates*. Neither can silently pass without the other.
Rationale: Matches the existing `handover_state` pattern (`tests_passed`, `lint_passed`, `security_clean`). AC coverage is a first-class evidence type, not a narrative comment.

**Decision 6 — Multi-adapter auth warnings**
Decision: **Only emit auth warnings for adapters actively referenced in the current workflow's agent definitions.** Inactive/unconfigured adapters are silent.
Rationale: A project using only the `claude_code` adapter should not see warnings about missing OpenAI keys. Noisy warnings train users to ignore warnings. The rule: if an agent in the current workflow YAML references adapter X, and adapter X has no valid auth configured, emit a blocking error before the workflow starts. If adapter X is defined in `ai-sdd.yaml` but not used by any agent in the active workflow, emit nothing.
