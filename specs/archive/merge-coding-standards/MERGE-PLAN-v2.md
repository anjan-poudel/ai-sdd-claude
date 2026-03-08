# Coding Standards → ai-sdd Merge Plan v2

**Date:** 2026-03-07
**Branch:** feature/merge-coding-standards
**Status:** READY FOR TASK BREAKDOWN
**Revision:** v2 — incorporates hybrid architecture split, CANCELLED state, guard-as-overlay-config

---

## Architecture Decision: Enforcement Native, Analysis External

This plan splits the merge across two projects:

```
┌─────────────────────────────────────────────────────────┐
│  ai-sdd (native — enforcement + orchestration)          │
│                                                         │
│  Engine:    spec hash tracking, governance config        │
│  Gates:     Gate 2 (scope drift), Gate 2b (budget)      │
│  Overlay:   PlanningReviewOverlay (pre-task)             │
│  Txn:       AC coverage check in complete-task           │
│  State:     CANCELLED state + cancel CLI                 │
│  Types:     AcceptanceCriterion, TaskBudget, etc.        │
│  Prompts:   constitution, GO protocol                    │
│  CLI:       thin traceability (hash, gap cross-ref,      │
│             coverage from engine state)                  │
│                                                         │
│  Principle: if it BLOCKS a task or TRANSITIONS state,   │
│             it lives here.                               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  coding-standards MCP server (analysis + queries)        │
│                                                         │
│  validate_lock:     structural lint (10 rules)           │
│  find_gaps:         deep graph gap analysis              │
│  impact_analysis:   "what breaks if X changes?"          │
│  coverage_report:   full REQ→TASK→TEST chains            │
│  dependency_chain:  task ordering analysis                │
│  + existing graph_* tools                                │
│                                                         │
│  Principle: if it READS and REPORTS without blocking,   │
│             it lives here. Called by agents, CI, devs.   │
└─────────────────────────────────────────────────────────┘
```

**Why this split:**
- ai-sdd is the framework — governance enforcement is core, not optional tooling
- coding-standards already has a working MCP server + validators + query-engine
- Deep graph analysis (impact chains, orphan detection, structural lint) is read-only — it doesn't need engine internals
- Agents can call coding-standards MCP tools during task execution for self-checking (Claude Code already supports multiple MCP servers)
- CI pipelines call coding-standards CLI tools directly
- ai-sdd stays focused and testable; coding-standards stays useful independently

**What this eliminates from ai-sdd scope (vs MERGE-PLAN-OPUS.md):**
- ~~MCS-011 (feasibility spike)~~ → resolved: coding-standards tools stay in coding-standards
- ~~MCS-010 (MCP registration in ai-sdd)~~ → removed: coding-standards runs its own MCP server
- Phase 3b simplified: thin traceability CLI (engine state cross-ref only), no deep graph queries
- Phase 4.1 simplified: CI template calls coding-standards tools directly, no adapted drift scripts in ai-sdd
- ~~MCS-016 (check-budgets.sh)~~ → removed: CI calls coding-standards validators directly

---

## Quorum Summary

Six model reviews synthesised. Decisions annotated with model(s) and weight.

| Shorthand | Full identity |
|-----------|--------------|
| C1 | Claude Sonnet 4.6 (synthesis-review-claude.md — first pass) |
| C2 | Claude Sonnet 4.6 (synthesis-review-claude-2.md — second pass) |
| CX | Codex / GPT-4o (synthesis-review-codex.md) |
| G1 | Gemini (synthesis-review-gemini.md) |
| G2 | Gemini — critical (critical_synthesis_review.md) |
| G3 | Gemini — final (final_synthesis_review.md) |
| OP | Claude Opus 4.6 (this review) |

---

## Resolved Principles

| # | Principle | Agreement |
|---|-----------|-----------|
| P1 | Governance enforcement is native to ai-sdd; analysis/queries are external via coding-standards MCP | OP (architecture decision) |
| P2 | `VALID_TRANSITIONS` state machine extended ONLY for `CANCELLED` state — no other new states | 6/6 original + OP |
| P3 | All new `TaskDefinition` fields are `optional`; zero breaking changes to existing workflows | 6/6 (all) |
| P4 | Governance features default to `warn`; `enforce` is opt-in | C1, C2, CX, G1 — 4/6 |
| P5 | `PlanningReviewOverlay` is opt-in (`enabled: false` default) | 6/6 (all) |
| P6 | Agent constitution and GO protocol belong in agent `.md` prompt templates | 6/6 (all) |
| P7 | Scripts and CI templates distributed via `ai-sdd init` | 6/6 (all) |
| P8 | `GatedHandoverState` typed interface required before gates that read from `handover_state` | C2, C1, G1 |
| P9 | Every new config field and gate must have a behaviour test (CLAUDE.md standards) | Project rules |
| P10 | coding-standards state machine concepts expressed through overlay config + phase field, not new TaskStatus values | OP (state machine analysis) |

---

## Resolved Open Decisions

### OD-1 through OD-6
Unchanged from MERGE-PLAN-OPUS.md (spec_hash location, default governance mode, PlanningReviewOverlay phase scope, review response format, traceability exit codes, lock ownership chain).

### OD-7: Cross-repo tools integration (REVISED)
**Decision:** coding-standards tools (validators, query-engine, MCP server) stay in coding-standards and are enhanced as an MCP server. ai-sdd does NOT take a runtime dependency. Agents and CI call coding-standards tools externally. No feasibility spike needed — the architecture is settled.
**Models:** OP (architecture decision — 100%)

### OD-8 through OD-11
Unchanged from MERGE-PLAN-OPUS.md (first-run spec hash, planning review timeout, governance off semantics, lock_mode greenfield/brownfield).

### OD-12: CANCELLED state (NEW)
**Decision:** Add `CANCELLED` as a terminal state reachable from all non-terminal states. Add `ai-sdd cancel --task <id> --reason <reason>` CLI command. Reason is mandatory and recorded in state + audit event.
**Models:** OP (from coding-standards state-machine.yaml analysis — 100%)

### OD-13: Guard conditions from coding-standards state machine (NEW)
**Decision:** Express as overlay configuration, not state machine additions. The coding-standards state machine has declarative guards (`check_passed:traceability`, `review_author_role:planning-reviewer`). These map to existing ai-sdd mechanisms: overlay phase filters, overlay config predicates, task `depends_on`. No new guard DSL is added — the existing overlay chain + phase field + DAG dependencies already provide equivalent control flow.
**Models:** OP (state machine analysis — 100%)

---

## Architecture Constraints

All new features must use existing ai-sdd primitives:

- **New gates** → sub-checks inside `PolicyGateOverlay.postTask`
- **New pre-task review** → `PlanningReviewOverlay` slotted via `composition-rules.ts`
- **New CLI commands** → `src/cli/commands/` + register in `src/cli/index.ts`
- **New types** → `src/types/index.ts` (optional fields only) + **Zod schemas**
- **New config** → `ai-sdd.yaml` schema with Zod validation + default in `src/config/defaults.ts`
- **State machine changes** → ONLY `CANCELLED` addition; no other new states
- **Analysis/query tools** → stay in coding-standards MCP server; ai-sdd does NOT reimplement them

---

## Phased Implementation Plan

### Phase 1 — Zero-Code Foundations + Init Templates
**Effort: 1–2 days | Risk: None**

Primarily documentation and prompt templates. One small code change: `init.ts` updated to copy new templates.

#### 1.1 Agent Constitution (CS-09)
**What:** Create `data/integration/claude-code/agents/constitution.md`. Add reference line to each of the 6 agent MD files.

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
10. Use coding-standards MCP tools (`validate_lock`, `find_gaps`, `impact_analysis`) for self-checking when available.

**Models:** C2 (60%), G1 (40%)
**Ticket: MCS-004**

#### 1.2 90% Confidence + GO Protocol (CS-02)
**What:** Update `sdd-scaffold.md` and `sdd-ba.md` with confidence protocol and GO gate.
**Ticket: MCS-005a**

#### 1.3 Toolgate Template + Requirements Lock Example (CS-12)
**What:** Add `data/integration/toolgate.yaml` and `data/integration/requirements.lock.example.yaml`. Update `src/cli/commands/init.ts` to copy both.
**Ticket: MCS-005b**

#### 1.4 Planning Artefacts Convention (CS-14)
**What:** Add `plans/<feature-name>/` convention to `CLAUDE.md`.
**Ticket: MCS-005c**

**Phase 1 tests:**
- Snapshot: `constitution.md` content matches expected rules
- Init: `ai-sdd init` copies `toolgate.yaml` and `requirements.lock.example.yaml`

**Exit criteria:**
1. All 6 agent MD files reference `constitution.md`.
2. `sdd-scaffold.md` contains confidence + GO protocol section.
3. `ai-sdd init` copies new template files non-destructively.

---

### Phase 2 — Schema Extensions + Governance Flag + CANCELLED State
**Effort: 4–6 days | Risk: Low**

All schema fields optional. CANCELLED is the sole state machine change — backward compatible.

#### 2.1 CANCELLED State + Cancel CLI (NEW)
**Files:** `src/types/index.ts`, `src/core/state-manager.ts`, `src/cli/commands/cancel.ts` (new)

**State machine update:**
```typescript
export type TaskStatus =
  | "PENDING" | "RUNNING" | "COMPLETED" | "NEEDS_REWORK"
  | "HIL_PENDING" | "FAILED" | "CANCELLED";

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED", "CANCELLED"],
  COMPLETED: [],
  NEEDS_REWORK: ["RUNNING", "FAILED", "CANCELLED"],
  HIL_PENDING: ["RUNNING", "FAILED", "CANCELLED"],
  FAILED: [],
  CANCELLED: [],  // terminal
};
```

**CLI:**
```
ai-sdd cancel --task <id> --reason <reason>
ai-sdd cancel --all --reason <reason>       # cancel all non-terminal tasks
```

Reason is mandatory. Emits `task.cancelled` event with `{ task_id, reason, cancelled_at }`. Updates `workflow-state.json`.

**Why:** ai-sdd currently has no way to cancel a running or pending task. The coding-standards state machine identified this as operationally necessary (CANCELLED reachable from all non-terminal states). This is the one genuinely missing capability — every other coding-standards state maps to existing ai-sdd overlay/phase/DAG mechanisms.

**Ticket: MCS-018** (new)

#### 2.2 Types + Zod Schemas
**File:** `src/types/index.ts`

```typescript
export type GovernanceMode = "off" | "warn" | "enforce";
export type LockMode = "greenfield" | "brownfield";

export interface GovernanceConfig {
  requirements_lock?: GovernanceMode;
  lock_mode?: LockMode;
}

export interface RequirementsLockConfig {
  path?: string;
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
  uncovered: string[];
}

export interface GatedHandoverState {
  ac_coverage?: ACCoverageReport;
  new_files_created?: number;
  loc_delta?: number;
  new_public_apis?: number;
  tests_passed?: boolean;
  blockers?: string[];
  raw_output?: string;
}
```

Zod schemas for all of the above (validates YAML at load time).

Additive fields on `TaskDefinition` (all `optional`):
- `acceptance_criteria?: AcceptanceCriterion[]`
- `requirement_ids?: string[]`
- `scope_excluded?: string[]`
- `budget?: TaskBudget`
- `phase?: string`

Update `TaskOverlays`:
- `planning_review?: { enabled?: boolean; phases?: string[] }`

Update `WorkflowState`:
- `requirements_lock?: { spec_hash: string; path: string; locked_at: string }`

**Ticket: MCS-006**

#### 2.3 Config blocks in `ai-sdd.yaml` + defaults

```yaml
governance:
  requirements_lock: warn
  lock_mode: greenfield

requirements_lock:
  path: ".ai-sdd/requirements.lock.yaml"
```

**Ticket: MCS-001**

#### 2.4 Optional fields on TaskDefinition + Zod schema for workflow YAML
**Ticket: MCS-007**

#### 2.5 Spec hash tracking in `src/core/engine.ts`
At `run()` startup: check governance mode → read lock file → SHA256 → compare to stored hash → first-run baseline (OD-8) or require `--acknowledge-spec-change` on change.

Add `--acknowledge-spec-change <reason>` flag to `src/cli/commands/run.ts`.

**Ticket: MCS-009a**

#### 2.6 Gate 2 — Scope Drift in `PolicyGateOverlay.postTask`
Skip when governance `off`. Scan `GatedHandoverState.raw_output` for excluded terms. Emit warning if `raw_output` absent.

**Ticket: MCS-009b**

#### 2.7 Gate 2b — Budget Check in `PolicyGateOverlay.postTask`
Check `GatedHandoverState` budget fields. Emit `governance.handover_state.untyped` warning if agent didn't report. In `enforce` mode: fail if unreported.

**Ticket: MCS-009c**

**Phase 2 tests required:**
- CANCELLED: transition from PENDING → CANCELLED succeeds
- CANCELLED: transition from RUNNING → CANCELLED succeeds
- CANCELLED: transition from COMPLETED → CANCELLED fails (terminal)
- CANCELLED: `ai-sdd cancel --task T1 --reason "descoped"` updates state + emits event
- CANCELLED: cancel without `--reason` fails (reason mandatory)
- Config-to-behaviour: `governance: warn` vs `enforce` vs `off` → different engine behaviour
- Gate 2: `scope_excluded: ["payment"]` + output containing "payment" → failure
- Gate 2: `scope_excluded` present, no `raw_output` → warning event
- Gate 2b: budget exceeded → failure; budget not reported → warning (warn) or failure (enforce)
- Spec hash: first run → baseline; subsequent changed → requires `--acknowledge-spec-change`
- Zod: invalid `acceptance_criteria` YAML → schema error at load time
- Integration: existing workflows unchanged

**Exit criteria:**
1. CANCELLED state works from all non-terminal states; reason is mandatory.
2. Existing workflows (no governance fields) pass with zero behaviour change.
3. `governance: off` skips all governance gates.
4. `governance: enforce` hard-fails on missing lock file.
5. Budget gate emits warning on missing handover metrics.
6. Spec hash first-run/subsequent-run distinction works.
7. All Zod schemas validate correctly.

---

### Phase 3 — Traceability CLI + Planning Review Overlay
**Effort: 4–6 days | Risk: Medium**

**Internal sequencing:**
- 3a (thin traceability CLI) can start immediately
- 3b (PlanningReviewOverlay) parallelisable with 3a, depends on Phase 2 `phase` field
- 3c (AC gate in complete-task) after Phase 2 governance flag

Note: deep graph analysis (impact chains, orphan detection, structural validation) is NOT built here — that stays in coding-standards MCP server (see Phase 5).

#### 3a — Thin `ai-sdd traceability` CLI (MCS-008)
**File:** `src/cli/commands/traceability.ts` (new)

This is a **thin** command that cross-references engine state against the lock file. It does NOT do deep graph analysis — that's coding-standards MCP server territory.

**Subcommands:**
| Command | What it does | Data source | Exit code |
|---------|-------------|-------------|-----------|
| `validate-lock` | Compare lock file hash to stored spec_hash | lock file + workflow-state.json | 0=match, 1=mismatch |
| `gaps` | Cross-ref task `requirement_ids` against lock file entries | workflow YAML + lock file | 0=clean/warnings, 1=critical |
| `coverage` | Report AC coverage per task from handover_state | workflow-state.json | 0 always |
| `report --json` | Combined JSON output of above | all above | 0=clean, 1=critical |

**`gaps` critical gap definition (OD-5):**
- Critical (exit 1): task `requirement_ids` reference IDs not in lock file, OR lock entry has no linked task
- Warning (exit 0): task without `acceptance_criteria` or `requirement_ids`
- `brownfield` lock mode (OD-11): unlinked tasks downgraded to warnings

**What this does NOT do** (stays in coding-standards MCP):
- Structural validation of lock file (orphan nodes, unjustified contracts)
- Full REQ→TASK→TEST graph traversal
- Impact analysis ("what breaks if REQ-003 changes?")
- Dependency chain analysis

**Effort: 1.5 days**
**Ticket: MCS-008**

#### 3b — `PlanningReviewOverlay` (MCS-012) — parallelisable with 3a
**File:** `src/overlays/planning-review/planning-review-overlay.ts` (new)

**Config:**
```yaml
overlays:
  planning_review:
    enabled: false
    reviewer_agent: reviewer
    phases: [planning, design]
    block_on_needs_work: true
    timeout_seconds: 86400
```

**Overlay chain update in `composition-rules.ts`:**
```
HIL → PlanningReview → Evidence Gate → Agentic Review → Paired → Confidence → Dispatch
```

**`preTask` behaviour:**
1. Skip if task `phase` not in `phases` config
2. Build prompt: task definition + ACs + `scope_excluded` + `requirement_ids`
3. Dispatch to `reviewer_agent` via adapter
4. Timeout (`timeout_seconds`); exceeded → parse failure
5. Parse `{"planning_review": "APPROVED" | "NEEDS_WORK", "reason": "..."}`
6. Three cases:
   - `APPROVED` → proceed
   - `NEEDS_WORK` → `NEEDS_REWORK`
   - Parse failure / timeout → emit event; if `block_on_needs_work: true` → `NEEDS_REWORK`; else warn + proceed

**Guard-as-overlay-config (from coding-standards state machine analysis):**

The coding-standards state machine uses declarative guards (`check_passed:traceability`, `review_author_role:planning-reviewer`). Rather than adding a new guard DSL to ai-sdd, these map to existing mechanisms:

| coding-standards guard | ai-sdd equivalent |
|---|---|
| `review_author_role:planning-reviewer` | PlanningReviewOverlay `reviewer_agent: reviewer` config |
| `review_state:APPROVED` | PlanningReviewOverlay parse: `APPROVED` → proceed |
| `check_passed:traceability` | `depends_on` in DAG — traceability task must complete before implementation |
| `check_passed:lock_mode` | Engine spec hash preflight (Phase 2.5) |
| `all_required_checks_passed` | PolicyGateOverlay `postTask` — all sub-gates pass |
| `comment_contains_exact:GO` | HIL overlay with T2 risk tier (existing) |
| `reason_present` | `--reason` flag on `ai-sdd cancel` (Phase 2.1) |

No new guard syntax needed. The overlay chain + `phase` field + DAG dependencies + config predicates already express all guard semantics from the coding-standards state machine.

**Effort: 2.5 days**
**Ticket: MCS-012**

#### 3c — AC Coverage Gate in `complete-task` (MCS-013)
**File:** `src/cli/commands/complete-task.ts` — Step 2.5

Check `GatedHandoverState.ac_coverage` against declared ACs. `enforce` → `NEEDS_REWORK`, `warn` → event, `off` → skip.

**Effort: 1 day**
**Ticket: MCS-013**

**Phase 3 tests required:**
- Traceability: `gaps` exit 1 on critical gap; exit 0 on warning
- Traceability: `brownfield` mode downgrades unlinked tasks to warnings
- Traceability: `report --json` produces valid JSON
- PlanningReview: `APPROVED` → proceed
- PlanningReview: `NEEDS_WORK` → `NEEDS_REWORK`
- PlanningReview: parse failure + `block_on_needs_work: true` → `NEEDS_REWORK`
- PlanningReview: parse failure + `block_on_needs_work: false` → warn + proceed
- PlanningReview: timeout → treated as parse failure
- PlanningReview: task `phase: implementation` with `phases: [planning, design]` → skip
- Complete-task: AC incomplete + `enforce` → `NEEDS_REWORK`
- Complete-task: AC incomplete + `warn` → event emitted
- Complete-task: `off` → skip
- Composition rules: PlanningReview after HIL, before Evidence Gate
- Integration: planning task reviewed, implementation task not reviewed

**Exit criteria:**
1. `ai-sdd traceability gaps` exits non-zero on critical gaps; `--json` works.
2. PlanningReviewOverlay blocks on `NEEDS_WORK` and parse failure (when configured).
3. Timeout fail-closed works.
4. `complete-task` `NEEDS_REWORK` on uncovered ACs in `enforce` mode.
5. `composition-rules.ts` correctly orders updated chain.

---

### Phase 4 — Phase Routing, CI Template, Task Library
**Effort: 2–3 days | Risk: Low**

#### 4.1 Phase-Based Model Routing (CS-08)
**Files:** `src/adapters/factory.ts`, `ai-sdd.yaml` schema

Precedence: task `adapter` override > `phase_routing[task.phase]` > `adapter` default

```yaml
adapter:
  type: claude_code
  phase_routing:
    planning:       { type: openai, model: gpt-4o }
    planning_review: { type: claude_code, model: claude-opus-4-6 }
    implementation: { type: claude_code, model: claude-sonnet-4-6 }
    review:         { type: openai, model: gpt-4o }
```

Multi-adapter auth: only emit warnings for adapters referenced in active workflow + phase routing.

**Ticket: MCS-015**

#### 4.2 GitHub Actions Template
**File:** `data/integration/.github/workflows/ai-sdd-gates.yml`

Template calls both ai-sdd and coding-standards tools:

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
      # ai-sdd native checks
      - run: bun run src/cli/index.ts traceability report --json > gap-report.json
      # coding-standards external checks (if installed)
      - name: Structural lock validation
        run: |
          if command -v validate-lock &>/dev/null; then
            validate-lock .ai-sdd/requirements.lock.yaml --rules=all
          else
            echo "SKIP: coding-standards validators not installed"
          fi
      - uses: actions/upload-artifact@v4
        with: { name: gap-report, path: gap-report.json }
```

Init prerequisite guard included.

**Ticket: MCS-003**

#### 4.3 `regenerate-requirements-lock` Task Template
**File:** `data/task-library/regenerate-requirements-lock.yaml`

`agent: architect`, `phase: planning`. AC scenarios for lock completeness, hash update, diff classification.

**Ticket: MCS-017**

#### 4.4 Governance Onboarding Docs
**What:** Document governance features, lock file format, how agents call coding-standards MCP tools, CI pipeline setup with both ai-sdd and coding-standards.

**Ticket: MCS-014**

**Phase 4 tests:**
- Phase routing: correct adapter per task phase
- Phase routing: task override > phase routing > default
- Auth warnings only for used adapters
- Init copies CI template

**Exit criteria:**
1. Phase routing selects correct adapter per `task.phase`.
2. CI template runs and calls both ai-sdd traceability and (optionally) coding-standards validators.
3. Governance docs are comprehensive.

---

### Phase 5 — coding-standards MCP Server Enhancement
**Effort: 3–4 days | Risk: Low | Tracked here, executed in coding-standards repo**

The existing coding-standards MCP server has low-level graph operations (`graph_init`, `graph_add_node`, `graph_add_edge`, `graph_validate`, `graph_query`, `graph_export`). It needs high-level operations wrapping the existing validators and query-engine CLIs.

#### 5.1 High-Level MCP Tools
**File:** `coding-standards/tools/mcp-server/src/index.ts` (enhanced)

New tools wrapping existing CLIs:

| MCP Tool | Wraps | Purpose |
|----------|-------|---------|
| `validate_lock` | `@coding-standards/validators validate-lock <file> --rules=all` | Structural lint of lock file (10 rules, 4 categories) |
| `find_gaps` | `@coding-standards/query-engine query-lock gaps <file>` | Deep graph gap analysis (orphans, unlinked nodes) |
| `impact_analysis` | `@coding-standards/query-engine query-lock impact <req-id> <file>` | "What breaks if this requirement changes?" |
| `coverage_report` | `@coding-standards/query-engine query-lock coverage <req-id> <file>` | Full REQ→TASK→TEST chain for a requirement |
| `dependency_chain` | `@coding-standards/query-engine query-lock chain <task-id> <file>` | Task dependency ordering |
| `check_drift` | `coding-standards/scripts/semantic-drift-check.sh` | Semantic drift detection across regenerations |

All tools accept `lock_file_path` parameter (default: `.ai-sdd/requirements.lock.yaml`).

**Ticket: MCS-CS-001** (coding-standards scope)

#### 5.2 MCP Server Configuration for ai-sdd Projects
**File:** `data/integration/claude-code/.mcp.json` (new, copied by `ai-sdd init`)

```json
{
  "mcpServers": {
    "coding-standards": {
      "command": "npx",
      "args": ["@coding-standards/mcp-server"],
      "env": {}
    }
  }
}
```

This configures Claude Code to connect to the coding-standards MCP server during task execution. Agents can then call `validate_lock`, `find_gaps`, etc. without ai-sdd engine changes.

**Ticket: MCS-CS-002** (coding-standards scope)

#### 5.3 Agent Prompt Updates for MCP Tool Usage
**Files:** `data/integration/claude-code/agents/sdd-reviewer.md`, `sdd-dev.md`

Add guidance for when to call coding-standards MCP tools:
- Reviewer: call `validate_lock` and `find_gaps` before approving
- Dev: call `coverage_report` to verify AC implementation completeness
- Architect: call `impact_analysis` when evaluating scope changes

**Ticket: MCS-CS-003** (coding-standards scope, but agent files live in ai-sdd)

**Phase 5 tests (in coding-standards repo):**
- Each new MCP tool returns structured output matching existing CLI
- `validate_lock` catches structural violations (from existing test fixtures)
- `find_gaps` reports orphan nodes correctly
- `impact_analysis` returns correct transitive dependencies
- MCP server starts on stdio and responds to all 6 new tools + 6 existing tools

**Exit criteria:**
1. coding-standards MCP server exposes all 6 new high-level tools.
2. All tools return structured JSON matching existing CLI output.
3. MCP server configuration works with Claude Code in ai-sdd projects.
4. Agent prompts guide tool usage.

---

## State Machine Analysis: coding-standards → ai-sdd Mapping

The coding-standards `state-machine.yaml` defines 15 workflow-level states. All but one map to existing ai-sdd mechanisms. Only `CANCELLED` is genuinely new.

| coding-standards state | ai-sdd equivalent | Mechanism |
|---|---|---|
| INIT | Task `PENDING` | Task state |
| PLANNING_IN_PROGRESS | Task `RUNNING` with `phase: planning` | Phase field |
| PLANNING_REVIEW_PENDING | PlanningReviewOverlay `preTask` executing | Overlay (Phase 3b) |
| PLANNING_CHANGES_REQUESTED | Task `NEEDS_REWORK` from PlanningReviewOverlay | State transition |
| PLANNING_APPROVED | PlanningReviewOverlay returns `APPROVED` | Overlay result |
| LOCK_READY | Engine spec hash check passes | Engine preflight (Phase 2.5) |
| IMPLEMENTATION_READY | Planning tasks `COMPLETED` in DAG | Topological sort |
| IMPLEMENTATION_IN_PROGRESS | Task `RUNNING` with `phase: implementation` | Phase field |
| PAIR_REVIEW_PENDING | Paired Workflow overlay | Existing overlay |
| CODE_REVIEW_PENDING | Agentic Review overlay | Existing overlay |
| CHANGES_REQUESTED | Task `NEEDS_REWORK` | State transition |
| WAITING_FOR_SLACK_REPLY | Task `HIL_PENDING` | Existing state |
| GATES_PENDING | PolicyGateOverlay `postTask` | Existing overlay |
| READY_FOR_GO | HIL overlay with `risk_tier: T2` | Existing overlay |
| COMPLETED | Task `COMPLETED` | Task state |
| **CANCELLED** | **NEW: Task `CANCELLED`** | **Phase 2.1** |

---

## Ticket Mapping

### ai-sdd Tickets

| Ticket | Phase | Scope | Effort |
|--------|-------|-------|--------|
| MCS-004 | 1.1 | Agent constitution + handover reporting instructions | 0.5d |
| MCS-005a | 1.2 | GO protocol in scaffold/BA agents | 0.5d |
| MCS-005b | 1.3 | Toolgate template + requirements.lock.example + init.ts update | 0.5d |
| MCS-005c | 1.4 | Planning artefacts convention in CLAUDE.md | 0.25d |
| MCS-018 | 2.1 | CANCELLED state + cancel CLI command | 1d |
| MCS-006 | 2.2 | Types + Zod schemas (all governance types) | 1.5d |
| MCS-001 | 2.3 | Governance config block in ai-sdd.yaml + defaults.ts | 0.5d |
| MCS-007 | 2.4 | Optional fields on TaskDefinition + Zod for workflow YAML | 1d |
| MCS-009a | 2.5 | Spec hash tracking in engine.ts + --acknowledge-spec-change | 1d |
| MCS-009b | 2.6 | Gate 2 (scope drift) in PolicyGateOverlay | 0.5d |
| MCS-009c | 2.7 | Gate 2b (budget) in PolicyGateOverlay | 0.5d |
| MCS-008 | 3a | Thin traceability CLI (validate-lock, gaps, coverage, report) | 1.5d |
| MCS-012 | 3b | PlanningReviewOverlay + composition-rules.ts + timeout | 2.5d |
| MCS-013 | 3c | AC coverage gate in complete-task Step 2.5 | 1d |
| MCS-015 | 4.1 | Phase-based model routing + multi-adapter auth | 1.5d |
| MCS-003 | 4.2 | GitHub Actions template (calls both ai-sdd + coding-standards) | 0.5d |
| MCS-017 | 4.3 | regenerate-requirements-lock task template | 0.5d |
| MCS-014 | 4.4 | Governance onboarding documentation | 1d |

**ai-sdd total: 18 tickets, ~15.25 developer-days**

### coding-standards Tickets (tracked here, executed there)

| Ticket | Phase | Scope | Effort |
|--------|-------|-------|--------|
| MCS-CS-001 | 5.1 | Enhance MCP server with 6 high-level tools | 2d |
| MCS-CS-002 | 5.2 | MCP server npm packaging + .mcp.json config template | 0.5d |
| MCS-CS-003 | 5.3 | Agent prompt updates for MCP tool usage guidance | 0.5d |
| MCS-CS-004 | 5 | MCP server tests (all 12 tools, fixtures) | 1d |

**coding-standards total: 4 tickets, ~4 developer-days**

**Combined total: 22 tickets, ~19.25 developer-days**

### Dependency Graph

```
Phase 1: MCS-004 → MCS-005a → MCS-005b → MCS-005c
                                   ↓
Phase 2: MCS-018 ─┐
         MCS-006 ──┤
         MCS-001 ──┼→ MCS-007 → MCS-009a → MCS-009b → MCS-009c
                   │
Phase 3: MCS-008 ──┤
         MCS-012 ←─┤── (needs MCS-007 for `phase` field)
         MCS-013 ←─┘── (needs MCS-001 for governance config)

Phase 4: MCS-015, MCS-003, MCS-017, MCS-014 (all parallelisable after Phase 3)

Phase 5 (coding-standards): MCS-CS-001 → MCS-CS-002 → MCS-CS-003, MCS-CS-004
         (parallelisable with ai-sdd Phases 2–4)
```

---

## Feature-to-File Map

| Feature | Target |
|---------|--------|
| Agent constitution | `data/integration/claude-code/agents/constitution.md` (new) |
| GO protocol | `sdd-scaffold.md` + `sdd-ba.md` |
| Toolgate template | `data/integration/toolgate.yaml` (new) |
| Requirements lock example | `data/integration/requirements.lock.example.yaml` (new) |
| CANCELLED state | `src/types/index.ts` + `src/core/state-manager.ts` |
| Cancel CLI | `src/cli/commands/cancel.ts` (new) |
| GovernanceMode + LockMode | `src/types/index.ts` |
| AcceptanceCriterion + Zod | `src/types/index.ts` |
| GatedHandoverState + ACCoverageReport | `src/types/index.ts` |
| TaskBudget + Zod | `src/types/index.ts` |
| TaskOverlays (planning_review) | `src/types/index.ts` |
| Governance config | `ai-sdd.yaml` schema + `src/config/defaults.ts` |
| RequirementsLockConfig | `ai-sdd.yaml` schema + `src/config/defaults.ts` |
| Spec hash tracking | `src/core/engine.ts` |
| `--acknowledge-spec-change` | `src/cli/commands/run.ts` |
| Gate 2 scope drift | `src/overlays/policy-gate/gate-overlay.ts` |
| Gate 2b budget | `src/overlays/policy-gate/gate-overlay.ts` |
| Thin traceability CLI | `src/cli/commands/traceability.ts` (new) |
| PlanningReviewOverlay | `src/overlays/planning-review/planning-review-overlay.ts` (new) |
| Overlay chain update | `src/overlays/composition-rules.ts` |
| Phase-based routing | `src/adapters/factory.ts` + `ai-sdd.yaml` |
| AC coverage gate | `src/cli/commands/complete-task.ts` Step 2.5 |
| CI template | `data/integration/.github/workflows/ai-sdd-gates.yml` (new) |
| Lock regen task | `data/task-library/regenerate-requirements-lock.yaml` (new) |
| MCP config for coding-standards | `data/integration/claude-code/.mcp.json` (new) |
| Init updates | `src/cli/commands/init.ts` (modified) |

---

## What Is Explicitly NOT Implemented in ai-sdd

| Feature | Reason | Where It Lives Instead |
|---------|--------|----------------------|
| Deep graph analysis (impact chains, orphans) | Read-only analysis, not enforcement | coding-standards MCP server |
| Structural lock file validation (10-rule lint) | Read-only analysis | coding-standards MCP server |
| `REQUIREMENTS_VALIDATED` task state | Breaks VALID_TRANSITIONS | N/A — hard reject |
| Drift scripts (reproducibility-check.sh etc.) | CI tools, not engine enforcement | coding-standards (used directly in CI) |
| check-budgets.sh | Out-of-process verification | coding-standards (used directly in CI) |
| Full MCP server unification | Separate project | coding-standards runs own MCP server |
| ML/drift prediction | Needs governance baseline first | Deferred indefinitely |
| Multi-candidate evaluation engine | Changes execution model | Out of scope |
| coding-standards state machine states (PLANNING_IN_PROGRESS etc.) | Mapped to overlay chain + phase field + DAG | See state machine mapping table |
| Guard DSL | Overlay config + DAG deps already express guards | See guard mapping table |
| Java/Kotlin standards | TypeScript only | N/A |

---

## Success Metrics

### Technical
1. PR gate outcomes deterministic (0 flaky gate runs).
2. >80% scope-drift issues caught by Gate 2 (baseline: 4 sprints post Phase 2).
3. Critical traceability gap count trends downward release-over-release.

### Adoption
1. % projects with `governance: enforce`.
2. % workflows with `acceptance_criteria` on at least one task.
3. Releases passing `ai-sdd traceability report` with zero critical gaps.

### Rework Impact
4. `NEEDS_REWORK` rate ≥15% reduction within 60 days of Phase 3 for PlanningReviewOverlay-enabled workflows.

### Analysis Tool Adoption
5. % of reviewer agents calling coding-standards MCP `validate_lock` during review tasks.
6. CI pipelines using both ai-sdd traceability + coding-standards structural validation.

---

## Risks and Controls

| Risk | Control |
|------|---------|
| Silent governance from untyped handover | `GatedHandoverState` + warning events; `enforce` fails on missing data |
| Reviewer fatigue from unconstrained PlanningReview | `phases` filter + disabled by default |
| Planning review stuck/slow | Timeout (24h default) + fail-closed + `--waive-planning-review` escape |
| Spec hash change blocks without context | `--acknowledge-spec-change=<reason>` with audit logging |
| Operator friction from over-enforcement | Default `warn`; `enforce` opt-in |
| Budget gate self-reporting (agent cheating) | coding-standards MCP `validate_lock` as out-of-process check |
| Brownfield projects overwhelmed | `lock_mode: brownfield` downgrades gap severity |
| coding-standards MCP server not installed | CI template degrades gracefully (skip with message); agents work without it (enforcement gates still native) |
| CANCELLED state breaks existing tests | Backward compatible: existing code never produces CANCELLED; terminal state with no outbound transitions |
| Phase routing referencing unconfigured adapters | Auth warnings only for used adapters |
