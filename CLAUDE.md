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
  adapters/               # base-adapter.ts interface; mock, claude-code, openai impls
  overlays/               # HIL, policy-gate, review, paired, confidence
  cli/commands/           # one file per CLI subcommand
  constitution/           # manifest-writer.ts writes artifact index to constitution.md
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

**Overlay chain order is locked** (enforced by `src/overlays/composition-rules.ts`):
```
HIL → Evidence Gate → Agentic Review → Paired Workflow → Confidence → Agent Execution
```
Paired and Review are mutually exclusive. T2 risk tier always triggers HIL.

**`complete-task` is the single atomic transaction boundary** (`src/cli/commands/complete-task.ts`):
path-allowlist → sanitize → contract-validate → write → state-update → manifest-update.
MCP server delegates to this command; it never writes files directly.

**Workflow defaults + task library** — `workflow-loader.ts` applies a 4-layer merge per task: `ENGINE_TASK_DEFAULTS` → workflow `defaults:` block → task library template (`use:`) → task inline. Engine built-ins: `hil.enabled=true`, `policy_gate.risk_tier=T1`, `max_rework_iterations=3`. Overlay keys merge individually (not whole-object replace). `{{task_id}}` in library output paths is substituted at load time.

**Workflow lookup order** (first found wins): `.ai-sdd/workflow.yaml` → `.ai-sdd/workflows/default-sdd.yaml` → bundled framework default.

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
ai-sdd run [--resume] [--task <id>] [--dry-run] [--step]
ai-sdd status [--json] [--next --json] [--metrics]
ai-sdd complete-task --task <id> --output-path <path> --content-file <tmp>
ai-sdd validate-config
ai-sdd constitution [--task <id>]
ai-sdd hil list [--json] | show <id> | resolve <id> [--notes] | reject <id> [--reason]
ai-sdd init --tool <name> [--project <path>]   # tool: claude_code | openai | roo_code
ai-sdd serve --mcp                             # stdio transport only — no --port
ai-sdd migrate [--dry-run] [--from N --to N]
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
