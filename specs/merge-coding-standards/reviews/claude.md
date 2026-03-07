# Merge Proposal: coding-standards → ai-sdd
**Date:** 2026-03-03
**Source:** `/Users/anjan/workspace/projects/coding-standards` (v2.1)
**Target:** `ai-sdd-claude` (current branch: feature/pre-init-agent-qna-and-help-text)
**Status:** PROPOSAL — awaiting review and prioritisation

---

## Executive Summary

The two projects occupy different but adjacent layers of the AI-assisted development stack:

| | ai-sdd | coding-standards |
|---|---|---|
| **Concern** | *How* work flows | *What* gets built |
| **Core artefact** | `workflow-state.json` + overlay chain | `requirements.lock.yaml` + validation gates |
| **Enforces** | State machine, overlays, adapters, CLI | Requirements traceability, AC contracts, scope discipline |
| **Gap** | No requirements traceability; no gold-plating prevention; no confidence protocol | No orchestration engine; no multi-agent DAG; no adapter layer |

They are complementary. Merging the top features of coding-standards into ai-sdd produces a system where:
- Tasks cannot be dispatched until their requirements are locked and approved (GO protocol)
- The overlay chain enforces not just evidence quality (T1/T2) but also scope compliance (excluded-terms gate)
- The pre-init agent produces a `requirements.lock.yaml` the engine can validate against at every task completion
- Agents have non-negotiable baseline rules that prevent gold-plating at the prompt level

This proposal is structured as **four incremental phases**, ordered by value-to-effort ratio. Each phase is independently releasable and does not block the next.

---

## Gap Analysis

### What coding-standards has that ai-sdd lacks

| # | Feature | Value | Effort | Phase |
|---|---------|-------|--------|-------|
| CS-01 | `requirements.lock.yaml` — immutable, hash-verified, graph-encoded source of truth | Very High | Medium | 2 |
| CS-02 | 90% Confidence Rule + GO Protocol — no code before formal approval | Very High | Low | 1 |
| CS-03 | Gherkin BDD acceptance criteria — testable, machine-readable, 1:1 to tests | Very High | Medium | 2 |
| CS-04 | Planning Reviewer gate — mandatory review even at 100% confidence | High | Medium | 3 |
| CS-05 | `scope.excluded` + Gate 2 — active scan for gold-plating in outputs | High | Low | 2 |
| CS-06 | Scope budgets — `max_files`, `max_loc`, `max_apis` per task | Medium | Low | 2 |
| CS-07 | Spec hash tracking — detect requirement drift between runs | High | Low | 2 |
| CS-08 | Phase-based model routing — right model per workflow phase | High | Medium | 3 |
| CS-09 | Agent constitution (mandatory non-negotiable baseline) | High | Low | 1 |
| CS-10 | Semantic drift detection scripts (6-layer Gates 0–5) | Medium | Medium | 4 |
| CS-11 | Diff-aware lock regeneration with change classification | Medium | High | 4 |
| CS-12 | Toolgate.yaml — evidence-gated tool config per project | Medium | Low | 1 |
| CS-13 | `toolgate.yaml` budget enforcement (fail CI on scope overrun) | Medium | Medium | 4 |
| CS-14 | Planning artefacts in `plans/<feature>/` convention | Low | Low | 1 |

### What ai-sdd has that coding-standards lacks (and should not be changed)

- Workflow DAG orchestration (topological sort, concurrency)
- Full state machine with VALID_TRANSITIONS enforcement
- Overlay chain (HIL, policy gate, review, paired, confidence)
- Multiple adapter types (Claude, OpenAI, mock)
- MCP server for tool-agnostic integration
- Expression DSL for conditions
- Observability (events, cost tracking)
- Atomic transaction boundary (`complete-task`)

---

## Phase 1: Zero-Code Wins
**Effort:** 1–2 days
**Files touched:** `data/integration/`, `CLAUDE.md`, agent MD files, new project-level config template
**Tests required:** None (documentation + config only)

### 1.1 Agent Constitution (CS-09)

**What:** A mandatory `agents/constitution.md` equivalent embedded into the agent YAML/MD files that ai-sdd copies during `init --tool claude_code`.

**Where to add it:** `data/integration/claude-code/agents/` — add a preamble to each of the 6 agent MD files (ba.md, architect.md, pe.md, le.md, dev.md, reviewer.md) and create a new `constitution.md` file that all agents reference.

**Content to add** (adapted from `coding-standards/agents/constitution.md`):
```markdown
# Agent Constitution (Mandatory Baseline)

1. Treat `requirements.lock.yaml` as the source of truth when present. Do not reinterpret or extend it. Code must conform exactly.
2. Do not mark work complete unless all acceptance criteria are implemented and validated.
3. Surface blockers, ambiguities, and approved deviations explicitly in handover_state.
4. Do not add features, logging, metrics, retries, caching, or error handling that are not explicitly in the task definition or acceptance criteria. This is gold-plating and is forbidden.
5. A mandatory Planning Review runs before implementation. Confidence score does not bypass it.
6. Every code change must trace to an acceptance criterion in the task definition.
```

**Why:** ai-sdd's current agent prompts (in `data/integration/claude-code/agents/`) focus on role and workflow but have no non-negotiable gold-plating prevention rules. The constitution plugs this gap at the prompt level.

---

### 1.2 90% Confidence Rule + GO Protocol (CS-02)

**What:** Embed the GO protocol into the pre-init agent (`data/integration/claude-code/agents/sdd-scaffold.md`) and into the `ai-sdd-ba` agent prompt. This formalises the QnA loop that already exists in the pre-init agent.

**Current state:** The pre-init agent already has a QnA loop that asks clarifying questions. It stops when the user approves. But there is no confidence score, no formalised "LOCKED REQUIREMENTS" output, and no explicit GO gate.

**Changes needed:**
- `data/integration/claude-code/agents/sdd-scaffold.md`: add confidence scoring step before producing `requirements.md` / `constitution.md`; require "GO" from the user before finalising outputs
- `data/integration/claude-code/agents/ba.md`: add confidence protocol for the BA agent (produces PRD-equivalent task specifications)

**Protocol to add:**
```markdown
## Confidence Protocol (Mandatory)

Before producing any task specification or requirements document:

1. Deconstruct the request: list every explicitly stated requirement
2. Identify ambiguities: what is unclear, missing, or assumed?
3. Calculate confidence (0–100):
   - 100%: all requirements explicit, all ACs clear, scope boundaries defined
   - <90%: ambiguities remain → STOP and ask clarifying questions only
4. If confidence ≥ 90%: present a LOCKED REQUIREMENTS summary and ask the user to respond "GO"
5. Write specifications ONLY after receiving "GO"

## Output Header (Mandatory)

All specification outputs must begin with:
```
LOCKED REQUIREMENTS
Confidence: [score]%
Approved: [timestamp]
```
```

**Why:** The QnA loop exists but is informal. Formalising it with a confidence threshold and explicit GO gate prevents premature scaffold generation and aligns with the coding-standards discipline.

---

### 1.3 Toolgate Template (CS-12)

**What:** Add a `toolgate.yaml` template to `data/integration/` that `ai-sdd init` copies into the project.

**Content:**
```yaml
# Evidence-gated tool configuration — customize per project.
tool_gates:
  build: "bun run typecheck"
  test: "bun test"
  lint: "bun run typecheck"
  lock_exists: "test -f .ai-sdd/requirements.lock.yaml"
  reproducibility: "echo 'configure: scripts/reproducibility-check.sh'"

budgets:
  scope:
    max_new_files_per_task: 5
    max_new_public_apis_per_task: 2
    max_loc_delta_per_task: 500
  change:
    max_complexity_delta_per_function: 3
```

**Why:** Gives every ai-sdd-initialised project an evidence-gated CI config out of the box. The budget numbers are enforceable in a future Phase 4 gate.

---

### 1.4 Planning Artefacts Convention (CS-14)

**What:** Add to `CLAUDE.md` and to the scaffold agent: planning artefacts live in `plans/<feature-name>/`. This is a naming convention only.

**Add to CLAUDE.md:**
```
**Planning artefacts** — live in `plans/<feature-name>/` (tool-agnostic, versionable). A plan directory contains: `spec.md` (feature spec), `plan.md` (task breakdown), optionally `tasks/*.md`.
```

**Why:** Ensures planning outputs from the BA/architect agents go to a predictable location, making them findable by the Planning Reviewer overlay (Phase 3).

---

## Phase 2: Schema Extensions
**Effort:** 3–5 days
**Files touched:** `src/types/index.ts`, `data/workflows/`, `data/task-library/`, workflow YAML schema
**Tests required:** New Zod schema tests; update existing workflow-loader tests

### 2.1 `requirements.lock.yaml` as Task Input (CS-01)

**What:** Recognise `requirements.lock.yaml` as a first-class project artefact. The engine reads it to:
1. Validate that a task's `acceptance_criteria` match the lock when it exists
2. Track its `spec_hash` in `workflow-state.json`
3. Emit a `requirements.lock.changed` event when the hash changes between runs

**Schema changes:**

`workflow-state.json` gains two new fields:
```typescript
interface WorkflowState {
  // ... existing ...
  requirements_lock?: {
    path: string;               // ".ai-sdd/requirements.lock.yaml"
    spec_hash: string;          // SHA256 of file at last run start
    locked_at: string;          // ISO timestamp
  };
}
```

`ai-sdd.yaml` gains an optional `requirements_lock` block:
```yaml
requirements_lock:
  path: ".ai-sdd/requirements.lock.yaml"  # default
  enforce: true                            # fail if lock missing when tasks have AC
```

**Why:** The lock file becomes the bridge between the requirements discipline (coding-standards) and the workflow engine (ai-sdd). Tasks that declare `acceptance_criteria` but have no lock file emit a warning; tasks with a hash mismatch emit an error if `enforce: true`.

---

### 2.2 Gherkin Acceptance Criteria in Task Definitions (CS-03)

**What:** Add an `acceptance_criteria` field to the task YAML schema. This is already partially present in the `requirements.lock.yaml` format; the goal is to make it a first-class field in ai-sdd's `workflow.yaml`.

**Schema addition (in `src/types/index.ts`):**
```typescript
interface AcceptanceCriterion {
  scenario: string;
  given: string | string[];
  when: string;
  then: string[];
  and?: string[];
}

interface TaskDefinition {
  // ... existing ...
  acceptance_criteria?: AcceptanceCriterion[];
  requirement_ids?: string[];      // e.g. ["REQ-001", "REQ-002"] — traceability links
}
```

**Workflow YAML example:**
```yaml
tasks:
  implement-order-api:
    agent: dev
    description: "Implement POST /api/orders endpoint"
    requirement_ids: [REQ-001]
    acceptance_criteria:
      - scenario: "Create order successfully"
        given: "I am an authenticated user"
        when: "POST /api/orders with valid productId and quantity"
        then:
          - "Response status is 201"
          - "Order persisted in database"
          - "tests_passed: true in handover_state"
```

**PolicyGateOverlay extension:** When `acceptance_criteria` is non-empty and `handover_state.tests_passed` is `true`, the gate checks that the agent explicitly confirmed each AC scenario in `handover_state.ac_coverage` (a new optional evidence field). This is an additive check — it does not break existing workflows without ACs.

**Why:** Makes task specifications testable by definition. The overlay can verify AC coverage without changing the core engine.

---

### 2.3 Scope Excluded Enforcement in PolicyGateOverlay (CS-05)

**What:** Add `scope_excluded` to task definitions and enforce it in `PolicyGateOverlay.postTask`.

**Schema addition:**
```typescript
interface TaskDefinition {
  // ... existing ...
  scope_excluded?: string[];   // terms that must not appear in output
}
```

**Workflow YAML example:**
```yaml
tasks:
  implement-order-api:
    scope_excluded:
      - "payment"
      - "notification"
      - "logging"
      - "retry"
      - "cache"
```

**PolicyGateOverlay change (Gate 2 — scope drift):**
```typescript
// In postTask, after T0/T1/T2 evidence checks:
const excluded = ctx.task_definition.scope_excluded ?? [];
if (excluded.length > 0 && result.handover_state?.raw_output) {
  const output = result.handover_state.raw_output as string;
  const violations = excluded.filter(term =>
    output.toLowerCase().includes(term.toLowerCase())
  );
  if (violations.length > 0) {
    failures.push(
      `Scope drift: output contains excluded terms: ${violations.join(", ")}. ` +
      `Remove these features and resubmit.`
    );
  }
}
```

**Why:** This is Gate 2 from coding-standards' `semantic-drift-check.sh`, implemented directly in the overlay chain. Gold-plating becomes a policy gate failure, not a manual review finding.

---

### 2.4 Scope Budgets in Task Definitions (CS-06)

**What:** Add a `budget` field to task definitions. The PolicyGateOverlay checks it at postTask.

**Schema addition:**
```typescript
interface TaskBudget {
  max_new_files?: number;        // default: unlimited
  max_loc_delta?: number;        // default: unlimited
  max_new_public_apis?: number;  // default: unlimited
}

interface TaskDefinition {
  // ... existing ...
  budget?: TaskBudget;
}
```

**Evidence expected in handover_state:**
```typescript
// Agent reports metrics in handover_state:
handover_state: {
  new_files_created: 2,
  loc_delta: 180,
  new_public_apis: 1
}
```

**PolicyGateOverlay check:**
```typescript
const budget = ctx.task_definition.budget;
if (budget && result.handover_state) {
  const hs = result.handover_state as Record<string, unknown>;
  if (budget.max_new_files !== undefined) {
    const actual = hs["new_files_created"] as number ?? 0;
    if (actual > budget.max_new_files) {
      failures.push(`Budget exceeded: ${actual} new files (max ${budget.max_new_files})`);
    }
  }
  // ... similar for loc_delta, new_public_apis
}
```

**Why:** Prevents scope creep at the task level. A task told "max 3 new files" cannot silently add 10.

---

### 2.5 Spec Hash Tracking (CS-07)

**What:** When `requirements_lock.path` is configured, the engine computes the SHA256 of the lock file at workflow start and stores it in `workflow-state.json`. At each subsequent run start, it compares hashes and emits `requirements.lock.changed` if they differ.

**Engine change (in `src/core/engine.ts`, `run()` startup):**
```typescript
if (config.requirements_lock?.path) {
  const lockPath = resolve(projectPath, config.requirements_lock.path);
  if (existsSync(lockPath)) {
    const hash = createHash("sha256")
      .update(readFileSync(lockPath))
      .digest("hex");
    const prev = state.requirements_lock?.spec_hash;
    if (prev && prev !== hash) {
      emitter.emit("requirements.lock.changed", {
        previous_hash: prev,
        current_hash: hash,
        path: lockPath,
      });
    }
    stateManager.patchState({ requirements_lock: { spec_hash: hash, ... } });
  }
}
```

**Why:** Detects when requirements change mid-project without triggering a full re-run. Teams can see "lock changed since last run" in `ai-sdd status`.

---

## Phase 3: New Overlay + Agent Features
**Effort:** 5–8 days
**Files touched:** New `src/overlays/planning-review/`, `src/types/index.ts`, adapter config, engine
**Tests required:** New overlay tests; integration test with engine

### 3.1 Planning Review Overlay (CS-04)

**What:** A new `PlanningReviewOverlay` that runs as a `preTask` check. It is the ai-sdd equivalent of `agents/planning-reviewer.md` from coding-standards.

Unlike the current overlays (which evaluate outcomes), the Planning Review evaluates the *plan* before execution. It calls a reviewer agent with the task definition, AC, and scope, and blocks dispatch until the plan is APPROVED.

**New overlay:** `src/overlays/planning-review/planning-review-overlay.ts`

**Config in `ai-sdd.yaml`:**
```yaml
overlays:
  planning_review:
    enabled: false          # opt-in (false by default, unlike HIL)
    reviewer_agent: "reviewer"
    block_on_needs_work: true
```

**Task-level override:**
```yaml
tasks:
  implement-payment-api:
    overlays:
      planning_review:
        enabled: true
        risk_tier: T2       # planning review mandatory for T2 tasks
```

**preTask behaviour:**
1. Build planning review prompt: task definition + ACs + `scope_excluded` + `requirement_ids`
2. Dispatch to `reviewer_agent` (the existing agentic-review infrastructure, but for planning)
3. Parse response for `APPROVED` / `NEEDS_WORK`
4. If `NEEDS_WORK`: return `{ proceed: false, hil_trigger: false }` → task transitions to `NEEDS_REWORK`
5. If `APPROVED`: return `{ proceed: true }`

**Overlay chain order update** (`src/overlays/composition-rules.ts`):
```
HIL → Planning Review → Evidence Gate → Agentic Review → Paired → Confidence → Dispatch
```
Planning Review runs before Evidence Gate because it validates the plan, not the output.

**Why:** This is the single highest-value feature in coding-standards. It prevents entire categories of rework (scope creep, missing AC coverage, infeasible plans) before a single line of code is written.

---

### 3.2 Phase-Based Model Routing (CS-08)

**What:** Extend the adapter configuration to support per-phase model routing. Currently, the adapter type is fixed per project. Phase routing allows different models/temperatures for planning vs implementation phases.

**New field in `ai-sdd.yaml`:**
```yaml
adapter:
  type: claude_code
  phase_routing:
    planning:
      type: openai
      model: gpt-4o
      temperature: 0.2
    planning_review:
      type: claude_code
      model: claude-opus-4-6
      temperature: 0.0
    implementation:
      type: claude_code
      model: claude-sonnet-4-6
      temperature: 0.1
    review:
      type: openai
      model: gpt-4o
      temperature: 0.0
```

**Engine change:** `assembleContext()` in `context-manager.ts` receives a `phase` field; `run.ts` selects the adapter from `phase_routing[task.phase]` if present, falling back to the default `adapter.type`.

**Task-level phase field:**
```yaml
tasks:
  design-architecture:
    agent: architect
    phase: planning          # routes to phase_routing.planning adapter
  implement-feature:
    agent: dev
    phase: implementation    # routes to phase_routing.implementation adapter
```

**Why:** Enables cost-optimised, quality-optimised routing. Planning tasks need high-creativity models; review tasks need precise, conservative models; implementation tasks need balanced models. This is currently impossible in ai-sdd — all tasks use the same adapter.

---

### 3.3 Requirements Traceability in `complete-task` (CS-03 extension)

**What:** When a task has `acceptance_criteria`, `complete-task` validates that the submitted output references each scenario ID in a structured `ac_coverage` report in `handover_state`.

**complete-task extension:**
```typescript
// Step 2.5 (between sanitize and contract-validate):
const declaredACs = loadDeclaredACs(projectPath, taskId);
if (declaredACs && declaredACs.length > 0) {
  const coverage = handoverState["ac_coverage"] as Record<string, boolean> ?? {};
  const uncovered = declaredACs.filter(ac => !coverage[ac.scenario]);
  if (uncovered.length > 0) {
    // transition to NEEDS_REWORK with feedback listing uncovered scenarios
  }
}
```

**Why:** Makes it impossible for an agent to mark a task complete without explicitly addressing each acceptance criterion. Closes the gap between "tests_passed: true" (which is self-reported) and verified AC coverage.

---

## Phase 4: Tooling and CI/CD Integration
**Effort:** 3–5 days
**Files touched:** New `scripts/` directory in project init output; `.github/` template
**Tests required:** Shell script tests via bats or inline

### 4.1 Adapt Semantic Drift Scripts for ai-sdd Projects (CS-10)

**What:** Port `scripts/reproducibility-check.sh` and `scripts/semantic-drift-check.sh` from coding-standards into ai-sdd's `data/integration/` directory. `ai-sdd init` copies them into `.ai-sdd/scripts/`.

**Adaptations needed:**
- `reproducibility-check.sh`: check for `.ai-sdd/requirements.lock.yaml` instead of `requirements.lock.yaml`; check for `workflow-state.json` integrity; call `bun test` instead of `./gradlew test`
- `semantic-drift-check.sh`: Gate 0 checks `spec_hash` from `workflow-state.json` instead of a standalone file; Gate 2 reads `scope_excluded` from the first task that has it

**New file:** `data/integration/scripts/reproducibility-check.sh`
**New file:** `data/integration/scripts/semantic-drift-check.sh`

**Why:** Gives every ai-sdd project CI-enforced drift detection without manual configuration. Teams get Gates 0–4 in their CI pipeline on day one.

---

### 4.2 GitHub Actions Template (CS-10 extension)

**What:** Add a `.github/workflows/ai-sdd-gates.yml` template to `data/integration/` that `ai-sdd init` copies.

**Content:**
```yaml
name: ai-sdd Gates
on:
  pull_request:
    branches: [main, master]
jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run typecheck
      - run: bun test
      - run: .ai-sdd/scripts/reproducibility-check.sh
      - run: BASE_REF=origin/main .ai-sdd/scripts/semantic-drift-check.sh
```

**Why:** Zero-config CI integration for ai-sdd projects.

---

### 4.3 Toolgate Budget Enforcement Script (CS-13)

**What:** A `check-budgets.sh` script that reads `toolgate.yaml` and compares actual metrics (from git diff) against declared budgets.

**Checks:**
- `git diff --stat` to count new files
- `git diff --unified=0 | wc -l` for LOC delta
- Custom grep for new public API signatures

**Called by CI gate** after tests pass.

**Why:** Automates the scope budget checks that Phase 2.4 adds as overlay evidence. A developer can run `check-budgets.sh` locally to verify before pushing.

---

### 4.4 Diff-Aware Lock Regeneration Workflow Task (CS-11)

**What:** Add a built-in task library entry `regenerate-requirements-lock` to `data/task-library/`.

**Template:**
```yaml
id: regenerate-requirements-lock
description: |
  Regenerate requirements.lock.yaml from existing code. Extract requirements
  from evidence only: OpenAPI specs, tests, public interfaces, domain logic.
  Never infer intent or invent requirements.
agent: architect
phase: planning
acceptance_criteria:
  - scenario: "Lock file generated from evidence"
    given: "Existing codebase with tests and interfaces"
    when: "Regeneration task runs"
    then:
      - "requirements.lock.yaml updated with current state"
      - "spec_hash updated in workflow-state.json"
      - "change_reason provided for any breaking changes"
      - "diff classification (breaking/significant/minor) provided"
outputs:
  - path: ".ai-sdd/requirements.lock.yaml"
  - path: ".ai-sdd/requirements.lock.diff.yaml"
```

**Why:** Makes lock regeneration a workflow task rather than a manual step. The diff output classifies changes as breaking/significant/minor, giving reviewers a structured change summary.

---

## Priority Summary

| Phase | Items | Effort | Value | Recommended Order |
|-------|-------|--------|-------|-------------------|
| 1: Zero-code | Constitution, GO protocol, toolgate template, plans convention | 1–2 days | High (immediate, no risk) | Start here |
| 2: Schema | Requirements lock, Gherkin AC, scope excluded, budgets, spec hash | 3–5 days | Very High (foundational) | Second |
| 3: Overlays | Planning Review overlay, phase routing, AC validation in complete-task | 5–8 days | High (new capabilities) | Third |
| 4: Tooling | Drift scripts, CI template, budget check, lock regeneration task | 3–5 days | Medium (CI enablement) | Fourth |

---

## What NOT to merge

Some coding-standards features are not worth porting because ai-sdd already has equivalent or superior implementations:

| coding-standards feature | ai-sdd equivalent | Reason to skip |
|---|---|---|
| `workflow/state-machine.yaml` | `src/types/index.ts` VALID_TRANSITIONS | ai-sdd's is TypeScript-enforced; YAML is advisory only |
| `workflow/context.schema.json` | `src/core/context-manager.ts` | ai-sdd's context assembly is typed TypeScript |
| `scripts/check-iteration-limits.sh` | `max_rework_iterations` in engine | ai-sdd enforces this in the state machine, not a script |
| `workflow/events-contract.md` | `src/observability/emitter.ts` | ai-sdd already has a typed event emitter |
| Language-specific standards (java/, kotlin/) | N/A | ai-sdd is TypeScript; Java/Kotlin standards don't apply |
| `scripts/run-phase.sh` | Phase routing (Phase 3.2 above) | Superseded by the in-engine phase routing proposal |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| `requirements.lock.yaml` is optional — teams may skip it | Make it opt-in (Phase 2.1 enforce: false by default); emit warnings not errors |
| Gherkin AC adds friction for simple tasks | AC fields are optional; only PolicyGate checks them when present |
| Planning Review overlay adds latency | Disabled by default; opt-in per task or by T2 risk tier |
| Phase routing increases config complexity | Sensible defaults; phase routing is entirely optional |
| Scope excluded scan may produce false positives in large outputs | Scan only `handover_state.raw_output`, not file contents; provide override mechanism |
| Budget enforcement is self-reported (from handover_state) | Combine with CI script (Phase 4.3) for out-of-process verification |

---

## Appendix: Feature-to-File Map

| Feature | Source file (coding-standards) | Target file (ai-sdd) |
|---------|-------------------------------|----------------------|
| Agent constitution | `agents/constitution.md` | `data/integration/claude-code/agents/constitution.md` (new) |
| GO protocol | `CLAUDE.md` §Confidence Protocol | `data/integration/claude-code/agents/sdd-scaffold.md` + `ba.md` |
| Toolgate template | `toolgate.yaml` | `data/integration/toolgate.yaml` (new, copied by init) |
| Requirements lock schema | `rules/example.requirements.lock.yaml` | `data/integration/requirements.lock.example.yaml` (new) |
| Gherkin AC type | `rules/acceptance-criteria-format.md` | `src/types/index.ts` AcceptanceCriterion interface |
| Scope excluded gate | `scripts/semantic-drift-check.sh` Gate 2 | `src/overlays/policy-gate/gate-overlay.ts` |
| Scope budgets | `toolgate.yaml` budgets | `src/types/index.ts` TaskBudget; `gate-overlay.ts` |
| Spec hash | `scripts/spec-hash.sh` | `src/core/engine.ts` run() startup |
| Planning Reviewer | `agents/planning-reviewer.md` | `src/overlays/planning-review/planning-review-overlay.ts` (new) |
| Phase routing | `agents/model-routing.yaml` | `src/adapters/factory.ts` + `ai-sdd.yaml` schema |
| AC validation in complete-task | `rules/pull-request-checklist.md` | `src/cli/commands/complete-task.ts` |
| Drift scripts | `scripts/reproducibility-check.sh`, `semantic-drift-check.sh` | `data/integration/scripts/` (new, copied by init) |
| CI template | `.github/workflows/framework-gates-sample.yml` | `data/integration/.github/workflows/ai-sdd-gates.yml` (new) |
| Lock regeneration task | `agents/requirements-lock/` | `data/task-library/regenerate-requirements-lock.yaml` (new) |
