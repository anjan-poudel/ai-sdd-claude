

# MERGED: Three-Way Proposal Review — coding-standards → ai-sdd

**Date:** 2026-03-04
**Inputs reviewed:**
- `specs/merge-coding-standards/claude.md` — authored by Claude Sonnet 4.6
- `specs/merge-coding-standards/codex.md` — authored by Codex / GPT-4o
- `specs/merge-coding-standards/deepseek.md` — authored by DeepSeek Chat

**Status:** MERGED — supersedes individual proposals

---

## 1. Foundation Choice: `claude.md`

I chose **`claude.md` (the Claude Sonnet 4.6 proposal) as the foundation**.

### Rationale

#### Why `claude.md` wins as foundation

1. **Codebase fidelity.** It is the only proposal that names specific ai-sdd files and TypeScript
   symbols at every integration point. Examples:
    - `src/overlays/policy-gate/gate-overlay.ts` — for scope-excluded sub-gate
    - `src/types/index.ts` — for `AcceptanceCriterion`, `TaskBudget`, `VALID_TRANSITIONS`
    - `src/core/engine.ts` — for spec-hash tracking at run startup
    - `src/cli/commands/complete-task.ts` — for AC coverage step (Step 2.5)

   The other two proposals describe _what_ to build but are vague about _where_ in the codebase
   to put it. This matters because ai-sdd has strict architectural invariants
   (`VALID_TRANSITIONS`, overlay chain order, atomic `complete-task` boundary).

2. **Explicit "What NOT to merge" discipline.** `claude.md` provides a concrete table of
   coding-standards features that ai-sdd already has equivalents for, preventing wasted effort
   and risky rewrites. Neither `codex.md` nor `deepseek.md` does this.

3. **Structural backward compatibility.** Every proposed change is additive:
    - New fields on `TaskDefinition` are `optional`
    - New overlays are `enabled: false` by default
    - New CLI commands are additive (no changes to existing commands)
    - No changes to `VALID_TRANSITIONS` or the overlay chain contract

4. **Concrete TypeScript code snippets.** Each feature integration shows exactly what to write,
   not just a description. This removes ambiguity during implementation.

#### What `claude.md` lacks that the others supply

- **Governance adoption tristate flag** (`off|warn|enforce`) — from `codex.md`
- **`ai-sdd traceability` standalone CLI command** — from `codex.md`
- **Success metrics** — from `codex.md`
- **Sub-gate architecture naming** (Gates 0–5 explicitly referenced) — from `deepseek.md`
- **MCP tool registration for governance** — from `deepseek.md`
- **Organizational impact / adoption framing** — from `deepseek.md`

These are added to the foundation below.

---

## 2. Feature Contributions by LLM

### From `codex.md` — three features adopted

#### C1: Governance Adoption Tristate Flag

`codex.md` proposes a `governance.requirements_lock: off|warn|enforce` feature flag.
This is superior to `claude.md`'s simple `enforce: true` boolean because it provides a
**graduated adoption ramp** — teams can start at `warn` to see violations without being blocked,
then promote to `enforce` once confident.

**Adopted as:** `governance.requirements_lock: off | warn | enforce` in `ai-sdd.yaml` schema.
Applied to: requirements lock enforcement, scope drift gate, AC coverage check.

#### C2: `ai-sdd traceability` Standalone CLI Command

`codex.md` proposes a dedicated `ai-sdd traceability` command with sub-commands
`validate-lock`, `gaps`, `coverage --requirement REQ-xxx`, and `report --json`.
This is a better separation of concerns than bundling traceability into `validate-config`.

**Adopted as:** New `src/cli/commands/traceability.ts` with four sub-commands.
Rationale: traceability is a first-class workflow concern, not a config concern.

Note: `codex.md` also references `tools/validators` and `tools/query-engine` modules —
these do not exist in `coding-standards`. The traceability CLI will be implemented natively
in `src/cli/commands/traceability.ts` without those phantom modules.

#### C3: Success Metrics

`codex.md` provides concrete, measurable success targets. These are adopted verbatim as
the acceptance criteria for the merge itself.

**Adopted as:** Section 7 of this document.

### From `codex.md` — rejected

| Feature | Reason rejected |
|---------|----------------|
| Phase D: Import `workflow/events-contract.md`, `state-store.schema.json` | ai-sdd already has `src/observability/emitter.ts` and `src/core/state-manager.ts` in typed TypeScript. Adding JSON schemas for the same concepts creates redundancy, not safety. |
| Import `tools/validators` and `tools/query-engine` | These modules do not exist in coding-standards. Codex hallucinated them. |
| `scripts/dryrun.sh` and `scripts/run-phase.sh` | Superseded by ai-sdd's existing `--dry-run` and `--task` flags and the phase routing proposal. |

---

### From `deepseek.md` — three features adopted

#### D1: Sub-Gate Architecture Naming

`deepseek.md` frames the coding-standards drift detection as Gates 0–5 and explicitly maps
each gate to a sub-check inside `PolicyGateOverlay.postTask`. This naming is clearer than
`claude.md`'s prose description of the same checks.

**Adopted as:** Each sub-gate is now named in the PolicyGateOverlay implementation:
- Gate 0: Spec hash match
- Gate 2: Scope excluded terms
- Gate 2b: Scope budget check
- Gate 4: AC coverage verification (when declared)

This naming is used in gate failure messages so developers know which check triggered.

#### D2: MCP Tool Registration (Scoped)

`deepseek.md` proposes registering governance queries as MCP tools. This is valuable for
Claude Code integration — a user in the IDE can invoke `validate_requirements_lock` without
opening a terminal.

**Adopted as:** Two new MCP tools added to `src/integration/mcp-server/server.ts`:
- `validate_requirements_lock` — delegates to `ai-sdd traceability validate-lock`
- `check_scope_drift` — delegates to `ai-sdd traceability gaps`

Scope reduction from `deepseek.md`: only these two tools, not the full Phase 0 MCP unification
that deepseek proposed. The existing MCP server architecture is preserved.

#### D3: Organizational Impact Framing

`deepseek.md` provides the clearest framing of why this merge matters at a team/org level.
This framing is adopted for the executive summary and is useful for communicating the merge
value to stakeholders.

### From `deepseek.md` — rejected

| Feature | Reason rejected |
|---------|----------------|
| `REQUIREMENTS_VALIDATED` task state | **Hard reject.** This breaks `VALID_TRANSITIONS` in `src/types/index.ts`. The state machine is an architectural invariant; adding states requires engine changes across all adapters, tests, and CLI commands. The validation can be done as a pre-task check without a new state. |
| Phase 0: Full MCP server unification | Too risky. The existing MCP server works and is in active use. A full unification is a separate project. |
| Phase 5: ML/predictive features (drift prediction, AI-powered coverage) | Speculative. These depend on baseline governance working first. Deferred indefinitely. |
| Multi-candidate evaluation engine (generate 5, score, select best) | Out of scope. This changes the agent execution model significantly. |

---

## 3. Architecture: Integration Points

```
ai-sdd runtime (UNCHANGED)
─────────────────────────────────────────────────────────────────────
WorkflowLoader → Engine → OverlayChain → Adapter → complete-task
                            │
                            │   ADDITIONS (additive only)
                            │
                            ├── PolicyGateOverlay.postTask:
                            │     Gate 0: spec_hash match (NEW)
                            │     Gate 2: scope_excluded scan (NEW)
                            │     Gate 2b: budget check (NEW)
                            │     Gate 4: AC coverage verification (NEW)
                            │
                            └── PlanningReviewOverlay.preTask (NEW, opt-in)
                                  → reviews plan before dispatch

src/types/index.ts ADDITIONS (all optional fields):
  TaskDefinition.acceptance_criteria?: AcceptanceCriterion[]
  TaskDefinition.requirement_ids?: string[]
  TaskDefinition.scope_excluded?: string[]
  TaskDefinition.budget?: TaskBudget
  TaskDefinition.phase?: string

WorkflowState ADDITIONS:
  requirements_lock?: { spec_hash, path, locked_at }

ai-sdd.yaml ADDITIONS:
  governance.requirements_lock: off | warn | enforce
  requirements_lock.path, .enforce
  adapter.phase_routing: { planning, implementation, review }
  overlays.planning_review: { enabled, reviewer_agent }

New CLI: ai-sdd traceability [validate-lock | gaps | coverage | report]
New MCP tools: validate_requirements_lock, check_scope_drift
```

---

## 4. Merged Implementation Plan

### Phase 1: Zero-Code Wins
**Effort:** 1–2 days | **Risk:** None (docs + config templates only)

| Item | Source | Files |
|------|--------|-------|
| Agent constitution (gold-plating prevention rules) | CS-09 | `data/integration/claude-code/agents/constitution.md` (new) |
| GO Protocol in scaffold + BA agents | CS-02 | `data/integration/claude-code/agents/sdd-scaffold.md`, `ba.md` |
| `toolgate.yaml` template copied by `init` | CS-12 | `data/integration/toolgate.yaml` (new) |
| `plans/<feature>/` convention in CLAUDE.md | CS-14 | `CLAUDE.md` |

**Agent constitution content (from coding-standards, adapted):**
```markdown
## Agent Constitution (Mandatory — Non-Negotiable Baseline)

1. Treat `requirements.lock.yaml` as the source of truth when present.
2. Do not mark work complete unless ALL acceptance criteria are explicitly addressed.
3. Do not add features, logging, retries, caching, or error handling not in the task definition.
   This is gold-plating. It is forbidden.
4. Surface blockers and ambiguities in `handover_state.blockers`.
5. Every code change must trace to an acceptance criterion or requirement ID in the task definition.
6. A Planning Review runs before implementation. Your confidence score does not bypass it.
```

**GO Protocol additions to `sdd-scaffold.md`:**
```markdown
## Confidence Protocol (Mandatory Before Output)

1. List every explicitly stated requirement.
2. Identify ambiguities. Ask clarifying questions if confidence < 90%.
3. At confidence ≥ 90%: present LOCKED REQUIREMENTS summary. Ask user to respond "GO".
4. Write specifications ONLY after receiving "GO".

Output header for all specification files:
  LOCKED REQUIREMENTS | Confidence: [N]% | Approved: [timestamp]
```

**Exit criteria:**
1. All 6 agent MD files reference `constitution.md`.
2. `sdd-scaffold.md` has the confidence + GO protocol section.
3. `toolgate.yaml` is in `data/integration/` and copied by `ai-sdd init`.

---

### Phase 2: Schema Extensions + Governance Flag
**Effort:** 3–5 days | **Risk:** Low (additive types + optional config)

**2.1 Governance tristate flag** (from `codex.md` C1)

New block in `ai-sdd.yaml`:
```yaml
governance:
  requirements_lock: warn    # off | warn | enforce
```

`src/types/index.ts` addition:
```typescript
export type GovernanceMode = "off" | "warn" | "enforce";

export interface GovernanceConfig {
  requirements_lock?: GovernanceMode;
}
```

`run` preflight: when lock path exists and mode is `enforce`, missing lock = hard fail.
When mode is `warn`, missing lock emits warning event and continues.

**2.2 `requirements.lock.yaml` spec hash tracking** (CS-07)

`src/core/engine.ts` `run()` startup addition:
```typescript
if (config.requirements_lock?.path) {
  const lockFile = resolve(projectPath, config.requirements_lock.path);
  if (existsSync(lockFile)) {
    const hash = createHash("sha256").update(readFileSync(lockFile)).digest("hex");
    const prev = state.requirements_lock?.spec_hash;
    if (prev && prev !== hash) {
      emitter.emit("requirements.lock.changed", { previous_hash: prev, current_hash: hash });
    }
    await stateManager.patch({ requirements_lock: { spec_hash: hash, path: lockFile, locked_at: new Date().toISOString() } });
  }
}
```

**2.3 `AcceptanceCriterion` + `TaskBudget` in task schema** (CS-03, CS-06)

`src/types/index.ts` additions:
```typescript
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

// Added to existing TaskDefinition:
// acceptance_criteria?: AcceptanceCriterion[];
// requirement_ids?: string[];
// scope_excluded?: string[];
// budget?: TaskBudget;
// phase?: string;
```

**2.4 PolicyGateOverlay sub-gates** (CS-05, from `deepseek.md` D1 naming)

`src/overlays/policy-gate/gate-overlay.ts` `postTask` additions:
```typescript
// Gate 2: Scope excluded (scope drift prevention)
const excluded = ctx.task_definition.scope_excluded ?? [];
if (excluded.length > 0) {
  const output = (result.handover_state?.raw_output as string) ?? "";
  const violations = excluded.filter(t => output.toLowerCase().includes(t.toLowerCase()));
  if (violations.length > 0) {
    failures.push(
      `[Gate 2] Scope drift: excluded terms found in output: ${violations.join(", ")}. ` +
      `Remove these and resubmit.`
    );
  }
}

// Gate 2b: Budget check
const budget = ctx.task_definition.budget;
if (budget) {
  const hs = result.handover_state as Record<string, unknown> ?? {};
  const checks = [
    { key: "new_files_created", limit: budget.max_new_files, label: "new files" },
    { key: "loc_delta",          limit: budget.max_loc_delta,  label: "LOC delta" },
    { key: "new_public_apis",    limit: budget.max_new_public_apis, label: "public APIs" },
  ];
  for (const c of checks) {
    if (c.limit !== undefined && typeof hs[c.key] === "number" && (hs[c.key] as number) > c.limit) {
      failures.push(`[Gate 2b] Budget exceeded: ${hs[c.key]} ${c.label} (max ${c.limit})`);
    }
  }
}
```

**Exit criteria:**
1. `bun run typecheck` passes with new types.
2. Workflow with `scope_excluded` fails policy gate when output contains excluded term.
3. `governance.requirements_lock: enforce` causes `run` preflight fail when lock missing.
4. Spec hash stored in `workflow-state.json` and `requirements.lock.changed` event emitted.

---

### Phase 3: Traceability CLI + Planning Review Overlay
**Effort:** 5–8 days | **Risk:** Medium (new overlay, new command)

**3.1 `ai-sdd traceability` CLI command** (from `codex.md` C2)

`src/cli/commands/traceability.ts` — new file, registered in `src/cli/index.ts`:

```typescript
// Sub-commands:
// ai-sdd traceability validate-lock       — check lock file against workflow tasks
// ai-sdd traceability gaps                — list reqs without tasks, tasks without tests
// ai-sdd traceability coverage --req REQ-001  — show tasks/tests for a requirement
// ai-sdd traceability report --json       — machine-readable gap report
```

The command reads `requirements.lock.yaml` and `workflow-state.json` to compute:
- requirements declared but not linked to any task (`requirement_ids`)
- tasks with `acceptance_criteria` but no AC coverage in last completed run
- `handover_state.tests_passed` distribution across tasks

**3.2 New MCP tools** (from `deepseek.md` D2)

`src/integration/mcp-server/server.ts` additions (two tools only):
```typescript
{ name: "validate_requirements_lock", description: "Validate requirements.lock.yaml integrity and task linkage" }
{ name: "check_scope_drift",          description: "Check last completed task output for scope drift violations" }
```

Both tools delegate to `traceability validate-lock` and `traceability gaps` respectively.

**3.3 `PlanningReviewOverlay`** (CS-04, `claude.md` foundation)

`src/overlays/planning-review/planning-review-overlay.ts` — new file.

Config in `ai-sdd.yaml`:
```yaml
overlays:
  planning_review:
    enabled: false              # opt-in
    reviewer_agent: "reviewer"
    block_on_needs_work: true
```

`preTask` behaviour:
1. Build review prompt: task definition + ACs + `scope_excluded` + `requirement_ids` + agent description
2. Dispatch to `reviewer_agent`
3. Parse response: `APPROVED` → proceed; `NEEDS_WORK` → `{ proceed: false }` → `NEEDS_REWORK`

Overlay chain order update (`src/overlays/composition-rules.ts`):
```
HIL → Planning Review → Evidence Gate → Agentic Review → Paired → Confidence → Dispatch
```

**3.4 AC coverage gate in `complete-task`** (CS-03 extension)

`src/cli/commands/complete-task.ts` — new step 2.5 between sanitize and contract-validate:
```typescript
// Step 2.5: AC coverage check (when governance mode is warn or enforce)
const declaredACs = await loadDeclaredACs(projectPath, taskId);
if (declaredACs.length > 0) {
  const coverage = handoverState["ac_coverage"] as Record<string, boolean> ?? {};
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
2. `validate_requirements_lock` MCP tool callable from Claude Code IDE.
3. Planning review overlay blocks task dispatch with `NEEDS_REWORK` on reviewer rejection.
4. `complete-task` with `enforcement: enforce` transitions to `NEEDS_REWORK` on uncovered AC.

---

### Phase 4: Tooling and CI/CD
**Effort:** 3–5 days | **Risk:** Low (scripts + templates, no engine changes)

**4.1 Adapt drift scripts** (CS-10)

`data/integration/scripts/reproducibility-check.sh` — adapted from `coding-standards/scripts/`:
- Checks `bun run typecheck` instead of gradle
- Checks `.ai-sdd/requirements.lock.yaml` path instead of root lock
- Checks `workflow-state.json` existence and `schema_version: "1"`

`data/integration/scripts/semantic-drift-check.sh` — adapted:
- Gate 0: reads `spec_hash` from `workflow-state.json` (not standalone file)
- Gate 2: reads `scope_excluded` from workflow YAML tasks
- No Gate 3 (architecture conformance) — too project-specific for a template

**4.2 GitHub Actions template** (CS-10 extension)

`data/integration/.github/workflows/ai-sdd-gates.yml` — copied by `ai-sdd init`:
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

**4.3 Budget enforcement script** (CS-13)

`data/integration/scripts/check-budgets.sh`:
- Reads `toolgate.yaml` budgets block
- Uses `git diff --stat` to count new files
- Compares against budget limits
- Exits non-zero on violation (usable in CI)

**4.4 Lock regeneration task library entry** (CS-11)

`data/task-library/regenerate-requirements-lock.yaml`:
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

**4.5 Phase-based model routing** (CS-08)

`ai-sdd.yaml` addition:
```yaml
adapter:
  type: claude_code
  phase_routing:
    planning:      { type: openai,       model: gpt-4o,           temperature: 0.2 }
    review:        { type: claude_code,  model: claude-opus-4-6,  temperature: 0.0 }
    implementation:{ type: claude_code,  model: claude-sonnet-4-6,temperature: 0.1 }
```

`src/adapters/factory.ts` resolves phase routing:
precedence: `task.adapter override > phase_routing[task.phase] > config.adapter default`.

**Exit criteria:**
1. `ai-sdd init` copies scripts, GitHub Actions template, and `toolgate.yaml`.
2. Gate workflow runs on PR; fails on spec hash mismatch.
3. Budget check script exits non-zero when `toolgate.yaml` limits are exceeded.
4. Phase routing selects correct adapter per task phase in dry-run output.

---

## 5. What NOT to Merge

| coding-standards feature | ai-sdd equivalent | Decision |
|---|---|---|
| `workflow/state-machine.yaml` | `src/types/index.ts` VALID_TRANSITIONS (TypeScript-enforced) | Skip — YAML advisory is weaker |
| `workflow/context.schema.json` | `src/core/context-manager.ts` typed assembly | Skip — already covered |
| `workflow/events-contract.md` | `src/observability/emitter.ts` typed events | Skip — already covered |
| `scripts/check-iteration-limits.sh` | `max_rework_iterations` in engine state machine | Skip — engine enforces this |
| `tools/validators` / `tools/query-engine` | (does not exist in coding-standards) | Skip — these are hallucinated modules |
| Language-specific standards (java/, kotlin/) | N/A | Skip — ai-sdd is TypeScript |
| `REQUIREMENTS_VALIDATED` task state | Replaced by governance flag + preTask check | **Hard reject** — breaks VALID_TRANSITIONS |
| Multi-candidate eval (generate 5, score, select) | Out of scope | Defer — changes execution model |
| Phase 5 ML / drift prediction | Speculative | Defer — needs baseline first |

---

## 6. Priority Summary

| Phase | Items | Days | Value | Dependency |
|-------|-------|------|-------|-----------|
| 1 | Constitution, GO protocol, toolgate template | 1–2 | High — immediate, zero risk | None |
| 2 | Governance flag, schema extensions, sub-gates | 3–5 | Very High — foundational | Phase 1 |
| 3 | Traceability CLI, Planning Review overlay, MCP tools, AC gate | 5–8 | High — new capabilities | Phase 2 |
| 4 | Scripts, CI template, budget check, phase routing, lock regen task | 3–5 | Medium — CI + tooling | Phase 3 |

---

## 7. Success Metrics (from `codex.md`)

**Technical:**
1. PR gate outcomes are deterministic for the same input (0 flaky gate runs).
2. > 80% of scope-drift class issues caught by Gate 2 before merge.
3. Traceability critical-gap count trends downward release-over-release.
4. Mean time to diagnose failed workflow run reduced (schema-validated state artifacts).

**Adoption:**
1. % projects using `requirements.lock.yaml` with `governance.requirements_lock: enforce`.
2. % workflows executed with at least one task with `acceptance_criteria` declared.
3. # releases passing `ai-sdd traceability report` with zero critical gaps.

---

## 8. Feature-to-File Map

| Feature | Source | ai-sdd target file |
|---------|--------|--------------------|
| Agent constitution | `agents/constitution.md` | `data/integration/claude-code/agents/constitution.md` (new) |
| GO protocol | `CLAUDE.md` §Confidence | `data/integration/claude-code/agents/sdd-scaffold.md`, `ba.md` |
| Toolgate template | `toolgate.yaml` | `data/integration/toolgate.yaml` (new) |
| Governance flag | (codex.md C1) | `src/types/index.ts` GovernanceConfig, `ai-sdd.yaml` schema |
| Requirements lock schema | `example.requirements.lock.yaml` | `data/integration/requirements.lock.example.yaml` (new) |
| Spec hash tracking | `scripts/spec-hash.sh` | `src/core/engine.ts` run() startup |
| AcceptanceCriterion type | AC format rules | `src/types/index.ts` |
| Scope excluded gate | Gate 2 of drift check | `src/overlays/policy-gate/gate-overlay.ts` |
| Scope budgets | `toolgate.yaml` budgets | `src/types/index.ts` TaskBudget; `gate-overlay.ts` |
| Traceability CLI | (codex.md C2) | `src/cli/commands/traceability.ts` (new) |
| MCP governance tools | (deepseek.md D2) | `src/integration/mcp-server/server.ts` |
| Planning Review overlay | `agents/planning-reviewer.md` | `src/overlays/planning-review/planning-review-overlay.ts` (new) |
| AC coverage in complete-task | AC validation rules | `src/cli/commands/complete-task.ts` step 2.5 |
| Phase routing | `agents/model-routing.yaml` | `src/adapters/factory.ts` + `ai-sdd.yaml` |
| Drift scripts | `scripts/reproducibility-check.sh`, `semantic-drift-check.sh` | `data/integration/scripts/` (new) |
| CI template | `.github/workflows/framework-gates-sample.yml` | `data/integration/.github/workflows/ai-sdd-gates.yml` (new) |
| Budget check script | (toolgate enforcement) | `data/integration/scripts/check-budgets.sh` (new) |
| Lock regeneration task | `agents/requirements-lock/` approach | `data/task-library/regenerate-requirements-lock.yaml` (new) |

---

## 9. Explicit Non-Goals (first merge cycle)

1. Replacing ai-sdd state machine with coding-standards YAML state machine.
2. Forcing lock-based workflow on every project immediately.
3. Rewriting existing overlays, adapters, or the engine before governance assets land.
4. Multi-project / org-scale validation tooling.
5. Speculative ML/predictive features.
