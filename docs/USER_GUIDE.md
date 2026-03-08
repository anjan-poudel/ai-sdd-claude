# ai-sdd User Guide

## Overview

`ai-sdd` orchestrates multi-agent software development workflows. You define a DAG of tasks in YAML, and the framework dispatches each task to an LLM agent (Claude, OpenAI, or mock), managing state, retries, human approval (HIL), and evidence gates.

---

## Table of Contents

1. [Concepts](#concepts)
2. [Project Setup](#project-setup)
3. [Workflow YAML Reference](#workflow-yaml-reference)
4. [Agent Configuration](#agent-configuration)
5. [Constitution System](#constitution-system)
6. [Overlays](#overlays)
7. [Expression DSL](#expression-dsl)
8. [Human-in-the-Loop (HIL)](#human-in-the-loop-hil)
9. [Evidence Gate](#evidence-gate)
10. [CLI Command Reference](#cli-command-reference)
11. [Adapter Configuration](#adapter-configuration)
12. [Integration Guides](#integration-guides)
13. [Security](#security)
14. [Troubleshooting](#troubleshooting)

---

## Concepts

### Workflow
A YAML file defining a DAG (directed acyclic graph) of tasks. Tasks have agents, descriptions, dependencies, and overlays.

### Agent
A YAML file defining an LLM persona: model, hyperparameters, role description, responsibilities.

### Adapter
The runtime that executes tasks. Adapters: `claude_code`, `openai`, `mock`.

### Overlay
Post-processing around task execution: HIL gate, evidence gate, confidence scoring, agentic review, paired workflow.

### Constitution
A Markdown file (or `CLAUDE.md`) that describes the project to agents. The engine maintains a `## Workflow Artifacts` section automatically.

### HIL Queue
File-based queue of items awaiting human review. Agents pause at `HIL_PENDING` until a human resolves or rejects via CLI.

### Task States

| State | Meaning |
|---|---|
| `PENDING` | Not yet started — waiting for dependencies or to be dispatched |
| `RUNNING` | Dispatched to agent — in progress |
| `COMPLETED` | Done — output accepted and written |
| `NEEDS_REWORK` | Agent output rejected (gate fail, secret detected, review NO_GO) — will retry |
| `HIL_PENDING` | Paused — awaiting human approval via `ai-sdd hil` |
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
├── .ai-sdd/
│   ├── ai-sdd.yaml          # Project config
│   ├── workflow.yaml        # Custom workflow (optional — overrides workflows/)
│   ├── workflows/
│   │   └── default-sdd.yaml # Default SDD workflow (copied by init, edit freely)
│   ├── agents/              # Custom agent overrides (optional)
│   ├── state/               # Runtime state (auto-managed)
│   │   ├── workflow-state.json
│   │   └── hil/             # HIL queue items
│   └── outputs/             # Task artifacts
.claude/                     # Created by init --tool claude_code
├── agents/                  # sdd-ba, sdd-architect, sdd-pe, sdd-le, sdd-dev, sdd-reviewer
└── skills/
    ├── sdd-run/SKILL.md     # /sdd-run — full workflow loop
    └── sdd-status/SKILL.md  # /sdd-status — progress table
```

**Workflow lookup order** (first found wins for `run` and `complete-task`):
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
    queue_path: ".ai-sdd/state/hil/"
    notify:
      on_t2_gate:
        - "echo 'T2 gate triggered for task: $TASK_ID'"
```

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

This 6-line workflow is complete. Every template provides `agent`, `description`,
`overlays`, and `outputs`. Override any field inline when you need workflow-specific
context — omit it to use the template default.

### Full reference

```yaml
version: "1"
name: my-workflow
description: "Optional description"

# Workflow-level defaults — applied to every task; override per-task as needed
defaults:
  overlays:
    hil:         { enabled: false }   # e.g. disable HIL workflow-wide
    policy_gate: { risk_tier: T1 }    # e.g. set a uniform risk tier
  max_rework_iterations: 3

tasks:
  <task-id>:
    use: <library-template>        # Optional: pull from data/task-library/
    agent: <agent-name>            # Required (or supplied by use:)
    description: "What to do"     # Always required
    depends_on:                    # Optional
      - <other-task-id>
    outputs:                       # Optional (or supplied by use:)
      - path: relative/output.md
        contract: requirements_doc
    exit_conditions:               # Optional: DSL expressions
      - "review.decision == GO"
    overlays:                      # Optional: override defaults or library values
      hil:
        enabled: true
      policy_gate:
        risk_tier: T2
      confidence:
        threshold: 0.90
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

Overlay keys merge individually — setting `hil.enabled: false` does not clobber
`policy_gate.risk_tier`.

### Task Library (`use:`)

Bundled templates in `data/task-library/`. Templates define the invariant properties
of each task type (agent role, output contract). Policy overlays (HIL, risk tier) are
left to the workflow `defaults:` or per-task overrides — templates stay composable.

**Role primitives** — provide agent, contract and sensible defaults; policy set by workflow:

| Template | Agent | HIL | Risk | Contract |
|---|---|---|---|---|
| `define-requirements` | `ba` | on | T0 | `requirements_doc` |
| `design-architecture` | `architect` | on | T0 | `architecture_l1` |
| `design-component` | `pe` | off | T0 | `component_design_l2` |
| `plan-tasks` | `le` | off | T0 | `task_breakdown_l3` |
| `standard-implement` | `dev` | off | T1 | `implementation` |
| `standard-review` | `reviewer` | off | T1 | `review_report` |

**Named workflow stages** — complete task definitions; use directly by task ID:

| Template | Semantic | HIL | Risk | Contract |
|---|---|---|---|---|
| `review-l1` | L1 architecture review | off | T1 | `review_report` |
| `review-l2` | L2 component design review | off | T1 | `review_report` |
| `review-implementation` | Final code review | off | T1 | `review_report` |
| `security-design-review` | Security-focused design audit | off | T1 | `review_report` |
| `security-test` | Security testing pass | off | T1 | `review_report` |
| `final-sign-off` | T2 mandatory production gate | off | **T2** | `review_report` |

Every template provides a default `description`. Override inline to add workflow-specific
context for the LLM; omit to use the template default.

Output paths use `{{task_id}}` substitution: a task named `design-l1` gets
`.ai-sdd/outputs/design-l1.md`, `design-component-a` gets
`.ai-sdd/outputs/design-component-a.md`, etc.

A task using `use:` may omit `description` (uses template default), `agent`, `outputs`,
and `overlays` (all inherited from the template, merged with workflow defaults).

`depends_on` is always per-workflow — never part of a template.

**Parallel components → parallel reviews.** When a workflow has N parallel implementation
tasks, give each its own review task rather than a single combined review. Each review is
smaller, more focused, and can run in parallel with the others:

```yaml
  review-component-a:
    use: review-implementation
    depends_on: [implement-component-a]

  review-component-b:
    use: review-implementation
    depends_on: [implement-component-b]    # parallel with review-component-a
```

**Override examples:**

```yaml
tasks:
  # Override outputs — api-first produces two files instead of one
  design-api:
    use: design-architecture
    description: "Produce OpenAPI spec and design doc."
    depends_on: [define-requirements]
    outputs:
      - path: .ai-sdd/outputs/openapi.yaml
      - path: .ai-sdd/outputs/api-design.md

  # Override overlays — regulated workflow needs T2 on architecture
  design-l1:
    use: design-architecture
    description: "Produce L1 architecture with security considerations."
    depends_on: [define-requirements]
    overlays:
      hil:         { enabled: true }
      policy_gate: { risk_tier: T2 }
```

### Dependency Rules

- `depends_on` creates a dependency edge in the DAG.
- Circular dependencies are detected at load time (Kahn's algorithm).
- Tasks with no `depends_on` run first (parallel group 0).
- Tasks in the same parallel group run concurrently (up to `max_concurrent_tasks`).

---

## Agent Configuration

### Default Agents

Six default agents are bundled:

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
    You prioritize safety, performance, and idiomatic Rust.
  expertise:
    - Rust async/await
    - memory safety
    - CLI tools
  responsibilities:
    - implement features in idiomatic Rust
    - write comprehensive unit tests
```

### Inheritance (`extends`)

`extends: ba` merges all fields from `ba.yaml` into your agent. You only need to specify fields you want to override.

---

## Constitution System

The constitution provides project context to agents. It is:

1. **Loaded** from `constitution.md`, `.ai-sdd/constitution.md`, or `CLAUDE.md` in your project root.
2. **Merged** recursively (framework → root → submodules).
3. **Extended** with a `## Workflow Artifacts` table after each task completes.

### Example `constitution.md`

```markdown
# Project Constitution

## Overview
Building a REST API for user management using TypeScript and Bun.

## Tech Stack
- Runtime: Bun 1.x
- Language: TypeScript (strict)
- Database: PostgreSQL 16
- Auth: JWT (HS256)

## Conventions
- All endpoints return `{ data, error }` envelope
- HTTP status codes: 200, 201, 400, 401, 403, 404, 500
- Errors include `{ code, message }` in the `error` field
- Tests use `bun test` with 80% minimum coverage
```

### Artifact Manifest

After each completed task, the engine appends a manifest table:

```markdown
## Workflow Artifacts

| Task | Path | Contract | Status | Date |
|------|------|----------|--------|------|
| define-requirements | `.ai-sdd/outputs/requirements.md` | `requirements_doc` | COMPLETED | 2026-02-28 |
| design-l1 | `.ai-sdd/outputs/architecture-l1.md` | `architecture_l1` | COMPLETED | 2026-02-28 |
```

Agents read this to know what artifacts exist and where to find them.

---

## Overlays

### Overlay Chain Order (locked)

```
HIL → Evidence Gate → Agentic Review → Paired Workflow → Confidence → Agent Execution
```

### Per-Task Override

```yaml
tasks:
  risky-task:
    overlays:
      hil:
        enabled: true
        risk_tier: T2          # Force mandatory HIL
      policy_gate:
        risk_tier: T2
      review:
        enabled: true          # Enable agentic review loop
      confidence:
        threshold: 0.90        # Advisory only
```

### Disabling Overlays

```yaml
tasks:
  low-risk-task:
    overlays:
      hil:
        enabled: false         # Skip HIL for this task
```

Note: `risk_tier: T2` always triggers HIL regardless of the `enabled` flag.

---

## Expression DSL

Used in `exit_conditions`. No `eval()` — hand-written recursive-descent parser.

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
loop.iteration < 5
pair.challenger_approved == true
```

### Context

The evaluator resolves dot-paths in the task's handover state:
```json
{
  "review": { "decision": "GO" },
  "confidence_score": 0.87,
  "policy_gate": { "verdict": "PASS" }
}
```

Missing paths return `false` — never throw.

### Security

Disallowed constructs: `eval`, `exec`, `__import__`, `os`, `sys`, function calls, list indexing.
All expressions are validated at workflow load time — invalid expressions prevent the workflow from starting.

---

## Human-in-the-Loop (HIL)

### When HIL Triggers

1. `overlays.hil.enabled: true` (project default) for the task
2. `risk_tier: T2` (always, regardless of enabled flag)
3. Context threshold exceeded (95% by default) — in `direct` mode

### HIL Workflow

1. Engine creates a HIL item in `.ai-sdd/state/hil/`
2. Task transitions to `HIL_PENDING`
3. Human reviews and resolves or rejects:

```bash
ai-sdd hil list                       # See pending items
ai-sdd hil show <id>                  # See full context
ai-sdd hil resolve <id> --notes "OK"  # Approve → task resumes
ai-sdd hil reject <id> --reason "..."  # Reject → task FAILED
```

4. Engine polls the queue and resumes when resolved.

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
| `T1` | Output + tests passed + lint clean |
| `T2` | Output + tests + operational readiness + **human sign-off** |

### Gate Report

After each task, a gate report is written to `.ai-sdd/outputs/gate-report-<task-id>.json`:

```json
{
  "task_id": "implement",
  "risk_tier": "T1",
  "verdict": "PASS",
  "failures": [],
  "timestamp": "2026-02-28T10:00:00Z"
}
```

Gate fail → `NEEDS_REWORK` with feedback injected into the next iteration.

---

## CLI Command Reference

### `run`

State is always auto-loaded from `workflow-state.json` when it exists — delete it to start fresh. `--resume` is kept for backward compatibility but is a no-op.

```bash
ai-sdd run [options] [--project <dir>]

Options:
  --task <id>             Run specific task + unmet dependencies
  --dry-run               Print execution plan without LLM calls
  --step                  Pause after each parallel group
  --workflow <name>       Use named workflow from .ai-sdd/workflows/
  --feature <name>        Use workflow from specs/<feature>/workflow.yaml
  --standards <paths|none>  Override coding standards paths
```

### `status`

```bash
ai-sdd status [options] [--project <dir>]

Options:
  --json              Full state as JSON
  --next              Show next ready tasks (use with --json)
  --metrics           Include cost/token stats
```

### `complete-task`

Called by agents when they finish a task:

```bash
ai-sdd complete-task \
  --task <id> \
  --output-path <path> \
  --content-file <tmp-path> \
  [--contract <contract-name>] \
  [--allow-legacy-untyped-artifacts]
```

**Transaction steps:**
1. Path traversal check (`../../` blocked)
2. Secret detection → `NEEDS_REWORK` if found
3. Injection detection → abort if found
4. Artifact contract validation
5. Atomic file write (tmp + rename)
6. State transition to `COMPLETED`
7. Manifest update

### `hil`

```bash
ai-sdd hil list [--project <dir>]
ai-sdd hil show <id> [--project <dir>]
ai-sdd hil resolve <id> [--notes <text>] [--project <dir>]
ai-sdd hil reject <id> [--reason <text>] [--project <dir>]
```

### `validate-config`

```bash
ai-sdd validate-config [--project <dir>]
```

Validates: `ai-sdd.yaml`, workflow YAML (including `use:` and `defaults:` resolution), default agents, project agents.

### `constitution`

```bash
ai-sdd constitution [--task <id>] [--project <dir>]
```

### `init`

```bash
ai-sdd init --tool <name> [--project <dir>]

Tools: claude_code | codex | roo_code
```

### `serve --mcp`

Stdio transport only — no `--port` flag. Configure your tool to connect via stdio.

```bash
ai-sdd serve --mcp [--project <dir>]
```

MCP tools (7): `get_next_task`, `get_workflow_status`, `complete_task`, `list_hil_items`, `resolve_hil`, `reject_hil`, `get_constitution`.

---

## Adapter Configuration

### Claude Code Adapter

```yaml
adapter:
  type: claude_code
  dispatch_mode: delegation  # delegation | direct
```

Requires `claude` CLI on PATH. In `delegation` mode, the engine passes a lightweight task brief to `claude`; the tool manages its own context via CLAUDE.md.

### OpenAI Adapter

```yaml
adapter:
  type: openai
  dispatch_mode: direct
```

Requires `OPENAI_API_KEY` environment variable (or `api_key` in config).
Install: `bun add openai`

### Mock Adapter

```yaml
adapter:
  type: mock
```

For testing. Always returns COMPLETED with empty outputs.

---

## Integration Guides

Choose one integration per project UX (runtime adapter can still differ).

### Using Claude Code

1. Initialize integration:

```bash
ai-sdd init --tool claude_code --project /path/to/project
```

This creates the following files in the project:
- `.claude/agents/` — six subagents (sdd-ba, sdd-architect, sdd-pe, sdd-le, sdd-dev, sdd-reviewer)
- `.claude/skills/sdd-run/SKILL.md` — orchestrating skill that drives the full workflow
- `.claude/skills/sdd-status/SKILL.md` — progress table skill
- `CLAUDE.md` — ai-sdd orientation section appended (or created)
- `constitution.md` — blank template; fill in your project purpose and standards
- `.ai-sdd/workflows/default-sdd.yaml` — default workflow; edit to customise

2. Fill in `constitution.md` with your project context.
3. Open the project in Claude Code.
4. Type `/sdd-run` to start the autonomous workflow loop. The skill identifies the next task, spawns the correct agent, handles HIL approvals inline, and loops — no manual `ai-sdd` commands needed.
5. Type `/sdd-status` to check progress at any time.

### Using Codex CLI

1. Initialize integration:

```bash
ai-sdd init --tool codex --project /path/to/project
```

2. Start `codex` from the project root (it reads `AGENTS.md`).
3. Follow the same operator loop:
   - `ai-sdd status --next --json`
   - `ai-sdd run --resume`
   - `ai-sdd hil list --json`
4. Continue until no READY tasks remain.

### Using Roo Code

1. Initialize integration:

```bash
ai-sdd init --tool roo_code --project /path/to/project
```

This creates:
- `.roomodes` — 6 role-specific agent modes (sdd-ba, sdd-architect, sdd-pe, sdd-le, sdd-dev, sdd-reviewer), each with `mcp` group enabled
- `.roo/mcp.json` — MCP server config pointing to `ai-sdd serve --mcp`
- `.ai-sdd/ai-sdd.yaml` with `adapter.type: roo_code`

> **Note on adapter type**: `roo_code` is not a runtime adapter — Roo Code agents call the MCP server directly. The engine does not dispatch tasks; agents drive themselves via MCP tools. If you also want `ai-sdd run` to work programmatically, set `adapter.type: claude_code` or `openai` in `ai-sdd.yaml`.

2. Start MCP server (stdio transport — Roo Code auto-connects via `.roo/mcp.json`):

```bash
ai-sdd serve --mcp
```

Or let Roo Code launch it automatically from the `.roo/mcp.json` config.

3. Select a mode in Roo Code matching the intended agent role.

4. The mode's `customInstructions` guide the agent through the MCP tool sequence:

```
get_next_task           → find assigned work (DAG-aware, only unblocked tasks)
get_constitution        → fetch project context for the task
[do the work]
complete_task           → submit output artifact (atomic, validated)
list_hil_items          → check for pending HIL approvals
resolve_hil / reject_hil → respond to HIL requests
```

All 7 MCP tools are available: `get_next_task`, `get_workflow_status`, `complete_task`, `list_hil_items`, `resolve_hil`, `reject_hil`, `get_constitution`.

---

## Security

### Injection Detection

Scans task inputs for 20+ injection patterns. Configure sensitivity:

```yaml
security:
  injection_detection_level: quarantine  # pass | warn | quarantine
```

- `pass`: log and continue
- `warn`: log warning, continue
- `quarantine`: block input, abort task

### Secret Detection (Output)

Scans task outputs for secrets (AWS keys, API tokens, private keys, JWTs, etc.).
If found → task goes to `NEEDS_REWORK` (never written to disk).
The agent must remove the secret and resubmit.

This is **blocking** and cannot be disabled.

### Log Sanitization

All observability events are sanitized: secrets are replaced with `[REDACTED:TYPE]`.
This is non-blocking and applies to logs only (not to task output).

### Path Traversal

`complete-task` rejects any `--output-path` that resolves outside the project directory.
`../../etc/passwd` → error.

---

## Config Reference

### `ai-sdd.yaml` — Full Options

```yaml
version: "1"

workflow: default-sdd           # Workflow name

adapter:
  type: claude_code             # claude_code | openai | roo_code | mock
  dispatch_mode: direct         # direct | delegation

engine:
  max_concurrent_tasks: 3
  cost_budget_per_run_usd: 10.00
  cost_enforcement: pause       # warn | pause | stop

overlays:
  hil:
    enabled: true
    queue_path: ".ai-sdd/state/hil/"
    poll_interval_seconds: 5
    notify:
      on_created: []
      on_t2_gate: []

security:
  secret_patterns: []           # Additional regex patterns
  injection_detection_level: warn

constitution:
  strict_parse: true            # false = warn+skip on errors

observability:
  log_level: INFO               # DEBUG | INFO | WARN | ERROR
```

### Config Merge Order

`CLI flags` > `.ai-sdd/ai-sdd.yaml` > `framework defaults`

---

## Troubleshooting

### Schema version mismatch

```
schema version mismatch: expected '1', got '2'; run ai-sdd migrate
```
→ The state file or config was written by a different version. Run `ai-sdd migrate` (Phase 5).

### No workflow found

```
No workflow found. Create .ai-sdd/workflow.yaml or run: ai-sdd init
```
→ Run `ai-sdd init --tool <name>` first. This copies `default-sdd.yaml` to
`.ai-sdd/workflows/`. To use a custom workflow, create `.ai-sdd/workflow.yaml`.

### Dependency cycle

```
Workflow contains a dependency cycle involving tasks: task-a, task-b
```
→ Fix the `depends_on` chains in your workflow YAML.

### DSL parse error at load

```
DSL parse error in task 'my-task' exit_condition: ParseError at position 5: ...
```
→ Fix the `exit_conditions` expression. See [Expression DSL](#expression-dsl).

### HIL item stuck

If a HIL item is stuck in PENDING, use `ai-sdd hil list` to find it and `ai-sdd hil resolve <id>` to unblock.

### Secret in task output

```
Secret detected in task output (openai_key). Task set to NEEDS_REWORK.
```
→ The agent produced output containing a secret. It will be asked to resubmit without the secret.
