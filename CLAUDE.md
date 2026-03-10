# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What ai-sdd Is

`ai-sdd` is an AI-driven Software Design & Development orchestration framework. It runs YAML-defined multi-agent workflows where each task is dispatched to an LLM agent (via Claude Code, OpenAI, or Roo Code adapters), with overlays for human-in-the-loop (HIL), evidence-gated reviews, confidence scoring, and paired workflows.

**Runtime**: Bun. **Language**: TypeScript strict mode. **Schema validation**: Zod v3.

## Commands

```bash
bun install                         # install deps
bun test                            # run all tests
bun test tests/dsl.test.ts          # run a single test file
bun test --watch                    # watch mode
bun run typecheck                   # tsc --noEmit
bun run src/cli/index.ts --help     # CLI
```

No build step — Bun runs TypeScript directly. Import paths use `.ts` extensions and `@/*` aliases into `src/`.

## Architecture

```
src/
  types/index.ts          # canonical enums, interfaces (TaskStatus, VALID_TRANSITIONS,
                          # WorkflowDefaults, ENGINE_TASK_DEFAULTS, etc.)
  dsl/                    # recursive-descent parser + evaluator (no eval())
  core/
    engine.ts             # workflow orchestrator — dispatches tasks, manages concurrency
    state-manager.ts      # atomic state persistence (tmp+rename pattern)
    workflow-loader.ts    # Kahn's topological sort + cycle detection; resolves
                          # engine defaults → workflow defaults → use: → task inline
    agent-loader.ts       # AgentRegistry with YAML `extends` inheritance
    context-manager.ts    # assembles prompts for direct-mode dispatch
    hooks.ts              # pre/post task hook registry
    session-resolver.ts   # multi-session path resolution (SessionContext)
  adapters/               # base-adapter.ts interface; mock, claude-code, openai impls
  overlays/               # HIL, policy-gate, review, paired, confidence
  cli/commands/           # one file per CLI subcommand
  constitution/           # resolver.ts merges root + specs/*/constitution.md + submodules
                          # manifest-writer.ts writes artifact index to constitution.md
  security/               # input/output sanitizers, secret pattern matching
  observability/          # event emitter, cost tracker, log sanitizer
  artifacts/              # registry, validator, compatibility
  integration/mcp-server/ # MCP server implementation

data/
  workflows/              # default-sdd.yaml + examples/
  agents/defaults/        # 6 default agent YAMLs
  task-library/           # 12 reusable templates (use: targets):
                          #   Role primitives: define-requirements, design-architecture,
                          #     design-component, plan-tasks, standard-implement, standard-review
                          #   Named stages: review-l1, review-l2, review-implementation,
                          #     security-design-review, security-test, final-sign-off
  integration/
    claude-code/          # agent .md files + skill SKILL.md files (copied by init)
  artifacts/schema.yaml
```

## Key Invariants

**Task state machine** — transitions enforced by `VALID_TRANSITIONS` in `src/types/index.ts`:
```
PENDING → RUNNING → COMPLETED
                ├── NEEDS_REWORK → RUNNING (or FAILED on max iterations)
                ├── HIL_PENDING  → RUNNING (or FAILED on rejection)
                └── FAILED
```
Invalid transitions throw `StateError`.

**HIL resume** — when the engine encounters a task in `HIL_PENDING` state (from persisted state), it skips the pre-overlay chain and calls `awaitResolution()` directly using the stored `hil_item_id`. This prevents the state machine reset bug where pre-overlays would fire again and create duplicate HIL items. See `specs/tasks/T025-hil-resume-state-reset.md`.

**Auto-resume** — `ai-sdd run` always loads persisted state if a state file exists. The `--resume` flag is kept for backward compatibility but is now a no-op. There is no way to force a fresh run while a state file is present; delete the session's `workflow-state.json` to start over (e.g. `.ai-sdd/sessions/default/workflow-state.json` or `.ai-sdd/state/workflow-state.json` in legacy layout).

**Overlay chain order is locked** (enforced by `src/overlays/composition-rules.ts`):
```
HIL → Evidence Gate → Agentic Review → Paired Workflow → Confidence → Agent Execution
```
Paired and Review are mutually exclusive. T2 risk tier always triggers HIL.

**`complete-task` is the single atomic transaction boundary** (`src/cli/commands/complete-task.ts`):
path-allowlist → sanitize → contract-validate → write → state-update → manifest-update.
MCP server delegates to this command; it never writes files directly.

**Adapter output validation** — the engine always validates adapter-returned outputs via `src/security/output-validator.ts` before transitioning to COMPLETED, regardless of adapter type. This enforces path allowlist, path traversal detection, and secret scanning for direct-dispatch adapters (OpenAI, mock) that write files themselves rather than via `complete-task`. Secrets → `NEEDS_REWORK`; path violations → `FAILED`.

**Confidence threshold is enforced** — `ConfidenceOverlay` gates task completion when `score < threshold`. A score below threshold returns `accept: false, new_status: NEEDS_REWORK` with feedback. Set `threshold: 0` to restore advisory-only behaviour. Default threshold: `0.7`.

**`status --next --json` is DAG-aware** — only PENDING tasks whose declared `depends_on` are all COMPLETED are returned as ready tasks. Blocked tasks are excluded even if their status is PENDING.

**Workflow defaults + task library** — `workflow-loader.ts` applies a 4-layer merge per task: `ENGINE_TASK_DEFAULTS` → workflow `defaults:` block → task library template (`use:`) → task inline. Engine built-ins: `hil.enabled=true`, `policy_gate.risk_tier=T1`, `max_rework_iterations=3`. Overlay keys merge individually (not whole-object replace). `{{task_id}}` in library output paths is substituted at load time.

**Multi-session support** — `.ai-sdd/` supports concurrent feature sessions:
```
.ai-sdd/
├── ai-sdd.yaml              # shared base config
├── active-session            # text file → session name (e.g. "roundtrip-travel")
├── sessions/                 # per-session runtime state
│   ├── default/              # greenfield (no --feature)
│   │   ├── workflow-state.json
│   │   ├── hil/
│   │   ├── outputs/
│   │   ├── pair-sessions/
│   │   └── review-logs/
│   └── <feature-name>/      # feature session
├── workflows/                # shared workflow definitions
└── agents/                   # shared agents
```
Legacy flat layout (`.ai-sdd/state/`) is auto-detected and supported.
Feature overrides: `specs/<feature>/.ai-sdd/ai-sdd.yaml` is deep-merged over root config.

**Output structure** — `.ai-sdd/` is runtime-only (state, HIL queue, workflow engine files). Workflow artifacts go in `specs/`:
- Greenfield project: `specs/<task-id>.md` (e.g. `specs/define-requirements.md`, `specs/design-l1.md`)
- Feature artifacts: `specs/<feature>/<task-id>.md` (e.g. `specs/my-feature/design-l1.md`)
- Task breakdown: `specs/<task-id>/plan.md` + `specs/<task-id>/tasks/` (hierarchical, Jira-style TG-NN/T-NNN)
- Workflow definitions: `specs/workflow.yaml` (greenfield) or `specs/<feature>/workflow.yaml` (feature)
- Requirements lock: `specs/<task-id>.lock.yaml` — immutable snapshot produced after BA HIL sign-off; consumed by downstream tasks for drift detection

**Artifact contracts** (`data/artifacts/schema.yaml`) — registered types:
- `requirements_doc` — BA index (`## Summary`, `## Contents`)
- `requirements_lock` — immutable YAML snapshot (fields: `spec_hash`, `locked_at`, `requirements`)
- `spec_hash` — content fingerprint (fields: `hash`, `source_paths`)
- `architecture_l1` — L1 arch doc (`## Overview`, `## Architecture`, `## Components`)
- `component_design_l2` — L2 component design
- `task_breakdown_l3` — LE task plan (`## Summary`, `## Contents`)
- `implementation` — developer output (field: `description` required)
- `review_report` — review outcome (`## Summary`, `## Decision`; field: `decision` required)
- `spec_gate_report` — pre-implementation gate (`## Evidence Checklist`, `## HIL Sign-Off`)

**Workflow lookup order** (first found wins, `run` and `complete-task`):
1. `--workflow <name>` → `.ai-sdd/workflows/<name>.yaml`
2. `--feature <name>` → `specs/<feature>/workflow.yaml`
3. `specs/workflow.yaml` (greenfield — workflow lives alongside specs docs)
4. `.ai-sdd/workflow.yaml` (backward compat)
5. `.ai-sdd/workflows/default-sdd.yaml`
6. Bundled framework default

**Coding standards enforcement** — standards docs are merged into the constitution so every agent receives them. Auto-discovered from `standards/**/*.md` in the project root (sorted alphabetically). Override via:
- `--standards <paths>` CLI flag: comma-separated paths relative to project root, or `none` to disable
- `standards.paths` in `ai-sdd.yaml`: explicit list (empty `[]` disables)
- `standards.strict: true`: makes missing standards files a hard error (default: warn)

**Remote overlay integrations** — two MCP servers are wired into ai-sdd via native remote overlay support and configured in `.ai-sdd/ai-sdd.yaml`:
- `repeatability-gate`: calls `repeatability-mcp-server` (`lock_validate` tool) as a `post_task` overlay on `implement` tasks. Validates requirement lock drift. Backend at `/Users/anjan/workspace/projects/ai/repeatability-mcp-server/dist/index.js`.
- `coding-standards-gate`: calls `coding-standards-mcp-server` (`check_requirements` tool) as a `post_task` overlay on `implement` tasks. Backend at `/Users/anjan/workspace/projects/coding-standards/tools/mcp-server/dist/index.js` (warn-on-build if not built).

Both are `blocking: false` (non-blocking) and `failure_policy: warn`. At `ai-sdd run` startup, each backend's command path is probed; if not found, a warning is printed and the overlay is skipped. Disable mechanisms:
- `AI_SDD_DISABLE_REMOTE_OVERLAYS=true` — skip all remote overlays for the run
- `AI_SDD_DISABLE_OVERLAY_<NAME>=true` — skip one overlay by name (uppercase, hyphens→underscores), e.g. `AI_SDD_DISABLE_OVERLAY_REPEATABILITY_GATE=true`
- `enabled: false` in the `remote_overlays` config entry — persistent disable, no warning

**Expression DSL** — all `exit_conditions` and gate expressions go through `src/dsl/parser.ts` + `evaluator.ts`. No `eval()` or `exec()` anywhere in the codebase.

**Secret in task output → `NEEDS_REWORK`** (not silent redaction). Redaction applies to logs/observability only.

## Idempotency Keys

- `operation_id`: `workflow_id:task_id:task_run_id` — stable across retries; sent to provider
- `attempt_id`: `workflow_id:task_id:task_run_id:attempt_N` — changes per retry; observability only

## Config Merge Order

`CLI flags` > `project .ai-sdd/ai-sdd.yaml` > `src/config/defaults.ts`

## Schema Versioning

Every state file carries `schema_version: "1"`. Version mismatch at startup → hard error.

## CLI Commands Reference

```
ai-sdd run [--resume] [--task <id>] [--dry-run] [--step] [--workflow <name>] [--feature <name>] [--standards <paths|none>]
           # --resume is a no-op; state is always auto-loaded if the state file exists
ai-sdd status [--json] [--next --json] [--metrics] [--workflow <name>] [--feature <name>]
ai-sdd complete-task --task <id> --output-path <path> --content-file <tmp> [--feature <name>]
ai-sdd validate-config           # checks all 6 workflow search paths (same order as run)
ai-sdd constitution [--task <id>] [--feature <name>]
ai-sdd hil [--feature <name>] list [--json] | show <id> | resolve <id> [--notes] | reject <id> [--reason]
ai-sdd sessions list [--json] | active [--json] | switch <name> | create <name>
ai-sdd init --tool <name> [--project <path>]   # tool: claude_code | openai | roo_code
ai-sdd serve --mcp                             # stdio transport only — no --port
ai-sdd migrate [--dry-run] [--from N --to N]   # exits 1 — not yet implemented
```

## Development Standards

These rules are derived from post-implementation gap analysis (`specs/GAP-RETROSPECTIVE.md`).
They are binding — violating them is the same class of error as a failing test.

1. **Config-to-behaviour tests**: Every config field and CLI flag must have a test that changes the field and asserts different runtime behaviour. If no such test can be written, the feature is not yet implemented.

2. **Integration point tests**: When component A is wired into component B, write a test that verifies A is called when B runs. Unit tests of A in isolation are insufficient for wiring verification.

3. **No silent stubs**: Deferred features must throw or return an explicit failure with an actionable message. Returning a successful result without doing the work is forbidden.

4. **External schema fixtures**: Integration with any external CLI or API must be tested against a fixture of real captured output. Do not test against an assumed schema.

5. **Error messages are contracts**: Every error message that says "X happened" must be verified by a test that confirms X actually happened (state transition, file written, event emitted).

6. **No empty directories**: A directory must contain at least one file on the day it is created. Empty directories are dangling references.

7. **One integration test per CLI command**: Each CLI command should have at least one end-to-end test exercising it with a real (but in-process) project directory, not just unit tests of the underlying functions.

## Specs

The `specs/` directory contains the original planning documents. `specs/CONTRACTS.md` is the canonical reference for enum values, transaction boundaries, and development invariants (§13). `specs/GAP-RETROSPECTIVE.md` documents the root causes of all 24 post-implementation gaps and their prevention patterns. Individual task specs live in `specs/tasks/T*.md`.

---

## ai-sdd: Specification-Driven Development

This project uses ai-sdd. The framework runs under the hood — you do not need to
run any ai-sdd commands manually.

## How to use
- Type `/sdd-run` to execute the next workflow task.
- Answer clarifying questions and approve HIL gates as they appear.
- Type `/sdd-status` to check progress at any time.

## Project context
See `constitution.md` for project purpose, rules, standards, and the artifact manifest.
