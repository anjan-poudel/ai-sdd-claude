# ai-sdd

AI-driven Software Design & Development orchestration framework.

`ai-sdd` runs YAML-defined multi-agent workflows where each task is dispatched to an LLM agent (Claude Code, OpenAI, or mock), with overlays for human-in-the-loop (HIL), evidence-gated reviews, confidence scoring, and paired workflows.

## Quick Start

```bash
# Install
bun install

# Initialize in your project
ai-sdd init --tool claude_code --project /path/to/project

# Dry run to see execution plan
ai-sdd run --dry-run

# Execute workflow
ai-sdd run

# Check status
ai-sdd status
```

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- Node.js ≥ 18 (optional, for npm ecosystem compatibility)
- `claude` CLI on PATH (for ClaudeCode adapter)

## Installation

```bash
git clone <repo>
cd ai-sdd-claude
bun install
bun run src/cli/index.ts --help
```

## Project Setup

### 1. Initialize

```bash
# Claude Code integration
ai-sdd init --tool claude_code --project /your/project

# OpenAI / Codex integration
ai-sdd init --tool codex --project /your/project

# Roo Code integration
ai-sdd init --tool roo_code --project /your/project
```

For `claude_code`, this also creates:
```
.claude/
├── agents/              # sdd-ba, sdd-architect, sdd-pe, sdd-le, sdd-dev, sdd-reviewer
└── skills/
    ├── sdd-run/         # /sdd-run — orchestrates full workflow loop
    └── sdd-status/      # /sdd-status — progress table
CLAUDE.md                # ai-sdd orientation appended
constitution.md          # blank template (fill in your project context)
.ai-sdd/
├── ai-sdd.yaml          # Project config
├── workflows/
│   └── default-sdd.yaml # Default SDD workflow (edit to customise)
├── state/               # Workflow state (auto-managed)
│   └── hil/             # HIL queue items
└── outputs/             # Task artifacts
```

### 2. Create a Workflow

Edit `.ai-sdd/workflows/default-sdd.yaml` (copied by `init`) or create `.ai-sdd/workflow.yaml`:

```yaml
version: "1"
name: my-workflow

tasks:
  implement:
    use: standard-implement   # agent, description, overlays, outputs — all from template
    depends_on: []

  review:
    use: standard-review      # agent, description, overlays, outputs — all from template
    depends_on: [implement]
```

Override any field inline when you need workflow-specific context. See
`data/workflows/examples/` for complete patterns (quickfix, agile-feature,
greenfield, regulated-enterprise, etc.).

### 3. Create a Constitution

Create `constitution.md` (or `CLAUDE.md`) in your project root:

```markdown
# Project Constitution

## Project Overview
Brief description of what you're building.

## Tech Stack
- Language: TypeScript
- Runtime: Bun
- Database: PostgreSQL
```

### 4. Configure Adapter

Edit `.ai-sdd/ai-sdd.yaml`:

```yaml
version: "1"

adapter:
  type: claude_code  # or: openai, mock

engine:
  max_concurrent_tasks: 3
  cost_budget_per_run_usd: 10.00

overlays:
  hil:
    enabled: true
```

## CLI Reference

### `ai-sdd run`

Execute or resume a workflow. State is always auto-loaded if `workflow-state.json` exists — delete it to start fresh.

```bash
ai-sdd run                          # Run (resumes automatically if state file exists)
ai-sdd run --task design-l1        # Run specific task + unmet deps
ai-sdd run --dry-run               # Print plan without executing
ai-sdd run --step                  # Pause after each task group
```

### `ai-sdd status`

```bash
ai-sdd status                      # Human-readable table
ai-sdd status --json               # Full state as JSON
ai-sdd status --next --json        # Next ready tasks (for MCP)
ai-sdd status --metrics            # With cost/token stats
```

### `ai-sdd complete-task`

Atomic task completion (used by agents, not humans directly):

```bash
ai-sdd complete-task \
  --task define-requirements \
  --output-path .ai-sdd/outputs/requirements.md \
  --content-file /tmp/output.md \
  --contract requirements_doc
```

### `ai-sdd hil`

Manage human-in-the-loop queue:

```bash
ai-sdd hil list                    # List pending items
ai-sdd hil show <id>               # Show item details
ai-sdd hil resolve <id> --notes "LGTM"
ai-sdd hil reject <id> --reason "Missing requirements"
```

### `ai-sdd constitution`

```bash
ai-sdd constitution                # Print merged constitution
ai-sdd constitution --task design-l1  # Task-scoped constitution
```

### `ai-sdd validate-config`

```bash
ai-sdd validate-config             # Validate all YAML configs
```

### `ai-sdd init`

```bash
ai-sdd init --tool claude_code
ai-sdd init --tool codex
ai-sdd init --tool roo_code
```

### `ai-sdd serve --mcp`

Start as MCP server (stdio transport — no `--port`):

```bash
ai-sdd serve --mcp
```

### `ai-sdd migrate`

Schema migration (Phase 5 — stub in Phase 1):

```bash
ai-sdd migrate --dry-run
ai-sdd migrate --from 1 --to 2
```

## Architecture

### Overlay Chain (locked order)

```
HIL (default ON) → Evidence Gate → Agentic Review → Paired Workflow → Confidence Loop → Agent Execution
```

### Task State Machine

```
PENDING → RUNNING → COMPLETED
                │
                ├── NEEDS_REWORK → RUNNING  (gate fail / reviewer NO_GO)
                │         └────── FAILED    (max iterations)
                ├── HIL_PENDING  → RUNNING  (HIL resolved)
                │         └────── FAILED    (HIL rejected)
                └── FAILED
```

### Adapter Dispatch Modes

| Mode | Who assembles context | Used by |
|---|---|---|
| `direct` | Engine builds full prompt | OpenAI, ClaudeCode headless |
| `delegation` | Engine passes task brief only | ClaudeCode interactive, Roo Code |

### Evidence Gate Risk Tiers

| Tier | Evidence Required | HIL |
|---|---|---|
| `T0` | Acceptance only | No |
| `T1` | Acceptance + tests/lint | No |
| `T2` | Acceptance + tests + operational readiness | **Always** |

### `complete-task` Transaction

1. Validate output path (no `../../` traversal)
2. Security scan: secrets → `NEEDS_REWORK`, injection → abort
3. Artifact contract validation
4. Atomic write (tmp + rename)
5. Update workflow state → `COMPLETED`
6. Update constitution manifest

## Default Agents

| Agent | Role | Model |
|---|---|---|
| `ba` | Business Analyst | claude-sonnet-4-6 |
| `architect` | System Architect | claude-opus-4-6 |
| `pe` | Principal Engineer | claude-opus-4-6 |
| `le` | Lead Engineer | claude-sonnet-4-6 |
| `dev` | Developer | claude-sonnet-4-6 |
| `reviewer` | Reviewer | claude-opus-4-6 |

### Custom Agents

Create `.ai-sdd/agents/my-agent.yaml`:

```yaml
name: my-dev
display_name: "Senior Developer"
version: "1"
extends: dev           # inherit from dev
llm:
  model: claude-opus-4-6  # override model
role:
  description: "Senior developer with TypeScript expertise"
```

## Expression DSL

Used in `exit_conditions` and gate expressions. No `eval()` anywhere.

```yaml
exit_conditions:
  - "review.decision == GO"
  - "confidence_score >= 0.85"
  - "policy_gate.verdict == PASS and hil.resolved == true"
  - "not (review.decision == NO_GO)"
```

Allowed: path lookups, comparisons, `and`, `or`, `not`, literals.
Disallowed: function calls, imports, list indexing, arithmetic.

## Schema Versioning

All schemas carry `version: "1"`. Version mismatch → hard error:
```
schema version mismatch; run ai-sdd migrate
```

## Security

- Injection detection: 20 patterns, configurable `pass`/`warn`/`quarantine` level
- Secret detection in task outputs → `NEEDS_REWORK` (blocking)
- Secret redaction (`[REDACTED:TYPE]`) in logs/events only (non-blocking)
- Path traversal prevention in `complete-task`
- All DSL expressions validated at workflow load time

## MCP Integration

The MCP server exposes 7 tools that delegate to the `ai-sdd` CLI:

- `get_next_task` — next ready tasks (DAG-aware: only unblocked PENDING tasks)
- `get_workflow_status` — full workflow state
- `complete_task` — atomic task completion
- `list_hil_items` — pending HIL queue
- `resolve_hil` — approve HIL item
- `reject_hil` — reject HIL item
- `get_constitution` — project constitution

Start with: `ai-sdd serve --mcp` (stdio transport)

## Further Reading

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — full operator guide (setup, daily loop, HIL, troubleshooting)
- [specs/CONTRACTS.md](specs/CONTRACTS.md) — canonical enum values and invariants
- [specs/](specs/) — original design specs and task breakdowns

## Development

```bash
bun install                         # Install dependencies
bun test                            # Run full test suite
bun test tests/dsl.test.ts          # Run DSL tests only
bun run typecheck                   # TypeScript strict check
bun run src/cli/index.ts --help    # Verify CLI works
```

## License

MIT
