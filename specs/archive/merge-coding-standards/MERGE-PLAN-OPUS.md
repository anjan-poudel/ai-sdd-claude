# Coding Standards → ai-sdd Merge Plan (Opus Review)

**Date:** 2026-03-06
**Branch:** feature/merge-coding-standards
**Status:** READY FOR TASK BREAKDOWN
**Reviewer:** Claude Opus 4.6 — critical review of MERGE-PLAN.md

---

## Review Findings

This plan is based on a critical review of `MERGE-PLAN.md` against all 13 synthesis documents, the 3 original proposals (`claude.md`, `codex.md`, `deepseek.md`), and the actual codebase state. Twenty issues were identified; all are addressed below. The overall structure and quorum methodology of the original plan are strong. The issues are primarily gaps in implementation specificity that would surface during coding.

### Issues Found and Resolved

| # | Issue | Severity | Resolution |
|---|-------|----------|------------|
| 1 | No Zod schemas specified for new types | High | Added to Phase 2 as explicit requirement |
| 2 | `requirements.lock.yaml` has no defined schema or parser | High | Added schema definition to Phase 2 |
| 3 | `governance.requirements_lock` tristate vs `requirements_lock.path` config are conflated | Medium | Separated into two config blocks |
| 4 | Gate 2 references `raw_output` but it's not in `GatedHandoverState` | Medium | Added `raw_output` to interface |
| 5 | Phase 1 claims "no TypeScript" but `init.ts` needs updating | Low | Reclassified Phase 1 as "minimal code" |
| 6 | `planning_review` not added to `TaskOverlays` interface | Medium | Explicit in Phase 3d |
| 7 | No test requirements per phase (violates CLAUDE.md standards) | High | Added test requirements per phase |
| 8 | MCP delegation mechanism unspecified | Medium | Specified: subprocess exec via `runCli()` |
| 9 | P4 quorum count wrong (first Claude review supported Phase 0 stubs) | Low | Corrected to 3/5 |
| 10 | Spec hash missing first-run vs subsequent-run distinction | Medium | Adopted synthesis-review-claude Decision 3 |
| 11 | PlanningReviewOverlay has no timeout handling | High | Added timeout config with fail-closed default |
| 12 | `ac_coverage` structure too simple — no claimed/total/uncovered | Medium | Adopted richer structure from synthesis-review-claude Decision 5 |
| 13 | Multi-adapter auth warnings unaddressed for phase routing | Low | Added to Phase 4.3 |
| 14 | `greenfield|brownfield` dismissed but has operational meaning | Low | Reconsidered as `lock_mode` |
| 15 | `governance: off` semantics undefined | Medium | Defined: skip all governance gates |
| 16 | MCS-009 bundles 3 features into 1 ticket | Medium | Split into MCS-009a/b/c |
| 17 | Phase 3d depends on Phase 2 `phase` field but not stated | Low | Dependency added |
| 18 | `check-budgets.sh` missing from Phase 4 scope | Low | Added as Phase 4.4 |
| 19 | `requirements.lock.example.yaml` has no phase/ticket | Low | Added to Phase 1 |
| 20 | Missing `requirements_lock` path config in Zod schema | Medium | Added to Phase 2 |

---

## Quorum Summary

Five model reviews synthesised across four passes. **Correction from original plan:** The first Claude synthesis review (`synthesis-review-claude.md`) supported Phase 0 MCP stubs, making the count for P4 3/5 against stubs (not 4/5).

| Shorthand | Full identity |
|-----------|--------------|
| C1 | Claude Sonnet 4.6 (synthesis-review-claude.md — first pass) |
| C2 | Claude Sonnet 4.6 (synthesis-review-claude-2.md — second pass) |
| CX | Codex / GPT-4o (synthesis-review-codex.md) |
| G1 | Gemini (synthesis-review-gemini.md) |
| G2 | Gemini — critical (critical_synthesis_review.md) |
| G3 | Gemini — final (final_synthesis_review.md) |

---

## Resolved Principles

| # | Principle | Agreement |
|---|-----------|-----------|
| P1 | Native TypeScript implementation; no cross-repo runtime dependency on `coding-standards/tools/*` | 6/6 (all) |
| P2 | `VALID_TRANSITIONS` state machine is untouched; no `REQUIREMENTS_VALIDATED` state | 6/6 (all) |
| P3 | All new `TaskDefinition` fields are `optional`; zero breaking changes to existing workflows | 6/6 (all) |
| P4 | MCP tools registered only after backing CLI commands exist | C2, CX, G1, G2, G3 — 5/6 (C1 favoured early stubs) |
| P5 | Governance features default to `warn`; `enforce` is opt-in | C1, C2, CX, G1 — 4/6 |
| P6 | `PlanningReviewOverlay` is opt-in (`enabled: false` default) | 6/6 (all) |
| P7 | Agent constitution and GO protocol belong in agent `.md` prompt templates | 6/6 (all) |
| P8 | Scripts and CI templates distributed via `ai-sdd init`, not manual install | 6/6 (all) |
| P9 | `GatedHandoverState` typed interface required before gates that read from `handover_state` | C2 (identified), C1 (agreed), G1 (adopted) — 3/6 (others silent) |
| P10 | Every new config field and gate must have a behaviour test (from CLAUDE.md standards) | Implicit in project rules — 6/6 |

---

## Resolved Open Decisions

### OD-1: `spec_hash` location
**Decision:** Store in `workflow-state.json` under `requirements_lock.spec_hash`.
**Models:** C2 (80%), G1 (20%)

### OD-2: Default governance mode for `ai-sdd init`
**Decision:** `warn`.
**Models:** C2 (60%), CX (20%), G1 (20%)

### OD-3: `PlanningReviewOverlay` phase scope
**Decision:** Restrict to tasks with `phase` in `phases: [planning, design]` config array.
**Models:** C2 (100%)

### OD-4: Planning review response format
**Decision:** Structured JSON: `{"planning_review": "APPROVED" | "NEEDS_WORK", "reason": "..."}`.
**Models:** C2 (70%), G1 (30%)

### OD-5: `traceability gaps` exit code threshold
**Decision:** Non-zero only on critical gaps (unlinked requirement↔task). Exit 0 with warnings for missing AC declarations.
**Models:** C2 (60%), G2 (40%)

### OD-6: `requirements.lock.yaml` ownership chain
**Decision:** BA produces initial lock → Architect regenerates on drift → Human approves via HIL.
**Models:** C2 (100%)

### OD-7: Cross-repo tools integration
**Decision:** Feasibility spike (MCS-011) before Phase 3. Default: implement natively.
**Models:** CX (50%), C2 (30%), G1 (20%)

### OD-8: First-run spec hash behaviour (NEW — from C1 Decision 3)
**Decision:** First run stores baseline hash without blocking. Subsequent runs where hash changed require `--acknowledge-spec-change=<reason>` flag or block. Reason is recorded in audit log via event.
**Models:** C1 (100% — original recommendation)

### OD-9: Planning review timeout (NEW — from C1 Decision 4)
**Decision:** Fail-closed with configurable timeout (`timeout_seconds`, default 86400 = 24h). Override via `--waive-planning-review=<reason>` flag (reason recorded in audit log).
**Models:** C1 (100% — original recommendation)

### OD-10: `governance: off` semantics (NEW)
**Decision:** `off` skips ALL governance checks: no spec hash tracking, no scope drift gate, no budget gate, no AC coverage gate. The `PolicyGateOverlay` T0/T1/T2 evidence checks still run (those are not governance — they are core overlay behaviour). `off` means "I don't use requirements.lock.yaml at all."
**Models:** Opus (inferred from tristate design intent — no source explicitly defined this)

### OD-11: `lock_mode` (reconsidered `greenfield|brownfield`)
**Decision:** Add optional `lock_mode: greenfield | brownfield` to config. Default: `greenfield`. `brownfield` relaxes traceability gap severity — unlinked tasks are warnings (exit 0) instead of critical gaps (exit non-zero). Ignored when `governance: off`.
**Models:** C1 (Decision 1 — 70%), CX (concept — 30%)

---

## Architecture Constraints

All new features must use existing ai-sdd primitives:

- **New gates** → sub-checks inside `PolicyGateOverlay.postTask`
- **New pre-task review** → `PlanningReviewOverlay` slotted via `composition-rules.ts`
- **New CLI commands** → `src/cli/commands/` + register in `src/cli/index.ts`
- **New types** → `src/types/index.ts` (optional fields only) + **Zod schemas** for runtime validation
- **New config** → `ai-sdd.yaml` schema with Zod validation + default in `src/config/defaults.ts`
- **MCP tools** → extend `src/integration/mcp-server/server.ts` TOOLS array; delegate via `runCli()` subprocess exec (existing pattern)

---

## Phased Implementation Plan

### Phase 1 — Zero-Code Foundations + Init Templates
**Effort: 1–2 days | Risk: None**

Primarily documentation and prompt templates. One small code change: `src/cli/commands/init.ts` must be updated to copy new template files.

#### 1.1 Agent Constitution (CS-09)
**What:** Create `data/integration/claude-code/agents/constitution.md`. Add a reference line to each of the 6 agent MD files (`sdd-architect.md`, `sdd-ba.md`, `sdd-dev.md`, `sdd-le.md`, `sdd-pe.md`, `sdd-reviewer.md`).

**Non-negotiable rules:**
1. Treat `requirements.lock.yaml` as source of truth when present.
2. Do not mark work complete unless all ACs are implemented and validated.
3. Surface blockers and deviations in `handover_state.blockers`.
4. No gold-plating (no unrequested features, logging, retries, caching, error handling).
5. Mandatory Planning Review before implementation; confidence score does not bypass it.
6. Every code change must trace to an AC in the task definition.
7. When `budget` fields present: report `new_files_created`, `loc_delta`, `new_public_apis` in `handover_state`.
8. When `acceptance_criteria` present: report `ac_coverage` as `{ claimed: N, total: M, uncovered: ["scenario-name", ...] }` in `handover_state`.
9. BA produces initial `requirements.lock.yaml`; Architect regenerates on drift; Human approves via HIL.

**Models:** C2 (60%), G1 (40%)

**Ticket: MCS-004**

#### 1.2 90% Confidence + GO Protocol (CS-02)
**What:** Update `sdd-scaffold.md` and `sdd-ba.md` with confidence protocol and GO gate.

**Ticket: MCS-005a**

#### 1.3 Toolgate Template + Requirements Lock Example (CS-12)
**What:** Add two new template files:
- `data/integration/toolgate.yaml` — evidence-gated tool configuration with budget placeholders
- `data/integration/requirements.lock.example.yaml` — annotated example lock file

Update `src/cli/commands/init.ts` to copy both files during `ai-sdd init`. This is the only code change in Phase 1.

**Ticket: MCS-005b**

#### 1.4 Planning Artefacts Convention (CS-14)
**What:** Add to `CLAUDE.md`: `plans/<feature-name>/` convention.

**Ticket: MCS-005c** (documentation only)

**Phase 1 tests required:**
- Snapshot test: verify `constitution.md` content matches expected rules
- Init test: verify `ai-sdd init` copies `toolgate.yaml` and `requirements.lock.example.yaml`

**Phase 1 exit criteria:**
1. All 6 agent MD files reference `constitution.md`.
2. `sdd-scaffold.md` contains confidence + GO protocol section.
3. `ai-sdd init` copies new template files non-destructively.

---

### Phase 2 — Schema Extensions + Governance Flag
**Effort: 3–5 days | Risk: Low**

All schema fields optional. Zero breaking changes.

#### 2.1 Types + Zod Schemas in `src/types/index.ts`

**TypeScript interfaces:**

```typescript
export type GovernanceMode = "off" | "warn" | "enforce";
export type LockMode = "greenfield" | "brownfield";

export interface GovernanceConfig {
  requirements_lock?: GovernanceMode;  // default: "warn"
  lock_mode?: LockMode;               // default: "greenfield"
}

export interface RequirementsLockConfig {
  path?: string;  // default: ".ai-sdd/requirements.lock.yaml"
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

export interface ACCoverageReport {
  claimed: number;
  total: number;
  uncovered: string[];  // scenario names not covered
}

export interface GatedHandoverState {
  ac_coverage?: ACCoverageReport;
  new_files_created?: number;
  loc_delta?: number;
  new_public_apis?: number;
  tests_passed?: boolean;
  blockers?: string[];
  raw_output?: string;  // Gate 2 scans this for scope drift
}
```

**Zod schemas** (mandatory — these validate YAML input at runtime):
```typescript
export const AcceptanceCriterionSchema = z.object({
  scenario: z.string(),
  given: z.union([z.string(), z.array(z.string())]),
  when: z.string(),
  then: z.array(z.string()),
  and: z.array(z.string()).optional(),
});

export const TaskBudgetSchema = z.object({
  max_new_files: z.number().int().nonneg().optional(),
  max_loc_delta: z.number().int().nonneg().optional(),
  max_new_public_apis: z.number().int().nonneg().optional(),
});

export const GovernanceModeSchema = z.enum(["off", "warn", "enforce"]);
export const LockModeSchema = z.enum(["greenfield", "brownfield"]);

export const GovernanceConfigSchema = z.object({
  requirements_lock: GovernanceModeSchema.default("warn"),
  lock_mode: LockModeSchema.default("greenfield"),
}).optional();

export const RequirementsLockConfigSchema = z.object({
  path: z.string().default(".ai-sdd/requirements.lock.yaml"),
}).optional();
```

**Additive fields on existing `TaskDefinition`** (all `optional`):
- `acceptance_criteria?: AcceptanceCriterion[]`
- `requirement_ids?: string[]`
- `scope_excluded?: string[]`
- `budget?: TaskBudget`
- `phase?: string`

**Update existing `TaskOverlays` interface** to include:
- `planning_review?: { enabled?: boolean; phases?: string[] }`

**Update `WorkflowState`** to include:
- `requirements_lock?: { spec_hash: string; path: string; locked_at: string }`

**Models:** C2 (55%), G1/G2/G3 (30%), Opus (15% — Zod + raw_output + ACCoverageReport)

**Ticket: MCS-006**

#### 2.2 Config blocks in `ai-sdd.yaml` + defaults

```yaml
governance:
  requirements_lock: warn     # off | warn | enforce
  lock_mode: greenfield       # greenfield | brownfield

requirements_lock:
  path: ".ai-sdd/requirements.lock.yaml"
```

Update `src/config/defaults.ts`:
```typescript
governance: {
  requirements_lock: "warn",
  lock_mode: "greenfield",
},
requirements_lock: {
  path: ".ai-sdd/requirements.lock.yaml",
},
```

**Ticket: MCS-001**

#### 2.3 Spec hash tracking in `src/core/engine.ts`

At `run()` startup, after `stateManager.initializeTasks()`:

```typescript
if (governanceMode !== "off" && config.requirements_lock?.path) {
  const lockFile = resolve(projectPath, config.requirements_lock.path);
  if (existsSync(lockFile)) {
    const hash = createHash("sha256").update(readFileSync(lockFile)).digest("hex");
    const prev = state.requirements_lock?.spec_hash;
    if (!prev) {
      // First run: establish baseline, warn, don't block (OD-8)
      emitter.emit("requirements.lock.baseline_set", { hash, path: lockFile });
    } else if (prev !== hash) {
      // Subsequent run: hash changed — require acknowledgement (OD-8)
      if (!flags.acknowledgeSpecChange) {
        throw new ConfigError(
          "requirements.lock.yaml changed since last run. " +
          "Re-run with --acknowledge-spec-change=<reason> to proceed."
        );
      }
      emitter.emit("requirements.lock.changed", {
        previous_hash: prev,
        current_hash: hash,
        reason: flags.acknowledgeSpecChange,
      });
    }
    await stateManager.patch({
      requirements_lock: { spec_hash: hash, path: lockFile, locked_at: new Date().toISOString() },
    });
  } else if (governanceMode === "enforce") {
    throw new ConfigError(
      `requirements.lock.yaml not found at ${lockFile}; governance mode is 'enforce'`
    );
  } else if (governanceMode === "warn") {
    emitter.emit("requirements.lock.missing", { path: lockFile });
  }
}
```

Also add `--acknowledge-spec-change <reason>` flag to `src/cli/commands/run.ts`.

**Ticket: MCS-009a**

#### 2.4 Gate 2 — Scope Drift in `PolicyGateOverlay.postTask`

```typescript
// Skip all governance gates when mode is "off"
const governanceMode = config.governance?.requirements_lock ?? "warn";
if (governanceMode === "off") {
  return existingResult; // early return — no governance gates run
}

// Gate 2: Scope excluded
const excluded = ctx.task_definition.scope_excluded ?? [];
if (excluded.length > 0) {
  const hs = result.handover_state as GatedHandoverState | undefined;
  const output = hs?.raw_output ?? "";
  if (output.length === 0 && excluded.length > 0) {
    emitter.emit("governance.gate2.no_raw_output", { task_id: ctx.task_id });
    // warn but don't fail — agent may not have populated raw_output
  } else {
    const violations = excluded.filter(term =>
      output.toLowerCase().includes(term.toLowerCase())
    );
    if (violations.length > 0) {
      failures.push(`[Gate 2] Scope drift: excluded terms found: ${violations.join(", ")}`);
    }
  }
}
```

**Ticket: MCS-009b**

#### 2.5 Gate 2b — Budget Check in `PolicyGateOverlay.postTask`

```typescript
// Gate 2b: Budget check
const budget = ctx.task_definition.budget;
if (budget) {
  const hs = result.handover_state as GatedHandoverState | undefined;
  if (hs) {
    checkBudgetField("new_files_created", budget.max_new_files, hs.new_files_created, failures);
    checkBudgetField("loc_delta", budget.max_loc_delta, hs.loc_delta, failures);
    checkBudgetField("new_public_apis", budget.max_new_public_apis, hs.new_public_apis, failures);
  } else {
    emitter.emit("governance.handover_state.untyped", {
      task_id: ctx.task_id,
      reason: "Task has budget fields but agent did not populate GatedHandoverState fields",
    });
    if (governanceMode === "enforce") {
      failures.push("[Gate 2b] Budget declared but agent did not report metrics in handover_state");
    }
  }
}
```

**Ticket: MCS-009c**

**Phase 2 tests required (per CLAUDE.md standards):**
- Config-to-behaviour: change `governance.requirements_lock` from `warn` to `enforce`, assert different engine behaviour
- Config-to-behaviour: change `governance.requirements_lock` to `off`, assert no governance gates fire
- Gate 2: task with `scope_excluded: ["payment"]`, output containing "payment" → gate failure
- Gate 2: task with `scope_excluded`, no `raw_output` in handover → warning event emitted
- Gate 2b: task with `budget.max_new_files: 3`, agent reports `new_files_created: 5` → failure
- Gate 2b: task with `budget`, no metrics in handover_state → warning event (warn mode) or failure (enforce mode)
- Spec hash: first run → baseline set, no block
- Spec hash: second run, hash changed, no `--acknowledge-spec-change` → ConfigError
- Spec hash: second run, hash changed, with `--acknowledge-spec-change` → event emitted, proceeds
- Zod: invalid `acceptance_criteria` YAML → schema validation error at load time
- Integration: workflow with all new fields runs end-to-end without regression on existing test fixtures

**Phase 2 exit criteria:**
1. Existing workflows (no governance fields) pass with zero behaviour change.
2. `governance: warn` emits warning events when lock missing.
3. `governance: enforce` hard-fails when lock missing.
4. `governance: off` skips all governance gates entirely.
5. Budget gate emits `governance.handover_state.untyped` when handover lacks metrics.
6. Spec hash first-run/subsequent-run distinction works correctly.
7. All Zod schemas validate correctly for valid and invalid input.

---

### Phase 3 — Traceability CLI + Planning Review Overlay + MCP
**Effort: 5–8 days | Risk: Medium**

**Internal sequencing (mandatory):**
- 3a (spike) → 3b (CLI) → 3c (MCP)
- 3d (PlanningReviewOverlay) parallelisable with 3b/3c, but depends on Phase 2 `phase` field on `TaskDefinition`
- 3e (AC gate in complete-task) after Phase 2 governance flag

#### 3a — Feasibility Spike (MCS-011)
Evaluate `coding-standards/tools/validators` and `coding-standards/tools/query-engine` for reuse. Produce `specs/merge-coding-standards/tools-spike-decision.md` covering: language, runtime, API stability, dependency footprint, adapter cost. Default: implement natively.

**Effort: 0.5 days | Deliverable: decision note only**

#### 3b — `ai-sdd traceability` CLI (MCS-008)
**File:** `src/cli/commands/traceability.ts` (new)
**Register in:** `src/cli/index.ts` via `registerTraceabilityCommand(program)`

**Subcommands:**
| Command | Reads | Outputs | Exit code |
|---------|-------|---------|-----------|
| `validate-lock` | lock file + workflow-state.json | Hash match/mismatch | 0=match, 1=mismatch |
| `gaps` | lock file + workflow YAML | Unlinked requirements/tasks | 0=clean or warnings-only, 1=critical gaps |
| `coverage` | workflow-state.json handover states | AC coverage per task | 0 always (informational) |
| `report --json` | all above | Combined JSON report | 0=clean, 1=critical gaps |

**`gaps` critical gap definition (OD-5):**
- Critical (exit 1): task has `requirement_ids` with IDs not in lock file, OR lock file has requirement with no linked task
- Warning (exit 0): task without `acceptance_criteria`, task without `requirement_ids`
- In `brownfield` lock mode (OD-11): unlinked tasks are warnings, not critical

**Effort: 2–3 days**

#### 3c — MCP Tool Registration (MCS-010) — after 3b
**File:** extend `src/integration/mcp-server/server.ts`
Add to `TOOLS` array and `CallToolRequestSchema` switch case:
- `validate_requirements_lock` — calls `runCli("traceability", "validate-lock", ...)`
- `check_scope_drift` — calls `runCli("traceability", "gaps", ...)`

Both use existing `runCli()` subprocess exec pattern. No stub registrations — both backed by 3b.

**Effort: 0.5 days**

#### 3d — `PlanningReviewOverlay` (MCS-012) — parallelisable with 3b/3c
**File:** `src/overlays/planning-review/planning-review-overlay.ts` (new)

**Config in `ai-sdd.yaml`:**
```yaml
overlays:
  planning_review:
    enabled: false           # opt-in
    reviewer_agent: reviewer
    phases: [planning, design]
    block_on_needs_work: true
    timeout_seconds: 86400   # 24h default; 0 = no timeout (for T2)
```

**Update `src/config/defaults.ts`:**
```typescript
overlays: {
  // ... existing ...
  planning_review: {
    enabled: false,
    reviewer_agent: "reviewer",
    phases: ["planning", "design"],
    block_on_needs_work: true,
    timeout_seconds: 86400,
  },
},
```

**Update `TaskOverlays` in `src/types/index.ts`** (already prepared in Phase 2.1):
```typescript
planning_review?: {
  enabled?: boolean;
  phases?: string[];
}
```

**Overlay chain update in `src/overlays/composition-rules.ts`:**
```
HIL → PlanningReview → Evidence Gate → Agentic Review → Paired → Confidence → Dispatch
```
The `buildOverlayChain` function must insert PlanningReview after HIL. The `validateOverlayCombination` function must validate that PlanningReview is only present when `overlays.planning_review.enabled: true`.

**`preTask` behaviour:**
1. Skip if task `phase` not in `phases` config (or if `phases` not set → skip all tasks)
2. Build prompt: task definition + ACs + `scope_excluded` + `requirement_ids` + agent description
3. Dispatch to `reviewer_agent` via adapter
4. Apply timeout (`timeout_seconds`); if exceeded → treat as parse failure
5. Parse response for `{"planning_review": "APPROVED" | "NEEDS_WORK", "reason": "..."}` (OD-4)
6. Three response cases:
   - `APPROVED` → `{ proceed: true }`
   - `NEEDS_WORK` → `{ proceed: false }` → task transitions to `NEEDS_REWORK`
   - Parse failure / timeout → emit `planning_review.parse_failure` event; if `block_on_needs_work: true` → treat as `NEEDS_WORK`; if `false` → warn and proceed

**Effort: 2–3 days**

#### 3e — AC Coverage Gate in `complete-task` (MCS-013) — after Phase 2
**File:** `src/cli/commands/complete-task.ts` — add Step 2.5 between sanitize (Step 2) and contract-validate (Step 3):

```typescript
// Step 2.5: AC coverage check (governance != "off")
const governanceMode = config.governance?.requirements_lock ?? "warn";
if (governanceMode !== "off") {
  const declaredACs = loadDeclaredACs(projectPath, taskId);
  if (declaredACs && declaredACs.length > 0) {
    const hs = handoverState as GatedHandoverState;
    const coverage = hs?.ac_coverage;
    if (!coverage) {
      // Agent didn't report ac_coverage at all
      if (governanceMode === "enforce") {
        return transitionToNeedsRework(taskId,
          `AC coverage not reported. Task has ${declaredACs.length} acceptance criteria but handover_state.ac_coverage is missing.`);
      } else {
        emitter.emit("governance.ac_coverage.missing", { task_id: taskId });
      }
    } else if (coverage.uncovered.length > 0) {
      const msg = `AC coverage incomplete: ${coverage.uncovered.join(", ")} (${coverage.claimed}/${coverage.total} covered)`;
      if (governanceMode === "enforce") {
        return transitionToNeedsRework(taskId, msg);
      } else {
        emitter.emit("governance.ac_coverage.incomplete", { task_id: taskId, uncovered: coverage.uncovered });
      }
    }
  }
}
```

**Effort: 1 day**

**Phase 3 tests required:**
- Traceability CLI: `gaps` returns exit 1 on critical gap (unlinked requirement)
- Traceability CLI: `gaps` returns exit 0 on warning-only gap (missing AC)
- Traceability CLI: `gaps` in `brownfield` mode downgrades unlinked tasks to warnings
- Traceability CLI: `report --json` produces valid, parseable JSON
- MCP: `validate_requirements_lock` tool returns real data (not stub)
- PlanningReviewOverlay: `APPROVED` response → task proceeds
- PlanningReviewOverlay: `NEEDS_WORK` response → task transitions to `NEEDS_REWORK`
- PlanningReviewOverlay: parse failure + `block_on_needs_work: true` → treated as `NEEDS_WORK`
- PlanningReviewOverlay: parse failure + `block_on_needs_work: false` → warning, proceeds
- PlanningReviewOverlay: timeout exceeded → treated as parse failure
- PlanningReviewOverlay: task `phase: implementation` with `phases: [planning, design]` → overlay skips
- Complete-task: AC coverage incomplete + governance `enforce` → `NEEDS_REWORK`
- Complete-task: AC coverage incomplete + governance `warn` → event emitted, completes
- Complete-task: governance `off` → AC check skipped entirely
- Composition rules: PlanningReview inserted after HIL, before Evidence Gate
- Integration: full workflow with PlanningReviewOverlay enabled, planning task reviewed, implementation task not reviewed

**Phase 3 exit criteria:**
1. `ai-sdd traceability gaps` exits non-zero on critical gaps; machine-readable JSON on `--json`.
2. MCP tools functional (not stubbed).
3. PlanningReviewOverlay blocks on `NEEDS_WORK` and on parse failure when `block_on_needs_work: true`.
4. Timeout handling works correctly (fail-closed by default).
5. `complete-task` transitions to `NEEDS_REWORK` for uncovered ACs when `governance: enforce`.
6. `composition-rules.ts` correctly orders the updated chain.

---

### Phase 4 — Tooling, CI/CD, and Phase Routing
**Effort: 3–5 days | Risk: Low**

#### 4.1 Adapted Drift Scripts (CS-10)
**Files:**
- `data/integration/scripts/reproducibility-check.sh`
- `data/integration/scripts/semantic-drift-check.sh`

Adaptations:
- Check `.ai-sdd/requirements.lock.yaml` (not bare root path)
- Gate 0: use `ai-sdd traceability validate-lock` (not standalone hash file)
- Gate 2: read `scope_excluded` from workflow YAML tasks
- Replace `./gradlew test` → `bun test`

**Ticket: MCS-002**

#### 4.2 GitHub Actions Template
**File:** `data/integration/.github/workflows/ai-sdd-gates.yml`

Must include init prerequisite guard:
```yaml
- name: Check ai-sdd init was run
  run: |
    test -f .ai-sdd/scripts/reproducibility-check.sh || \
      (echo "ERROR: Run 'ai-sdd init' first." && exit 1)
```

**Ticket: MCS-003**

#### 4.3 Phase-Based Model Routing (CS-08)
**Files:** `src/adapters/factory.ts`, `ai-sdd.yaml` schema, Zod validation

**Precedence:** task `adapter` override > `phase_routing[task.phase]` > `adapter` default

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

**Multi-adapter auth handling (from C1 Decision 6):** Only emit auth warnings for adapters referenced in the active workflow's agent definitions + phase routing entries. Unused adapters are silent.

**Ticket: MCS-015**

#### 4.4 Budget Enforcement Script
**File:** `data/integration/scripts/check-budgets.sh`

Reads `toolgate.yaml` budgets block, uses `git diff --stat` for metrics, exits non-zero on violation. Designed for CI use alongside Phase 2 in-engine budget gates (out-of-process verification to catch agent self-reporting cheating).

**Ticket: MCS-016** (new)

#### 4.5 `regenerate-requirements-lock` Task Template
**File:** `data/task-library/regenerate-requirements-lock.yaml`

Assigned to `agent: architect`, `phase: planning`. Includes AC scenarios for lock completeness, hash update, diff classification (breaking/significant/minor).

**Ticket: MCS-017** (new — was previously untracked)

#### 4.6 Governance Onboarding Docs
**What:** User-facing documentation for governance features. Can be an addition to `constitution.md` or a separate `data/integration/claude-code/GOVERNANCE.md`.

Must cover: governance modes, AC declaration format, budget declaration, traceability CLI usage, lock file format, phase routing setup.

**Ticket: MCS-014**

**Phase 4 tests required:**
- Phase routing: task with `phase: planning` gets `phase_routing.planning` adapter
- Phase routing: task with explicit `adapter` override ignores phase routing
- Phase routing: task with no `phase` gets default adapter
- Auth warnings: adapter referenced in phase routing but missing auth → error at startup
- Auth warnings: adapter in config but not used by any agent/phase → no warning
- Init: `ai-sdd init` copies scripts, CI template, toolgate.yaml, requirements.lock.example.yaml
- Budget script: exceeding max_new_files → non-zero exit

**Phase 4 exit criteria:**
1. `ai-sdd init` copies all new templates non-destructively.
2. CI template fails with human-readable error if init was not run.
3. Phase routing selects correct adapter per `task.phase`.
4. Multi-adapter auth warnings fire only for used adapters.
5. Budget script fails deterministically on violations.
6. Governance documentation is comprehensive and accurate.

---

## Ticket Mapping

| Ticket | Phase | Scope | Effort |
|--------|-------|-------|--------|
| MCS-004 | 1.1 | Agent constitution + handover reporting instructions | 0.5d |
| MCS-005a | 1.2 | GO protocol in scaffold/BA agents | 0.5d |
| MCS-005b | 1.3 | Toolgate template + requirements.lock.example + init.ts update | 0.5d |
| MCS-005c | 1.4 | Planning artefacts convention in CLAUDE.md | 0.5d |
| MCS-006 | 2.1 | Types + Zod schemas (GovernanceMode, AcceptanceCriterion, TaskBudget, GatedHandoverState, ACCoverageReport, TaskOverlays update) | 1.5d |
| MCS-001 | 2.2 | Governance config block in ai-sdd.yaml + defaults.ts | 0.5d |
| MCS-009a | 2.3 | Spec hash tracking in engine.ts + --acknowledge-spec-change flag | 1d |
| MCS-009b | 2.4 | Gate 2 (scope drift) in PolicyGateOverlay.postTask | 0.5d |
| MCS-009c | 2.5 | Gate 2b (budget) in PolicyGateOverlay.postTask | 0.5d |
| MCS-007 | 2 | Optional fields on TaskDefinition + Zod schema for workflow YAML | 1d |
| MCS-011 | 3a | Feasibility spike: coding-standards/tools/* decision | 0.5d |
| MCS-008 | 3b | ai-sdd traceability CLI (validate-lock, gaps, coverage, report) | 2.5d |
| MCS-010 | 3c | MCP tool registration (validate_requirements_lock, check_scope_drift) | 0.5d |
| MCS-012 | 3d | PlanningReviewOverlay + composition-rules.ts update + timeout | 2.5d |
| MCS-013 | 3e | AC coverage gate in complete-task Step 2.5 | 1d |
| MCS-002 | 4.1 | Drift scripts (reproducibility-check.sh, semantic-drift-check.sh) | 1d |
| MCS-003 | 4.2 | GitHub Actions template with init prerequisite guard | 0.5d |
| MCS-015 | 4.3 | Phase-based model routing + multi-adapter auth warnings | 1.5d |
| MCS-016 | 4.4 | check-budgets.sh (out-of-process budget verification) | 0.5d |
| MCS-017 | 4.5 | regenerate-requirements-lock task template | 0.5d |
| MCS-014 | 4.6 | Governance onboarding documentation | 1d |

**Total: 21 tickets, ~19 developer-days**

**Dependency graph:**
```
Phase 1: MCS-004 → MCS-005a → MCS-005b → MCS-005c
                                  ↓
Phase 2: MCS-006 → MCS-001 → MCS-007 → MCS-009a → MCS-009b → MCS-009c
                                                        ↓
Phase 3: MCS-011 → MCS-008 → MCS-010                   ↓
                                        MCS-012 ←── (needs MCS-007 for `phase` field)
                                                 MCS-013
Phase 4: MCS-002, MCS-003, MCS-015, MCS-016, MCS-017, MCS-014 (all parallelisable)
```

---

## Feature-to-File Map

| Feature | Source (coding-standards) | Target (ai-sdd) |
|---------|--------------------------|-----------------|
| Agent constitution | `agents/constitution.md` | `data/integration/claude-code/agents/constitution.md` (new) |
| GO protocol | `CLAUDE.md §Confidence Protocol` | `sdd-scaffold.md` + `sdd-ba.md` |
| Toolgate template | `toolgate.yaml` | `data/integration/toolgate.yaml` (new) |
| Requirements lock example | `rules/example.requirements.lock.yaml` | `data/integration/requirements.lock.example.yaml` (new) |
| GovernanceMode + LockMode types | — | `src/types/index.ts` |
| GovernanceConfig Zod schema | — | `src/types/index.ts` |
| AcceptanceCriterion type + Zod | `rules/acceptance-criteria-format.md` | `src/types/index.ts` |
| GatedHandoverState + ACCoverageReport | — | `src/types/index.ts` |
| TaskBudget type + Zod | `toolgate.yaml budgets` | `src/types/index.ts` |
| TaskOverlays update (planning_review) | — | `src/types/index.ts` |
| Governance config | — | `ai-sdd.yaml` schema + `src/config/defaults.ts` |
| RequirementsLockConfig | — | `ai-sdd.yaml` schema + `src/config/defaults.ts` |
| Spec hash tracking | `scripts/spec-hash.sh` | `src/core/engine.ts run()` startup |
| `--acknowledge-spec-change` flag | — | `src/cli/commands/run.ts` |
| Gate 2 scope drift | `semantic-drift-check.sh Gate 2` | `src/overlays/policy-gate/gate-overlay.ts` |
| Gate 2b budget | `toolgate.yaml budgets` | `src/overlays/policy-gate/gate-overlay.ts` |
| Traceability CLI | `tools/query-engine` (reference only) | `src/cli/commands/traceability.ts` (new, native) |
| MCP tools | — | `src/integration/mcp-server/server.ts` (extended) |
| PlanningReviewOverlay | `agents/planning-reviewer.md` | `src/overlays/planning-review/planning-review-overlay.ts` (new) |
| Overlay chain update | — | `src/overlays/composition-rules.ts` |
| Phase-based routing | `agents/model-routing.yaml` | `src/adapters/factory.ts` + `ai-sdd.yaml` |
| AC coverage gate | `rules/pull-request-checklist.md` | `src/cli/commands/complete-task.ts` Step 2.5 |
| Drift scripts | `scripts/reproducibility-check.sh`, `semantic-drift-check.sh` | `data/integration/scripts/` (adapted, new) |
| CI template | `.github/workflows/framework-gates-sample.yml` | `data/integration/.github/workflows/ai-sdd-gates.yml` (new) |
| Budget check script | — | `data/integration/scripts/check-budgets.sh` (new) |
| Lock regen task | `agents/requirements-lock/` | `data/task-library/regenerate-requirements-lock.yaml` (new) |
| Init command updates | — | `src/cli/commands/init.ts` (modified) |

---

## What Is Explicitly NOT Implemented

| Feature | Reason |
|---------|--------|
| `REQUIREMENTS_VALIDATED` task state | Hard reject — breaks VALID_TRANSITIONS. 6/6. |
| `coding-standards/tools/*` cross-repo runtime dependency | Gate behind MCS-011 spike; default native. |
| Phase 0 MCP stubs before CLI | Dead surface area risk. 5/6 against. |
| ML/drift prediction (deepseek Phase 5) | Defer — needs governance baseline first. |
| Multi-candidate evaluation engine | Changes agent execution model; out of scope. |
| Full MCP server unification | Separate project; existing server functional. |
| `workflow/state-machine.yaml` from coding-standards | Superseded by TypeScript VALID_TRANSITIONS. |
| `scripts/dryrun.sh`, `run-phase.sh` | Superseded by `--dry-run` and `--task` flags. |
| Java/Kotlin standards | Not applicable — ai-sdd is TypeScript. |
| Cross-project/org-scale validation | Out of scope for first merge cycle. |

---

## Success Metrics

### Technical
1. PR gate outcomes deterministic for same input (0 flaky gate runs).
2. >80% scope-drift issues caught by Gate 2 before merge (baseline: first 4 sprints post Phase 2).
3. Critical traceability gap count trends downward release-over-release.
4. Mean time to diagnose failed workflow run reduced via schema-validated state artefacts.

### Adoption
1. % projects using `requirements.lock.yaml` with `governance: enforce`.
2. % workflows with at least one task with `acceptance_criteria` declared.
3. Releases passing `ai-sdd traceability report` with zero critical gaps.

### Rework Impact
4. `NEEDS_REWORK` rate for PlanningReviewOverlay-enabled workflows vs pre-adoption baseline. Target: **≥15% reduction within 60 days of Phase 3**. If not met: revise reviewer agent prompt.

---

## Risks and Controls

| Risk | Control |
|------|---------|
| Silent governance failures from untyped handover | `GatedHandoverState` interface + warning events; `enforce` mode fails on missing data |
| MCP tools non-functional at registration | Hard sequencing: 3c after 3b |
| Cross-repo dependency lock-in | MCS-011 spike with go/no-go note |
| Reviewer fatigue from unconstrained PlanningReview | `phases` filter + disabled by default |
| CI template fails on uninitialised projects | Explicit init guard step |
| Operator friction from over-enforcement | Default `warn`; `enforce` is opt-in |
| Budget gate self-reporting (agent cheating) | `check-budgets.sh` out-of-process verification |
| Planning review stuck/slow | Timeout (default 24h) + fail-closed + `--waive-planning-review` escape |
| Spec hash change blocking workflow without context | `--acknowledge-spec-change=<reason>` flag with audit logging |
| Phase routing referencing unconfigured adapters | Auth warnings only for used adapters (Decision 6) |
| Brownfield projects overwhelmed by strict traceability | `lock_mode: brownfield` downgrades gap severity |
