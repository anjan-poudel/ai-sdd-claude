# ai-sdd User Guide

## Overview

`ai-sdd` orchestrates multi-agent software development workflows. You define a DAG of tasks in YAML, and the framework dispatches each task to an LLM agent (Claude, OpenAI, or mock), managing state, retries, human approval (HIL), evidence gates, confidence scoring, agentic review loops, and paired driver/challenger workflows.

---

## Table of Contents

1. [Concepts](#concepts)
2. [Project Setup](#project-setup)
3. [Session Management](#session-management)
4. [Workflow YAML Reference](#workflow-yaml-reference)
5. [Agent Configuration](#agent-configuration)
6. [Constitution System](#constitution-system)
7. [Standards](#standards)
8. [Overlays](#overlays)
9. [Remote Overlays](#remote-overlays)
10. [Expression DSL](#expression-dsl)
11. [Human-in-the-Loop (HIL)](#human-in-the-loop-hil)
12. [Evidence Gate](#evidence-gate)
13. [CLI Command Reference](#cli-command-reference)
14. [Adapter Configuration](#adapter-configuration)
15. [Integration Guides](#integration-guides)
16. [Security](#security)
17. [Config Reference](#config-reference)
18. [Troubleshooting](#troubleshooting)

---

## Concepts

### Workflow
A YAML file defining a DAG (directed acyclic graph) of tasks. Tasks have agents, descriptions, dependencies, and overlays.

### Agent
A YAML file defining an LLM persona: model, hyperparameters, role description, responsibilities. Six defaults are bundled; extend or override per project.

### Adapter
The runtime that executes tasks. Adapters: `claude_code`, `openai`, `mock`. Roo Code connects via the MCP server — not a runtime adapter.

### Overlay
Processing around task execution. Five built-in overlays run in a fixed chain:
`HIL → Evidence Gate → Agentic Review → Paired Workflow → Confidence`

### Remote Overlay
An external MCP server called as a post-task gate. Non-blocking by default — verdict goes to evidence without stopping the workflow.

### Constitution
A Markdown file that provides project context to every agent. The engine automatically maintains a `## Workflow Artifacts` section in `.ai-sdd/constitution.md`.

### Standards
Markdown files under `standards/` that inject reusable behavioral and technical guidelines into every agent's context. Auto-discovered alphabetically. `standards/AiAgent.md` is the base standard for all AI agents.

### HIL Queue
File-based queue of items awaiting human review. Agents pause at `HIL_PENDING` until resolved or rejected via CLI.

### Task States

| State | Meaning |
|---|---|
| `PENDING` | Not yet started — waiting for dependencies |
| `RUNNING` | Dispatched to agent — in progress |
| `COMPLETED` | Done — output accepted and written |
| `NEEDS_REWORK` | Output rejected — will retry with feedback |
| `HIL_PENDING` | Paused — awaiting human approval |
| `FAILED` | Terminal — max iterations exceeded, HIL rejected, or unrecoverable error |
| `CANCELLED` | Terminal — explicitly cancelled |

State machine: `PENDING → RUNNING → COMPLETED`, with branches to `NEEDS_REWORK → RUNNING`, `HIL_PENDING → RUNNING`, and `FAILED`/`CANCELLED` as terminal states.

---

## Project Setup

### Directory Structure

```
your-project/
├── constitution.md          # Project context for agents (created by init)
├── CLAUDE.md                # Claude Code orientation (appended by init)
├── standards/               # Agent behavioral and technical standards
│   ├── AiAgent.md           # Base standard — applies to all agents
│   ├── TypeScript.md        # Language-specific (applies if relevant)
│   └── ...                  # Add more as needed
├── specs/                   # Workflow artifacts produced by agents
│   ├── workflow.yaml        # Greenfield workflow (alongside spec docs)
│   ├── define-requirements.md
│   ├── design-l1.md
│   └── <feature>/           # Feature-scoped artifacts
│       ├── workflow.yaml
│       └── constitution.md  # Feature-scoped constitution (optional)
├── .ai-sdd/
│   ├── ai-sdd.yaml          # Project config
│   ├── active-session        # Current session name (plain text, e.g. "roundtrip-travel")
│   ├── workflows/
│   │   └── default-sdd.yaml # Default SDD workflow (copied by init, edit freely)
│   ├── agents/              # Custom agent overrides (optional)
│   └── sessions/            # Per-session runtime state (auto-managed)
│       ├── default/         # Greenfield session (no --feature)
│       │   ├── workflow-state.json
│       │   ├── hil/
│       │   ├── outputs/
│       │   ├── pair-sessions/
│       │   └── review-logs/
│       └── <feature-name>/  # Feature-scoped session
│           ├── workflow-state.json
│           ├── hil/
│           ├── outputs/
│           ├── pair-sessions/
│           └── review-logs/
└── .claude/                 # Created by init --tool claude_code
    ├── agents/              # sdd-ba, sdd-architect, sdd-pe, sdd-le, sdd-dev, sdd-reviewer
    └── skills/
        ├── sdd-run/SKILL.md
        └── sdd-status/SKILL.md
```

### Output Structure

| Context | Artifact location |
|---|---|
| Greenfield project | `specs/<task-id>.md` (e.g. `specs/define-requirements.md`) |
| Feature workflow | `specs/<feature>/<task-id>.md` |
| Task breakdown | `specs/<task-id>/plan.md` + `specs/<task-id>/tasks/` |
| Requirements lock | `specs/<task-id>.lock.yaml` — immutable snapshot after BA HIL sign-off |
| Workflow definition | `specs/workflow.yaml` (greenfield) or `specs/<feature>/workflow.yaml` |

### Workflow Lookup Order

First found wins for `run` and `complete-task`:

1. `--workflow <name>` → `.ai-sdd/workflows/<name>.yaml`
2. `--feature <name>` → `specs/<feature>/workflow.yaml`
3. `specs/workflow.yaml` — greenfield workflow alongside spec docs
4. `.ai-sdd/workflow.yaml` — backward-compat single-file override
5. `.ai-sdd/workflows/default-sdd.yaml` — copied by `ai-sdd init`
6. Bundled framework default

### Minimal `ai-sdd.yaml`

```yaml
version: "1"

adapter:
  type: claude_code

engine:
  max_concurrent_tasks: 3
  cost_budget_per_run_usd: 10.00
  cost_enforcement: pause    # warn | pause | stop

overlays:
  hil:
    enabled: true
```

---

## Session Management

Sessions let you run multiple concurrent feature workflows from a single `.ai-sdd/` directory. Each session has isolated state, HIL queue, outputs, pair-sessions, and review logs.

### Active session

The active session is stored in `.ai-sdd/active-session` (plain text file). All CLI commands operate on the active session by default. Override with `--feature <name>`.

```bash
ai-sdd sessions active              # Print active session name
ai-sdd sessions switch my-feature   # Switch active session
ai-sdd run --feature my-feature     # Run with explicit feature (also sets active)
```

### Creating sessions

```bash
ai-sdd sessions create my-feature   # Create session directory + subdirs
```

Sessions are also auto-created when you run `ai-sdd run --feature <name>` for the first time.

### Listing sessions

```bash
ai-sdd sessions list                # Name, task counts, active marker
ai-sdd sessions list --json         # Machine-readable
```

### Feature config overrides

A feature can optionally override the central config and agents by placing files under `specs/<feature>/.ai-sdd/`:

```
specs/<feature>/.ai-sdd/
├── ai-sdd.yaml          # Deep-merged on top of root config
├── agents/               # Feature-specific agent overrides
└── workflows/            # Feature-specific workflow overrides
```

### Legacy layout

Projects created before multi-session support have a flat `.ai-sdd/state/` directory. This is auto-detected — all commands work unchanged. A warning suggests running a future `ai-sdd migrate` command to upgrade.

---

## Workflow YAML Reference

### Minimal workflow

```yaml
version: "1"
name: my-workflow

tasks:
  implement:
    use: standard-implement
    depends_on: []

  review:
    use: standard-review
    depends_on: [implement]
```

This 6-line workflow is complete. Every template provides `agent`, `description`, `overlays`, and `outputs`. Override any field inline when you need workflow-specific context.

### Full reference

```yaml
version: "1"
name: my-workflow
description: "Optional description"

# Workflow-level defaults — applied to every task; override per-task as needed
defaults:
  overlays:
    hil:         { enabled: false }
    policy_gate: { risk_tier: T1 }
  max_rework_iterations: 3

tasks:
  <task-id>:
    use: <library-template>        # Optional: pull from data/task-library/
    agent: <agent-name>            # Required (or supplied by use:)
    description: "What to do"
    depends_on:
      - <other-task-id>
    outputs:
      - path: specs/output.md
        contract: requirements_doc
    exit_conditions:               # DSL expressions
      - "review.decision == GO"
    overlays:
      hil:
        enabled: true
      policy_gate:
        risk_tier: T2
      confidence:
        enabled: true
        threshold: 0.85
        metrics:
          - type: llm_judge
            evaluator_agent: reviewer
            weight: 1.0
      review:
        enabled: true
        reviewer_agent: reviewer
        coder_agent: dev
        max_iterations: 3
      paired:
        enabled: true
        driver_agent: dev
        challenger_agent: reviewer
        role_switch: checkpoint    # session | subtask | checkpoint
        max_iterations: 3
    max_rework_iterations: 5
```

### Engine built-in defaults

Every task starts with these values before workflow defaults or task overrides apply:

| Field | Default |
|---|---|
| `overlays.hil.enabled` | `true` |
| `overlays.policy_gate.risk_tier` | `T1` |
| `max_rework_iterations` | `3` |

### Merge order (later wins)

```
engine built-ins → workflow defaults: → task library template (use:) → task inline
```

Overlay keys merge individually — setting `hil.enabled: false` does not clobber `policy_gate.risk_tier`.

### Task Library (`use:`)

Bundled templates in `data/task-library/`. Templates define the invariant properties of each task type — including `phase` for remote overlay filtering. Policy overlays (HIL, risk tier) are left to the workflow `defaults:` or per-task overrides.

**Role primitives** — provide agent, contract and sensible defaults; policy set by workflow:

| Template | Phase | Agent | HIL | Risk | Contract |
|---|---|---|---|---|---|
| `define-requirements` | `requirements` | `ba` | on | T0 | `requirements_doc` |
| `design-architecture` | `design` | `architect` | on | T0 | `architecture_l1` |
| `design-component` | `design` | `pe` | off | T0 | `component_design_l2` |
| `plan-tasks` | `planning` | `le` | off | T0 | `task_breakdown_l3` |
| `standard-implement` | `implement` | `dev` | off | T1 | `implementation` |
| `standard-review` | `review` | `reviewer` | off | T1 | `review_report` |

**Named workflow stages** — complete task definitions; use directly by task ID:

| Template | Phase | Semantic | HIL | Risk | Contract |
|---|---|---|---|---|---|
| `review-l1` | `review` | L1 architecture review | off | T1 | `review_report` |
| `review-l2` | `review` | L2 component design review | off | T1 | `review_report` |
| `review-implementation` | `review` | Final code review | off | T1 | `review_report` |
| `security-design-review` | `review` | Security-focused design audit | off | T1 | `review_report` |
| `security-test` | `review` | Security testing pass | off | T1 | `review_report` |
| `final-sign-off` | `sign-off` | T2 mandatory production gate | off | **T2** | `review_report` |

Output paths use `{{task_id}}` substitution — a task named `design-l1` gets `specs/design-l1.md`.

`depends_on` is always per-workflow — never part of a template.

**Parallel reviews.** When a workflow has N parallel implementation tasks, give each its own review task:

```yaml
  review-component-a:
    use: review-implementation
    depends_on: [implement-component-a]

  review-component-b:
    use: review-implementation
    depends_on: [implement-component-b]    # parallel with review-component-a
```

### Dependency Rules

- Circular dependencies detected at load time (Kahn's algorithm).
- Tasks with no `depends_on` run first (parallel group 0).
- Tasks in the same parallel group run concurrently up to `max_concurrent_tasks`.

---

## Agent Configuration

### Default Agents

| ID | Role | Default Model |
|---|---|---|
| `ba` | Business Analyst | claude-sonnet-4-6 |
| `architect` | System Architect | claude-opus-4-6 |
| `pe` | Principal Engineer | claude-opus-4-6 |
| `le` | Lead Engineer | claude-sonnet-4-6 |
| `dev` | Developer | claude-sonnet-4-6 |
| `reviewer` | Reviewer | claude-opus-4-6 |

### Custom Agent (`.ai-sdd/agents/my-agent.yaml`)

```yaml
name: my-dev
display_name: "Rust Developer"
version: "1"
extends: dev            # Optional: inherit from any agent
llm:
  provider: anthropic
  model: claude-opus-4-6
  hyperparameters:
    temperature: 0.1
    max_tokens: 16000
role:
  description: |
    You are a Rust developer specializing in systems programming.
  expertise:
    - Rust async/await
    - memory safety
  responsibilities:
    - implement features in idiomatic Rust
    - write comprehensive unit tests
```

### Inheritance (`extends`)

`extends: ba` merges all fields from `ba.yaml` into your agent. Override only the fields you need to change.

---

## Constitution System

The constitution provides project context to every agent.

### Merge order (lowest → highest precedence)

1. `constitution.md` (project root)
2. `.ai-sdd/constitution.md` (auto-updated with workflow artifact manifest)
3. `CLAUDE.md`
4. `specs/<feature>/constitution.md` (feature-scoped, alphabetical by directory)
5. Submodule `*/constitution.md`
6. `standards/**/*.md` (appended last — see [Standards](#standards))

### Example `constitution.md`

```markdown
# Project Constitution

## Overview
Building a REST API for user management using TypeScript and Bun.

## Tech Stack
- Runtime: Bun 1.x
- Language: TypeScript (strict)
- Database: PostgreSQL 16

## Conventions
- All endpoints return `{ data, error }` envelope
- Tests use `bun test` with 80% minimum coverage
```

### Artifact Manifest

After each completed task the engine appends a manifest table to `.ai-sdd/constitution.md`:

```markdown
## Workflow Artifacts

| Task | Path | Contract | Status | Date |
|------|------|----------|--------|------|
| define-requirements | `specs/define-requirements.md` | `requirements_doc` | COMPLETED | 2026-03-09 |
| design-l1 | `specs/design-l1.md` | `architecture_l1` | COMPLETED | 2026-03-09 |
```

Agents read this to know what artifacts exist and where to find them — they do not need to guess paths.

### Requirements Lock

After the BA task completes and HIL is approved, a lock file is written:

```
specs/define-requirements.lock.yaml
```

This is an immutable snapshot used by the `repeatability-gate` remote overlay to detect requirement drift in downstream implementation tasks.

---

## Standards

Standards are Markdown files under `standards/` that are auto-discovered (alphabetically) and appended to every agent's context as the `## Coding Standards` section. Every agent — BA, architect, developer, reviewer — receives all standards.

### Base standard: `standards/AiAgent.md`

This is the foundational behavioral standard for all AI agents. It defines:

- **Workflow Orchestration** — plan mode, subagent strategy, self-improvement loop
- **Task Management** — plan-first, verify-before-done, track progress
- **Core Principles** — simplicity, no laziness, minimal impact

All other standards are additive on top of this base.

### Technology standards

Add language- or framework-specific standards as additional files:

```
standards/
├── AiAgent.md       # Base — all agents
├── TypeScript.md    # TypeScript conventions
├── Java.md          # Java conventions
└── Kotlin.md        # Kotlin conventions
```

### Controlling which standards apply

```bash
# Use explicit paths (comma-separated, relative to project root)
ai-sdd run --standards standards/AiAgent.md,standards/TypeScript.md

# Disable all standards
ai-sdd run --standards none
```

Or in `ai-sdd.yaml`:

```yaml
standards:
  paths:
    - standards/AiAgent.md
    - standards/TypeScript.md
  strict: false    # true = hard error on missing file (default: warn)
```

When `paths` is not set, all `*.md` files under `standards/` are auto-discovered.

### Inspect what agents receive

```bash
ai-sdd constitution --project .
```

The output shows the full merged context including `<!-- standards: path -->` source markers for each standards file.

---

## Overlays

### Overlay Chain Order (locked)

```
HIL → Evidence Gate → Agentic Review → Paired Workflow → Confidence → Agent Execution
```

`Agentic Review` and `Paired Workflow` are mutually exclusive — enable one or neither, never both on the same task.

---

### HIL Overlay

Pauses the workflow for human approval. Triggers when:
- `hil.enabled: true` (project default)
- `risk_tier: T2` (always, regardless of `enabled`)
- Context window threshold exceeded (direct mode)

```yaml
overlays:
  hil:
    enabled: true
```

---

### Evidence Gate (Policy Gate)

Validates that the agent's output meets the declared risk tier before accepting it.

| Tier | Evidence Required |
|---|---|
| `T0` | Output files present |
| `T1` | Output + `tests_passed` or `lint_passed` in handover state |
| `T2` | T1 + `security_clean` + `operational_ready` + HIL sign-off |

```yaml
overlays:
  policy_gate:
    risk_tier: T1    # T0 | T1 | T2
```

Gate fail → `NEEDS_REWORK` with specific failure feedback injected into the next iteration.

---

### Agentic Review Overlay

A full GO/NO_GO coder/reviewer loop. The reviewer evaluates the coder's output against the constitution quality guidelines and acceptance criteria.

```yaml
overlays:
  review:
    enabled: true
    reviewer_agent: reviewer    # must differ from coder_agent
    coder_agent: dev            # optional — defaults to task agent
    max_iterations: 3
```

**Flow:**
1. Coder produces output (normal engine dispatch).
2. Reviewer evaluates: GO or NO_GO with actionable feedback.
3. GO → `COMPLETED`. Review log written to `.ai-sdd/sessions/<session>/review-logs/<task-id>.json`.
4. NO_GO → `NEEDS_REWORK`. Feedback injected into coder's next iteration.
5. Max iterations without GO → `NEEDS_REWORK` with `hil_suggested: true`.

**Reviewer prompt** includes: task description, constitution quality guidelines, acceptance criteria (if defined on the task), coder outputs, and history of prior NO_GO decisions.

**Reviewer response format:**
```json
{ "decision": "GO", "feedback": "All criteria met." }
{ "decision": "NO_GO", "feedback": "...", "quality_checks": { "acceptance_criteria_met": false, "code_standards_met": true, "test_coverage_adequate": false, "security_review_passed": true } }
```

**Constraint:** `reviewer_agent` ≠ `coder_agent`. Validated at workflow load time.

---

### Paired Workflow Overlay

A driver/challenger loop where one agent produces output and another challenges it. Supports role rotation.

```yaml
overlays:
  paired:
    enabled: true
    driver_agent: dev           # produces the output
    challenger_agent: reviewer  # must differ from driver_agent
    role_switch: checkpoint     # session | subtask | checkpoint
    max_iterations: 3
```

**Role switch modes:**

| Mode | Behaviour |
|---|---|
| `session` | Driver and challenger are fixed for the entire workflow session |
| `subtask` | Roles swap after every resolved outcome (approval or rejection) |
| `checkpoint` | Roles swap at the end of each full review cycle (approval or max_iterations); stable within a cycle |

**Flow:**
1. Driver produces output (normal engine dispatch).
2. Challenger reviews and returns `{ "approved": true/false, "feedback": "..." }`.
3. Approved → `COMPLETED`. Roles switch if `subtask` or `checkpoint`.
4. Rejected + iterations remaining → `NEEDS_REWORK`. Roles switch if `subtask`.
5. Max iterations without approval → `NEEDS_REWORK` with `hil_suggested: true`. Roles switch if `checkpoint`.

Session state persisted to `.ai-sdd/sessions/<session>/pair-sessions/<task-id>.json`.

**Constraint:** `challenger_agent` ≠ `driver_agent`. `challenger_agent` required when `enabled: true`. Validated at workflow load time.

---

### Confidence Overlay

Scores the agent's output on a 0–1 scale. Below `threshold` → `NEEDS_REWORK`. Below the optional `low_confidence_threshold` → automatic regeneration + escalation chain.

The overlay is **disabled by default**. Default `threshold`: `0.7`.

```yaml
overlays:
  confidence:
    enabled: true
    threshold: 0.80             # quality bar — below this → NEEDS_REWORK
    low_confidence_threshold: 0.50   # crisis level — triggers regen chain (disabled by default)
    max_regeneration_retries: 3      # regen attempts before escalation (default 3)
    regen_sampling_schedule:         # per-retry sampling overrides
      - { top_p: 0.9, temperature: 0.2 }
      - { top_p: 0.8, temperature: 0.4 }
      - { top_p: 0.7, temperature: 0.6 }
    metrics:
      - type: output_completeness
        weight: 0.4
      - type: contract_compliance
        weight: 0.3
      - type: llm_judge
        evaluator_agent: reviewer
        weight: 0.3
```

**Metric types:**

| Type | Description |
|---|---|
| `output_completeness` | Fraction of expected output sections/fields present |
| `contract_compliance` | Whether declared artifact contract is satisfied |
| `lint_pass` | Boolean lint clean (1.0 or 0.0) |
| `llm_judge` | Dispatches a separate evaluator agent; score from `handover_state.score` (0.0–1.0) |

**`llm_judge` constraint:** `evaluator_agent` must be set and must differ from the task agent. Validated at workflow load time.

#### Two-Threshold Model

| Threshold | Key | Default | Effect |
|---|---|---|---|
| Quality bar | `threshold` | `0.7` | `score < threshold` → `NEEDS_REWORK` |
| Crisis level | `low_confidence_threshold` | *(disabled)* | `score < low_confidence_threshold` → regen chain |

#### Regeneration + Escalation Chain

When `score < low_confidence_threshold` the engine pursues higher-quality output rather than accepting poor work:

1. **Regeneration retries** — re-dispatch the task up to `max_regeneration_retries` times (default 3). Each retry applies the next entry in `regen_sampling_schedule` to nudge the model toward different outputs (`top_p` + `temperature`). If any retry passes confidence → task continues normally.

2. **Paired challenger escalation** — if retries are exhausted and `paired` mode is enabled, the challenger agent is dispatched once. If the challenger output passes confidence → task continues.

3. **HIL escalation** — if the challenger also fails (or paired mode is not enabled), a HIL item is created. On human resolve the task runs one rework iteration with the operator's notes. On reject → `FAILED`.

Regeneration retries do **not** consume `max_rework_iterations` budget.

#### Sampling Schedule

The default schedule progressively increases diversity on each retry:

| Retry | `top_p` | `temperature` |
|---|---|---|
| 1st | 0.9 | 0.2 |
| 2nd | 0.8 | 0.4 |
| 3rd | 0.7 | 0.6 |

If the retry count exceeds the schedule length, the last entry is reused. Sampling params are only honoured by direct-mode adapters (OpenAI); delegation-mode adapters (claude_code) ignore them.

---

## Remote Overlays

Remote overlays call external MCP servers as post-task gates. They are non-blocking by default — results are recorded as overlay evidence without stopping the workflow.

### Configuration

```yaml
# ai-sdd.yaml

overlay_backends:
  my-mcp:
    runtime: mcp
    command:
      - node
      - /path/to/mcp-server/dist/index.js
    transport: stdio
    timeout_ms: 10000
    failure_policy: warn    # warn | fail

remote_overlays:
  my-gate:
    backend: my-mcp
    enabled: true
    hooks:
      - post_task
    phases:
      - implement          # only runs on tasks in this phase
    blocking: false
    config:
      lockFile: /path/to/lock.yaml
```

### Built-in remote overlays

Two remote overlays are wired in by default and configured in `ai-sdd.yaml`:

**`repeatability-gate`** — calls `repeatability-mcp-server`. Validates that the implementation matches the frozen requirements lock file (`specs/<task>.lock.yaml`). Run on `implement` phase tasks. Detects requirement drift.

**`coding-standards-gate`** — calls `coding-standards-mcp-server`. Checks that the implementation satisfies coding standards compliance (traceability, scope drift, AC coverage, spec hash). Run on `implement` phase tasks.

Both backends are probed at startup. If the command path is not found, a warning is printed and the overlay is skipped — the workflow continues normally.

### Disabling remote overlays

```bash
# Disable all remote overlays for this run
AI_SDD_DISABLE_REMOTE_OVERLAYS=true ai-sdd run

# Disable specific overlay
AI_SDD_DISABLE_OVERLAY_REPEATABILITY_GATE=true ai-sdd run
AI_SDD_DISABLE_OVERLAY_CODING_STANDARDS_GATE=true ai-sdd run
```

Or set `enabled: false` in the `remote_overlays` config entry for a persistent disable.

---

## Expression DSL

Used in `exit_conditions`. No `eval()` — hand-written recursive-descent parser. All expressions are validated at workflow load time.

### Grammar

```
expr        ::= or_expr
or_expr     ::= and_expr ("or" and_expr)*
and_expr    ::= not_expr ("and" not_expr)*
not_expr    ::= "not" not_expr | comparison | "(" expr ")"
comparison  ::= path op literal | path op path
op          ::= "==" | "!=" | ">" | ">=" | "<" | "<="
path        ::= identifier ("." identifier)*
literal     ::= UPPERCASE_CONSTANT | "quoted string" | number | true | false | null
```

### Examples

```
review.decision == GO
confidence_score >= 0.85
policy_gate.verdict == PASS and hil.resolved == true
not (review.decision == NO_GO)
pair.challenger_approved == true
```

Unquoted uppercase identifiers (`GO`, `PASS`, `NO_GO`) are string literals. Lowercase identifiers are resolved as paths in the handover state. Missing paths return `false` — never throw.

---

## Human-in-the-Loop (HIL)

### When HIL Triggers

1. `overlays.hil.enabled: true` for the task (project default)
2. `risk_tier: T2` (always, regardless of `enabled`)
3. Context window threshold exceeded (direct mode only)

### HIL Workflow

1. Engine creates a HIL item in `.ai-sdd/sessions/<session>/hil/`
2. Task transitions to `HIL_PENDING`
3. Human reviews and resolves or rejects:

```bash
ai-sdd hil list                        # See pending items
ai-sdd hil show <id>                   # See full context
ai-sdd hil resolve <id> --notes "OK"   # Approve → task resumes
ai-sdd hil reject <id> --reason "..."  # Reject → task FAILED
```

4. Engine resumes from `HIL_PENDING` directly — the pre-overlay chain does not re-fire on resume (no duplicate HIL items).

### Notifications

```yaml
overlays:
  hil:
    notify:
      on_created:
        - "slack-notify --channel #ai-sdd 'HIL created: $HIL_ID'"
      on_t2_gate:
        - "email-alert --to tech-lead@example.com 'T2 gate: $TASK_ID'"
```

---

## Evidence Gate

### Risk Tiers

| Tier | Evidence Required |
|---|---|
| `T0` | Output files present |
| `T1` | Output + `tests_passed` or `lint_passed` in handover state |
| `T2` | T1 + `security_clean` + `operational_ready` + human sign-off |

Gate fail → `NEEDS_REWORK` with feedback injected into the next iteration.

---

## CLI Command Reference

### `run`

State is always auto-loaded from the active session's `workflow-state.json` when it exists. Delete the file to start fresh. `--resume` is a no-op kept for backward compatibility. Using `--feature` sets the active session automatically.

```bash
ai-sdd run [--project <dir>]

Options:
  --task <id>                  Run specific task + unmet dependencies
  --dry-run                    Print execution plan without LLM calls
  --step                       Pause after each parallel group
  --workflow <name>            Load .ai-sdd/workflows/<name>.yaml
  --feature <name>             Load specs/<feature>/workflow.yaml
  --standards <paths|none>     Override standards paths (comma-separated or "none")
```

### `status`

```bash
ai-sdd status [--project <dir>]

Options:
  --json              Full state as JSON
  --next --json       Next ready tasks only (DAG-aware — blocked PENDING excluded)
  --metrics           Add Tokens / Cost / Duration columns per task + footer totals
  --workflow <name>   Workflow name for DAG lookup
  --feature <name>    Feature/session name (uses active session if omitted)
```

Example `--metrics` output:

```
Task                 Status         Iter  Completed   Tokens      Cost
─────────────────────────────────────────────────────────────────────
implement            ✓ COMPLETED       1  2026-03-09   5.2s    15342    $0.0234
review               ✓ COMPLETED       2  2026-03-09   8.1s    12100    $0.0189
─────────────────────────────────────────────────────────────────────
Total: 2 | ✓ 2 | ✗ 0 | ○ 0 | ⊘ 0 | tokens: 27442 | cost: $0.0423
```

### `complete-task`

Called by agents when they finish a task:

```bash
ai-sdd complete-task \
  --task <id> \
  --output-path <path> \
  --content-file <tmp-path> \
  [--contract <contract-name>] \
  [--feature <name>]
```

**Transaction steps (atomic):**
1. Path traversal check (`../../` blocked)
2. Secret detection → `NEEDS_REWORK` if found
3. Injection detection → abort if found
4. Artifact contract validation
5. Atomic file write (tmp + rename)
6. State transition to `COMPLETED`
7. Manifest update in `.ai-sdd/constitution.md`

### `hil`

```bash
ai-sdd hil [--feature <name>] list [--json] [--project <dir>]
ai-sdd hil [--feature <name>] show <id> [--project <dir>]
ai-sdd hil [--feature <name>] resolve <id> [--notes <text>] [--project <dir>]
ai-sdd hil [--feature <name>] reject <id> [--reason <text>] [--project <dir>]
```

### `validate-config`

```bash
ai-sdd validate-config [--project <dir>]
```

Validates: `ai-sdd.yaml`, workflow YAML (including `use:`, `defaults:`, overlay constraints), default agents, custom agents.

### `constitution`

```bash
ai-sdd constitution [--task <id>] [--feature <name>] [--project <dir>]
```

Prints the full merged constitution to stdout (including standards). Sources printed to stderr. Use to verify exactly what agents receive.

### `init`

```bash
ai-sdd init --tool <name> [--project <dir>]

Tools: claude_code | codex | roo_code
```

### `sessions`

```bash
ai-sdd sessions list [--json] [--project <dir>]       # List all sessions
ai-sdd sessions active [--json] [--project <dir>]     # Show active session
ai-sdd sessions switch <name> [--project <dir>]       # Switch active session
ai-sdd sessions create <name> [--project <dir>]       # Create a new session
```

### `serve --mcp`

Stdio transport only. Configure your tool to connect via stdio.

```bash
ai-sdd serve --mcp [--project <dir>]
```

MCP tools: `get_next_task`, `get_workflow_status`, `complete_task`, `list_hil_items`, `resolve_hil`, `reject_hil`, `get_constitution`, `list_sessions`, `get_active_session`, `switch_session`. Tools that operate on workflow state accept an optional `feature` parameter (uses active session if omitted).

---

## Adapter Configuration

### Claude Code Adapter

```yaml
adapter:
  type: claude_code
  dispatch_mode: delegation    # delegation | direct
```

`delegation` — passes a lightweight task brief to the `claude` CLI; the subagent manages its own context via its `.claude/agents/<name>.md` file.

`direct` — the engine assembles the full prompt and streams the response directly (no subprocess). Used for API-only workflows.

Requires `claude` CLI on PATH.

### OpenAI Adapter

```yaml
adapter:
  type: openai
  dispatch_mode: direct
  model: gpt-4o
```

Requires `OPENAI_API_KEY` environment variable (or `api_key` in config).

### Mock Adapter

```yaml
adapter:
  type: mock
```

For testing and dry-runs. Always returns `COMPLETED` with empty outputs.

### Roo Code

`roo_code` is not a runtime adapter. Roo Code agents call the MCP server directly via `ai-sdd serve --mcp`. Set `adapter.type` to `claude_code`, `openai`, or `mock` for programmatic runs.

---

## Integration Guides

## Using Claude Code

1. Initialize:

```bash
ai-sdd init --tool claude_code --project /path/to/project
```

Creates: `.claude/agents/` (6 subagents), `.claude/skills/sdd-run/`, `.claude/skills/sdd-status/`, `CLAUDE.md`, `constitution.md`, `.ai-sdd/workflows/default-sdd.yaml`.

2. Fill in `constitution.md` with your project context.
3. Add standards files under `standards/` as needed (at minimum keep `AiAgent.md`).
4. Open the project in Claude Code.
5. Type `/sdd-run` — the skill identifies the next task, spawns the correct subagent, handles HIL approvals inline, and loops.
6. Type `/sdd-status` to check progress at any time.

## Using Codex CLI

1. Initialize:

```bash
ai-sdd init --tool codex --project /path/to/project
```

2. Start `codex` from the project root (reads `AGENTS.md`).
3. Operator loop:
   ```bash
   ai-sdd status --next --json       # find ready tasks
   ai-sdd run                        # run next available tasks
   ai-sdd hil list --json            # check for pending approvals
   ```
4. Continue until no PENDING tasks remain.

## Using Roo Code

1. Initialize:

```bash
ai-sdd init --tool roo_code --project /path/to/project
```

Creates: `.roomodes` (6 agent modes with MCP group), `.roo/mcp.json` (points to `ai-sdd serve --mcp`).

2. Start MCP server (or let Roo Code auto-start via `.roo/mcp.json`):

```bash
ai-sdd serve --mcp
```

3. Select the appropriate mode in Roo Code (e.g. `sdd-ba` for requirements, `sdd-dev` for implementation).

4. Agent tool sequence:

```
get_next_task      → find assigned work (DAG-aware)
get_constitution   → fetch project context
[do the work]
complete_task      → submit artifact (atomic, validated)
list_hil_items     → check pending HIL approvals
resolve_hil        → approve a HIL item
```

---

## Security

### Injection Detection

Scans task inputs for 20+ injection patterns:

```yaml
security:
  injection_detection_level: quarantine    # pass | warn | quarantine
```

| Level | Behaviour |
|---|---|
| `pass` | Log and continue |
| `warn` | Log warning, continue |
| `quarantine` | Block input, abort task |

### Secret Detection (Output)

Scans task outputs for secrets (AWS keys, API tokens, private keys, JWTs, etc.). If found → `NEEDS_REWORK` (output never written to disk). The agent must remove the secret and resubmit. Cannot be disabled.

### Log Sanitization

All observability events sanitized: secrets replaced with `[REDACTED:TYPE]`. Applies to logs only, not task output.

### Path Traversal

`complete-task` rejects any `--output-path` resolving outside the project root. `../../etc/passwd` → error.

---

## Config Reference

### `ai-sdd.yaml` — Full Options

```yaml
version: "1"

workflow: default-sdd

adapter:
  type: claude_code             # claude_code | openai | roo_code | mock
  dispatch_mode: delegation     # direct | delegation

engine:
  max_concurrent_tasks: 3
  cost_budget_per_run_usd: 10.00
  cost_enforcement: pause       # warn | pause | stop
  max_context_tokens: 180000

overlays:
  hil:
    enabled: true
    queue_path: ".ai-sdd/sessions/<active>/hil/"
    poll_interval_seconds: 5
    notify:
      on_created: []
      on_t2_gate: []

security:
  secret_patterns: []
  injection_detection_level: warn    # pass | warn | quarantine

constitution:
  strict_parse: true

observability:
  log_level: INFO                    # DEBUG | INFO | WARN | ERROR

standards:
  paths:                             # omit for auto-discovery from standards/
    - standards/AiAgent.md
    - standards/TypeScript.md
  strict: false                      # true = hard error on missing file
```

### Config Merge Order

`CLI flags` > `.ai-sdd/ai-sdd.yaml` > `framework defaults`

---

## Troubleshooting

### Schema version mismatch

```
schema version mismatch: expected '1', got '2'
```
→ State file written by a different version. Manual recovery: open `.ai-sdd/sessions/<session>/workflow-state.json` (or `.ai-sdd/state/workflow-state.json` for legacy layout), set `schema_version` to `"1"`.

### No workflow found

```
No workflow found. Create .ai-sdd/workflow.yaml or run: ai-sdd init
```
→ Run `ai-sdd init --tool <name>` first.

### Dependency cycle

```
Workflow contains a dependency cycle involving tasks: task-a, task-b
```
→ Fix `depends_on` chains in workflow YAML.

### DSL parse error at load

```
DSL parse error in task 'my-task' exit_condition: ParseError at position 5
```
→ Fix the `exit_conditions` expression. See [Expression DSL](#expression-dsl).

### Reviewer independence violation

```
Task 'implement': paired overlay enabled but challenger_agent equals driver_agent. Reviewer independence required.
```
→ `challenger_agent` must be a different agent from `driver_agent`. Same applies to `review.reviewer_agent` vs `coder_agent`.

### HIL item stuck

```bash
ai-sdd hil list     # find the item
ai-sdd hil resolve <id> --notes "approved"
```

### Secret in task output

```
Secret detected in task output (openai_key). Task set to NEEDS_REWORK.
```
→ Agent will be asked to resubmit without the secret.

### Remote overlay backend not found

```
[WARN] repeatability-gate: backend command not found — overlay skipped
```
→ The MCP server binary is not built or not at the configured path. Build it or disable the overlay with `AI_SDD_DISABLE_OVERLAY_REPEATABILITY_GATE=true`.

### Standards file not found

```
[WARN] Standards file not found: standards/MyStandard.md
```
→ File path in `standards.paths` does not exist. Fix the path or set `standards.strict: false` to warn-and-skip.
