# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

This repository is currently **specs-only**. The `specs/` directory contains the full planning documents for the `ai-sdd` framework. No implementation code exists yet. Phase 1 implementation is blocked pending two human sign-offs (see `specs/PRE-IMPLEMENTATION-GATE.md`).

There are no build, lint, or test commands to run yet.

## What ai-sdd Is

`ai-sdd` is an AI-driven Software Design & Development orchestration framework. It runs YAML-defined multi-agent workflows where each task is dispatched to an LLM agent (via Claude Code, OpenAI, or Roo Code adapters), with overlays for human-in-the-loop (HIL), evidence-gated reviews, confidence scoring, and paired workflows.

## Planned Directory Structure

When implementation begins (post-gate), code goes in:

```
core/          # engine.py, workflow_loader.py, agent_loader.py, state_manager.py, context_manager.py, hooks.py, runtime_adapter.py
adapters/      # mock_adapter.py, claude_code_adapter.py, codex_adapter.py, gemini_adapter.py
dsl/           # Expression DSL (grammar.py, parser.py, evaluator.py) — no eval() ever
artifacts/     # schema.yaml, validator.py, compatibility.py
constitution/  # resolver.py, manifest_writer.py
agents/        # base_agent.yaml, schema.yaml, defaults/ (6 role YAMLs)
workflows/     # default-sdd.yaml, schema.yaml
overlays/      # base_overlay.py, hil/, policy_gate/, confidence/, paired/, review/
eval/          # metrics.py, scorer.py
observability/ # emitter.py, sanitizer.py, events.py, cost_tracker.py
security/      # input_sanitizer.py, output_sanitizer.py
integration/   # mcp_server/, claude_code/, openai/, roo_code/
cli/           # main.py, commands.py
config/        # defaults.yaml
```

## Key Architecture Decisions

1. **Expression DSL is mandatory** — all `exit_conditions` and gate expressions use `dsl/`. No `eval()` or `exec()` anywhere.

2. **Constitution-as-index, not ContextReducer** — the engine writes an artifact manifest table into `constitution.md` after each task. Agents pull what they need via native tools (Read, Grep, Serena, MCP). No engine-side context compression.

3. **Overlay chain order is locked:**
   ```
   HIL (default ON) → Evidence Gate → Agentic Review → Paired Workflow → Confidence Loop → Agent Execution
   ```

4. **Two dispatch modes for adapters:**
   - `direct`: engine builds full system prompt (persona + constitution + task) → sends to LLM API
   - `delegation`: engine sends lightweight task brief only → tool manages its own context via CLAUDE.md/.roomodes/MCP

5. **`ai-sdd complete-task` is the single atomic transaction boundary** for task completion: path-allowlist → sanitize → contract-validate → write → state-update → manifest-update. MCP delegates to it; never writes files directly.

6. **Secret in task output → `NEEDS_REWORK`** (not silent redaction). Redaction (`[REDACTED:TYPE]`) applies to logs/observability only.

## Canonical Contracts (from `specs/CONTRACTS.md`)

### Task States
```
PENDING → RUNNING → COMPLETED
                │
                ├── NEEDS_REWORK → RUNNING  (gate fail / NO_GO)
                │         └────── FAILED    (max iterations)
                ├── HIL_PENDING  → RUNNING  (HIL resolved)
                │         └────── FAILED    (HIL rejected)
                └── FAILED
```
No task may remain in `RUNNING` indefinitely. Invalid transitions raise `StateError`.

### HIL Queue States
`PENDING → ACKED → RESOLVED` or `PENDING → REJECTED`

### Idempotency Keys (per task execution)
- `operation_id`: `workflow_id:task_id:task_run_id` — stable across retries; sent to provider
- `attempt_id`: `workflow_id:task_id:task_run_id:attempt_N` — changes per retry; observability only

### Evidence Gate Risk Tiers
- `T0`: acceptance evidence only; no HIL
- `T1`: acceptance + verification (tests/lint/security); no HIL
- `T2`: acceptance + verification + operational readiness; **always HIL**

### CLI Commands Reference
```
ai-sdd run [--resume] [--task <id>] [--dry-run] [--step]
ai-sdd status [--json] [--next --json] [--metrics]
ai-sdd complete-task --task <id> --output-path <path> --content-file <tmp>
ai-sdd validate-config
ai-sdd constitution [--task <id>]
ai-sdd hil list | show <id> | resolve <id> [--notes] | reject <id> [--reason]
ai-sdd init --tool <name> [--project <path>]   # tool: claude_code | codex | roo_code
ai-sdd serve --mcp [--port <n>]
ai-sdd migrate [--dry-run] [--from N --to N]
```

## Spec Documents

- `specs/INDEX.md` — task list with phases and dependencies
- `specs/PLAN.md` — full architecture, 5-phase plan, component tree
- `specs/CONTRACTS.md` — canonical enum values, CLI flags, transaction boundaries
- `specs/ROADMAP.md` — milestones, critical path, MVP gate
- `specs/PRE-IMPLEMENTATION-GATE.md` — 24 binary checks; must PASS before Phase 1 begins
- `specs/tasks/T*.md` — individual task specs (acceptance criteria, schema details)

## Task Dependency Order

Phase 1 critical path: `T000 → T001+T003 → T002 → T004 → T005`

T012 (Expression DSL) must complete before any workflow with loop conditions executes.
T013 (Artifact Contract) should complete before T002 (workflow loader) is finalized.

## Schema Versioning

Every schema file carries `version: "1"` from day one. Version mismatch at startup → hard error. All schemas: `workflow-state.json`, `ai-sdd.yaml`, `workflow.yaml`, `agent.yaml`, `artifacts/schema.yaml`.

## Config Merge Order

`CLI flags` > `project .ai-sdd/ai-sdd.yaml` > `framework config/defaults.yaml`

Key config paths: `adapter.type`, `overlays.hil.*`, `engine.max_concurrent_tasks`, `engine.cost_budget_per_run_usd`, `security.secret_patterns`, `security.injection_detection_level`.
