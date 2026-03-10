# ai-sdd Ecosystem Architecture

## Overview

The ai-sdd ecosystem is a set of composable tools that work together to deliver
**specification-driven, governed AI development**. Each component has a single
responsibility; they are loosely coupled via file system conventions and the MCP protocol.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Developer / Operator                        │
└───────────────┬─────────────────────────────────────────────────────┘
                │  /sdd-run  /sdd-status  ai-sdd hil  ai-sdd status
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Claude Code / Roo Code / Codex                   │
│                  (IDE / Agentic coding environment)                 │
└─────────────┬──────────────────────────────────────────────────────┘
              │ spawns subagents          │ MCP (stdio)
              │ via .claude/agents/       │
              ▼                           ▼
┌─────────────────────────┐   ┌──────────────────────────────────────┐
│    ai-sdd (core)        │   │         ai-sdd MCP Server            │
│                         │   │         (ai-sdd serve --mcp)         │
│  ┌──────────────────┐   │   │                                      │
│  │  Workflow Engine  │   │   │  get_next_task   complete_task       │
│  │  (DAG scheduler) │   │   │  get_constitution list_hil_items     │
│  └────────┬─────────┘   │   │  resolve_hil     reject_hil         │
│           │             │   │  get_workflow_status                  │
│  ┌────────▼─────────┐   │   └──────────────────────────────────────┘
│  │  Overlay Chain   │   │
│  │  HIL             │   │
│  │  Evidence Gate   │   │   ┌─────────────────────────────────────┐
│  │  Review          │   │   │   Remote Overlay MCP Servers        │
│  │  Paired          │   │◄──┤                                     │
│  │  Confidence      │   │   │  repeatability-mcp-server           │
│  └────────┬─────────┘   │   │  coding-standards-mcp-server        │
│           │             │   └─────────────────────────────────────┘
│  ┌────────▼─────────┐   │
│  │  State Manager   │   │
│  │  (atomic JSON)   │   │
│  └────────┬─────────┘   │
│           │             │
│  ┌────────▼─────────┐   │
│  │  Constitution    │   │
│  │  Resolver        │   │
│  │  + Standards     │   │
│  └──────────────────┘   │
└─────────────────────────┘
```

---

## Components

### 1. ai-sdd (Core Orchestrator)

**Repo:** `ai-sdd-claude`
**Runtime:** Bun + TypeScript
**Role:** Workflow orchestration engine. Owns the DAG, task state machine, overlay chain, and agent dispatch.

Key subsystems:

| Subsystem | Purpose |
|---|---|
| Workflow Engine | Topological sort, parallel group scheduling, concurrency limits |
| State Manager | Atomic JSON persistence (tmp + rename), schema versioning |
| Overlay Chain | 5 built-in overlays in fixed order; composition rules enforced at load time |
| Constitution Resolver | Merges project constitution + feature constitutions + standards |
| Agent Loader | YAML agent registry with `extends` inheritance |
| Adapter Layer | Pluggable runtimes: `claude_code`, `openai`, `mock` |
| CLI | `run`, `status`, `complete-task`, `hil`, `constitution`, `validate-config`, `init`, `serve` |
| MCP Server | 7 tools exposing the engine to Roo Code and other MCP clients |
| Remote Overlays | Native MCP client — calls external governance servers as post-task gates |

### 2. Claude Code (Agentic IDE)

**Role:** Runs the operator loop and the six role-specific subagents. The human interacts with Claude Code; Claude Code drives ai-sdd.

**Integration point:** `.claude/` directory created by `ai-sdd init --tool claude_code`:

```
.claude/
├── agents/
│   ├── sdd-ba.md          # Business Analyst subagent
│   ├── sdd-architect.md   # System Architect
│   ├── sdd-pe.md          # Principal Engineer
│   ├── sdd-le.md          # Lead Engineer
│   ├── sdd-dev.md         # Developer
│   └── sdd-reviewer.md    # Reviewer
└── skills/
    ├── sdd-run/SKILL.md   # /sdd-run — full operator loop
    └── sdd-status/SKILL.md # /sdd-status — progress table
```

**Operator loop (`/sdd-run`):**
1. `ai-sdd status --next --json` — find unblocked PENDING tasks
2. Spawn correct subagent for the task role
3. Subagent does the work, calls `ai-sdd complete-task` to submit
4. Handle any HIL approvals inline
5. Loop until no PENDING tasks remain

### 3. repeatability-mcp-server

**Repo:** `repeatability-mcp-server`
**Role:** Validates that an implementation matches the frozen requirements lock file. Detects requirement drift — catches when implementation scope has deviated from what was signed off.

**Integration:** Called as a `post_task` remote overlay on `implement` phase tasks via `overlay_invoke` tool. Non-blocking by default; verdict recorded as `overlay_evidence` on the task state.

**Lock file:** `specs/<task-id>.lock.yaml` — written after BA task + HIL sign-off; read by the gate on every subsequent implementation task.

### 4. coding-standards-mcp-server

**Repo:** `coding-standards`
**Role:** Enforces requirements-first development practices: traceability, scope drift, AC coverage, spec hash integrity.

**Integration:** Called as a `post_task` remote overlay on `implement` phase tasks. Non-blocking by default.

---

## Context Flow: What Agents Receive

Every agent receives a merged context assembled from four sources in this order:

```
1. Project constitution
   constitution.md + .ai-sdd/constitution.md + CLAUDE.md
   + specs/<feature>/constitution.md (if feature-scoped)

2. Workflow Artifacts manifest
   ## Workflow Artifacts table (auto-maintained in .ai-sdd/constitution.md)
   Lists every completed task's output path and contract.

3. Standards (appended as ## Coding Standards)
   standards/AiAgent.md     ← base behavioral standard, all agents
   standards/TypeScript.md  ← language standard (if present)
   standards/Java.md
   ...

4. Task definition
   Agent identity, description, outputs, acceptance criteria,
   handover state from predecessor tasks.
```

The `ai-sdd constitution` command prints exactly what agents receive for inspection.

---

## Data Flow: A Single Task

```
ai-sdd run
    │
    ├─ load workflow YAML (DAG, task library, defaults merge)
    ├─ load project config (ai-sdd.yaml)
    ├─ resolve constitution + standards
    │
    ▼
Find next PENDING task (dependencies all COMPLETED)
    │
    ▼
Pre-task overlay chain ─────────────────────────────────────────────┐
    HIL overlay.preTask()          → may create HIL item, await      │
    EvidenceGate.preTask()         → no-op pre-task                  │
    ReviewOverlay.preTask()        → no-op                           │
    PairedOverlay.preTask()        → no-op                           │
    ConfidenceOverlay.preTask()    → no-op                           │
────────────────────────────────────────────────────────────────────┘
    │
    ▼
Adapter dispatch (claude_code / openai / mock)
    │
    Agent executes task
    Agent calls: ai-sdd complete-task --task <id> --output-path <path>
    │
    ▼
complete-task (atomic transaction):
    path allowlist check
    secret scan         → NEEDS_REWORK if secret found
    injection scan      → abort if injection found
    contract validate   → verify output matches declared contract
    atomic write        → tmp + rename
    state → COMPLETED
    manifest update     → ## Workflow Artifacts in constitution.md
    │
    ▼
Post-task overlay chain ────────────────────────────────────────────┐
    HIL overlay.postTask()         → T2 risk triggers HIL           │
    EvidenceGate.postTask()        → validate risk tier evidence     │
    ReviewOverlay.postTask()       → GO/NO_GO reviewer loop         │
    PairedOverlay.postTask()       → challenger approval loop       │
    ConfidenceOverlay.postTask()   → score evaluation               │
────────────────────────────────────────────────────────────────────┘
    │
    ▼
Remote overlay post-task hooks
    repeatability-gate   → lock file drift check (non-blocking)
    coding-standards-gate → standards compliance check (non-blocking)
    │
    ▼
Final verdict ──────────────────────────────────────────────────────
    accept: true  → task stays COMPLETED
    accept: false → task → NEEDS_REWORK (with feedback for next iter)
                    or FAILED (if max_iterations exceeded)
────────────────────────────────────────────────────────────────────
```

---

## State Machine

```
PENDING ──────► RUNNING ──────► COMPLETED  (terminal)
                   │
                   ├──► NEEDS_REWORK ──► RUNNING (retry)
                   │                     └──► FAILED (max iter)
                   │
                   ├──► HIL_PENDING ──► RUNNING (on resolve)
                   │                    └──► FAILED (on reject)
                   │
                   └──► FAILED     (terminal)

CANCELLED (terminal — from any state via explicit cancel)
```

All transitions enforced by `VALID_TRANSITIONS` map in `src/types/index.ts`. Invalid transitions throw `StateError`.

---

## Standards Pipeline

```
standards/
├── AiAgent.md       ← always first (base behavioral standard for all agents)
├── Java.md          ← language standards (auto-discovered alphabetically)
├── Kotlin.md
└── TypeScript.md

Auto-discovery:  all *.md under standards/ sorted alphabetically
Override:        standards.paths in ai-sdd.yaml  OR  --standards CLI flag
Disable:         standards.paths: []             OR  --standards none
Inspect:         ai-sdd constitution (shows <!-- standards: path --> markers)
```

Every agent — BA, architect, PE, LE, developer, reviewer — receives all standards. Standards are appended after the project constitution as the `## Coding Standards` section.

---

## Overlay Composition Rules

Overlay chain order is fixed and enforced at startup by `src/overlays/composition-rules.ts`.

```
HIL → Evidence Gate → Agentic Review → Paired Workflow → Confidence
```

**Mutual exclusion:** Agentic Review and Paired Workflow cannot both be enabled on the same task.

**Reviewer independence:** Validated at workflow load time:
- `review.reviewer_agent` ≠ `review.coder_agent`
- `paired.challenger_agent` ≠ `paired.driver_agent`
- `confidence.llm_judge.evaluator_agent` ≠ task agent

**T2 always triggers HIL** regardless of `hil.enabled`.

---

## Setup Guide

### Prerequisites

```bash
# Bun runtime
curl -fsSL https://bun.sh/install | bash

# ai-sdd CLI
cd ai-sdd-claude
bun install
bun link    # makes 'ai-sdd' available globally
```

### New project setup

```bash
# 1. Initialize
cd /your/project
ai-sdd init --tool claude_code

# 2. Edit constitution.md — describe what you're building
cat > constitution.md << 'EOF'
# Project Constitution

## Overview
[What is this project?]

## Tech Stack
[Runtime, language, framework, database]

## Conventions
[Naming, error handling, testing approach]
EOF

# 3. Review and edit the workflow
cat .ai-sdd/workflows/default-sdd.yaml
# Edit to match your project phases

# 4. Add standards
# AiAgent.md is the base — always include it
# Add technology standards as needed:
ls standards/    # see what's there

# 5. Validate config
ai-sdd validate-config

# 6. Dry run to preview execution plan
ai-sdd run --dry-run

# 7. Run
ai-sdd run
# Or via Claude Code: /sdd-run
```

### Setting up remote overlays

```bash
# Build repeatability MCP server
cd /path/to/repeatability-mcp-server
npm install && npm run build

# Build coding-standards MCP server
cd /path/to/coding-standards/tools/mcp-server
npm install && npm run build

# Configure in ai-sdd.yaml
# (paths should point to the built dist/index.js files)
# Then verify they're detected:
ai-sdd run --dry-run
# Look for: "repeatability-gate: backend ready" in output
```

### Feature workflow setup

For feature-scoped work alongside an existing project:

```bash
# Create feature directory
mkdir -p specs/my-feature

# Feature-specific workflow
cat > specs/my-feature/workflow.yaml << 'EOF'
version: "1"
name: my-feature

tasks:
  implement:
    use: standard-implement
    description: "Implement the my-feature capability"
    depends_on: []

  review:
    use: review-implementation
    depends_on: [implement]
EOF

# Optionally add a feature constitution
# specs/my-feature/constitution.md

# Run feature workflow
ai-sdd run --feature my-feature
```

---

## Idempotency and Resume

`ai-sdd run` always auto-loads persisted state. Delete `.ai-sdd/state/workflow-state.json` to start fresh.

Every adapter dispatch uses two keys:

| Key | Format | Purpose |
|---|---|---|
| `operation_id` | `workflow:task:run` | Stable across retries — sent to provider for deduplication |
| `attempt_id` | `workflow:task:run:attempt_N` | Changes per retry — used in observability only |

---

## Observability

All workflow events are emitted via `ObservabilityEmitter` and written to structured logs:

```
workflow.started / workflow.completed / workflow.failed
task.started / task.completed / task.failed / task.rework / task.retrying
hil.created / hil.acked / hil.resolved / hil.rejected
gate.pass / gate.fail
confidence.computed
context.assembled / context.warning
cost.warning
security.violation
overlay.remote.connecting / overlay.remote.connected / overlay.remote.invoked
overlay.remote.decision / overlay.remote.failed / overlay.remote.fallback
```

Log level: `DEBUG | INFO | WARN | ERROR` (set via `observability.log_level` in `ai-sdd.yaml`).

Secrets in log output are automatically redacted as `[REDACTED:TYPE]`.

Cost and token usage are persisted on the task state after `COMPLETED` — visible via `ai-sdd status --metrics`.
