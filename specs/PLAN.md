# ai-sdd: Level-2 Synthesized Implementation Plan

**Version:** 2.0.0-synthesized
**Date:** 2026-02-27
**Synthesized from:** ai-sdd-synthesized-{claude, codex, gemini, deepseek}

---

## 1. Overview

`ai-sdd` is delivered in five phases:

| Phase | Name | Goal |
|---|---|---|
| **Phase 1** | Core Engine | YAML agents + workflow + constitutions + HIL + Expression DSL + Artifact Contract + Context Management + Observability |
| **Phase 2** | Overlay Suite | Evidence gate, confidence loop, paired workflow, agentic review; overlay composition tests; adapter reliability; security baseline |
| **Phase 3** | Native Integration | First-class integration guides + slash commands for Claude Code, Codex, and Roo Code (run natively without a separate runtime) |
| **Phase 4** | Workflow SDK | Python + TypeScript programmatic workflow definitions; YAML parity tests; reference projects |
| **Phase 5** | Production Hardening | Reliability, observability (traces/metrics/SLOs), governance, schema migration, concurrency budgets |

---

## 2. Architecture

### 2.1 Full Component Overview

**Runtime:** Bun. **Language:** TypeScript strict mode. **Schema validation:** Zod v3.
No build step — Bun runs TypeScript directly. Import paths use `.ts` extensions.

```
src/
├── types/
│   ├── index.ts                   # Canonical enums, interfaces (TaskStatus,
│   │                              #   VALID_TRANSITIONS, WorkflowDefaults, etc.)
│   └── overlay-protocol.ts        # Overlay provider protocol types
│
├── core/                          # Engine
│   ├── engine.ts                  # Workflow orchestrator — dispatches tasks, concurrency
│   ├── workflow-loader.ts         # Kahn's topological sort + cycle detection; resolves
│   │                              #   engine defaults → workflow defaults → use: → task inline
│   ├── agent-loader.ts            # AgentRegistry with YAML `extends` inheritance
│   ├── state-manager.ts           # Atomic state persistence (tmp+rename pattern)
│   ├── context-manager.ts         # Assembles prompts for direct-mode dispatch
│   └── hooks.ts                   # Pre/post task hook registry
│
├── adapters/                      # Runtime adapter implementations
│   ├── base-adapter.ts            # RuntimeAdapter interface
│   ├── factory.ts                 # Adapter factory (satisfies-never exhaustive switch)

│   ├── errors.ts                  # Adapter error types
│   ├── mock-adapter.ts            # Deterministic mock (tests)
│   ├── claude-code-adapter.ts     # Claude Code integration (Bun subprocess)
│   └── openai-adapter.ts          # OpenAI Chat Completions API
│
├── dsl/                           # Expression DSL (no eval/exec anywhere)
│   ├── parser.ts                  # Recursive-descent parser
│   ├── evaluator.ts               # Deterministic evaluator over task context
│   └── types.ts                   # AST node types
│
├── artifacts/                     # Artifact contract system
│   ├── registry.ts                # Artifact type registry
│   ├── validator.ts               # Producer/consumer compatibility checks
│   └── compatibility.ts           # Version compatibility matrix
│
├── constitution/
│   ├── resolver.ts                # Merge: root → .ai-sdd/ → CLAUDE.md → specs/*/ → submodules
│   └── manifest-writer.ts         # Auto-writes artifact manifest after each task
│
├── overlays/                      # Decorator chain (locked order)
│   ├── base-overlay.ts            # BaseOverlay interface
│   ├── composition-rules.ts       # Enforces overlay chain order
│   ├── registry.ts                # Overlay registry
│   ├── provider-chain.ts          # Local + remote overlay provider chain
│   ├── local-overlay-provider.ts  # Built-in overlay provider
│   ├── hil/
│   │   ├── hil-overlay.ts         # HIL overlay (default ON)
│   │   └── hil-queue.ts           # HIL queue persistence
│   ├── policy-gate/
│   │   └── gate-overlay.ts        # Evidence Policy Gate (T0/T1/T2)
│   ├── confidence/
│   │   └── confidence-overlay.ts  # Confidence scoring (advisory)
│   ├── paired/
│   │   └── paired-overlay.ts      # Paired workflow (challenger agent)
│   ├── review/
│   │   └── review-overlay.ts      # Agentic review (GO/NO_GO)
│   └── mcp/
│       ├── mcp-client.ts          # MCP overlay client
│       └── mcp-overlay-provider.ts # Remote overlay provider
│
├── eval/
│   ├── metrics.ts                 # EvalMetric types
│   └── scorer.ts                  # confidence = f([EvalMetric]) → decimal
│
├── observability/
│   ├── emitter.ts                 # Structured JSON event emission
│   ├── sanitizer.ts               # Secret redaction in logs
│   ├── events.ts                  # Event schema (run_id, task_run_id, cost)
│   └── cost-tracker.ts            # Token/cost metrics aggregation
│
├── security/
│   ├── input-sanitizer.ts         # Prompt injection detection + quarantine
│   ├── output-sanitizer.ts        # Output scrubbing for sensitive data
│   └── patterns.ts                # Secret + injection regex patterns
│
├── integration/
│   └── mcp-server/
│       └── server.ts              # MCP server (stdio transport; delegates to CLI)
│
├── config/
│   ├── defaults.ts                # Engine + overlay + security defaults
│   └── remote-overlay-schema.ts   # Remote overlay config schema
│
└── cli/
    ├── index.ts                   # CLI entry point (commander.js)
    ├── config-loader.ts           # YAML config loader + merge
    └── commands/                   # One file per subcommand
        ├── run.ts                 # ai-sdd run [--resume] [--task] [--dry-run] [--step]
        ├── status.ts              # ai-sdd status [--json] [--next] [--metrics]
        ├── complete-task.ts       # ai-sdd complete-task (single transaction boundary)
        ├── validate-config.ts     # ai-sdd validate-config
        ├── constitution.ts        # ai-sdd constitution [--task]
        ├── hil.ts                 # ai-sdd hil list|show|resolve|reject
        ├── init.ts                # ai-sdd init --tool <name>
        ├── serve.ts               # ai-sdd serve --mcp
        └── migrate.ts             # ai-sdd migrate [--dry-run]

data/
├── workflows/
│   ├── default-sdd.yaml           # Standard SDD pipeline
│   └── examples/                  # 6 scale-specific workflow templates
│       ├── 01-quickfix.yaml
│       ├── 02-agile-feature.yaml
│       ├── 03-api-first.yaml
│       ├── 04-platform-service.yaml
│       ├── 05-greenfield-product.yaml
│       └── 06-regulated-enterprise.yaml
│
├── agents/defaults/               # 6 default agent YAMLs (BA, Architect, PE, LE, Dev, Reviewer)
│
├── task-library/                  # 12 reusable task templates (use: targets)
│
├── artifacts/schema.yaml          # Artifact type registry + versioning
├── config/defaults.yaml           # Framework-level config defaults
├── standards/index.yaml           # Coding standards index
│
└── integration/
    └── claude-code/               # Claude Code integration files (copied by init)
        ├── CLAUDE.md.template     # Appended to project CLAUDE.md
        ├── agents/                # 7 agent .md files (6 roles + sdd-scaffold)
        └── skills/                # 3 skill directories (sdd-run, sdd-status, sdd-scaffold)
```

### 2.2 Configuration Hierarchy

```
project-root/
├── constitution.md                  # Root project constitution
├── CLAUDE.md                        # Claude Code convention (also merged)
├── .ai-sdd/
│   ├── ai-sdd.yaml
│   ├── constitution.md              # Engine manifest (auto-generated)
│   ├── agents/
│   ├── workflows/                   # Workflow YAMLs (including feature workflows)
│   └── state/
│       ├── workflow-state.json
│       └── hil/
├── specs/
│   ├── <feature-slug>/
│   │   ├── constitution.md          # Feature constitution (additive)
│   │   └── init-report.md           # Feature setup report
│   └── tasks/                       # Task specs
└── src/
    └── some-module/
        └── constitution.md          # Submodule constitution
```

Config merge: CLI flags > project `ai-sdd.yaml` > framework `defaults.yaml`

**Key constraint:** `.ai-sdd/` is reserved for framework runtime files and must remain
static across all projects. Feature-specific artifacts (constitutions, init reports)
belong in `specs/<feature-slug>/`. Only workflow YAMLs go in `.ai-sdd/workflows/`
because the engine looks there for workflow definitions.

### 2.3 Overlay Chain (Locked Order)

```
dispatch(task)
    └── HIL                  (default ON)
        └── Evidence Gate    (optional)
            └── Agentic Review (optional)
                └── Paired Workflow (optional)
                    └── Confidence Loop (optional, advisory)
                        └── Agent Execution
```

### 2.4 Expression DSL Grammar (New)

All `exit_conditions` and gate expressions evaluated by the DSL only. No `eval()`.

```
expr     ::= comparison | logical
comparison ::= path op literal
logical  ::= expr ("and" | "or") expr | "not" expr | "(" expr ")"
op       ::= "==" | "!=" | ">" | ">=" | "<" | "<="
path     ::= identifier ("." identifier)*     # bounded to task context keys only
literal  ::= string | number | boolean
```

Example valid expressions:
- `review.decision == GO`
- `confidence_score >= 0.85`
- `pair.challenger_approved == true`
- `policy_gate.verdict == PASS and hil.resolved == true`

### 2.5 Artifact Contract (New)

```yaml
# artifacts/schema.yaml
version: "1"
artifact_types:
  requirements_doc:
    version: "1"
    required_sections: [functional_requirements, acceptance_criteria]
    file_format: markdown

  design_l1:
    version: "1"
    required_sections: [architecture_overview, component_map, api_contracts]
    file_format: markdown

  review_log:
    version: "1"
    required_fields: [decision, feedback, iteration, timestamp]
    file_format: json
```

Task workflow YAML declares output contracts:
```yaml
tasks:
  define-requirements:
    outputs:
      - path: requirements.md
        contract: requirements_doc@1
  design-l1:
    inputs:
      - path: requirements.md
        contract: requirements_doc@1   # compatibility checked at load time
```

### 2.6 Context Window Management — Constitution as Index (New)

Context growth is managed through the **pull model**, not a ContextReducer. The engine writes an auto-updated artifact manifest into the constitution after each task completes. Agents use their native tools (Read, Grep, Serena, etc.) to fetch only what they need — no preprocessing or compression in the engine.

```markdown
<!-- Auto-generated section in constitution.md — updated by engine after each task -->
## Workflow Artifacts (current state)
| Task | Artifact | Path | Status |
|---|---|---|---|
| define-requirements | Requirements doc | .ai-sdd/outputs/requirements.md | COMPLETED |
| design-l1 | L1 Architecture | .ai-sdd/outputs/design/l1.md | COMPLETED |
| design-l2 | L2 Component Design | .ai-sdd/outputs/design/l2.md | PENDING |

## Reading Convention
Read only the artifacts relevant to your current task.
Do not load all artifacts — read the sections you need.
```

Agents are instructed via the constitution to read what they need. No engine-side compression. No ContextReducer.

### 2.7 Concurrency Budget (New)

```yaml
# ai-sdd.yaml
engine:
  max_concurrent_tasks: 3
  rate_limit_requests_per_minute: 20
  cost_budget_per_run_usd: 10.00   # pause → HIL when exceeded
```

### 2.8 Observability Events (Enhanced)

Every event now carries `run_id` and `task_run_id` for cross-event correlation:

```json
{
  "version": "1",
  "run_id": "uuid-v4",
  "task_run_id": "uuid-v4",
  "timestamp": "...",
  "level": "INFO",
  "event_type": "task.completed",
  "workflow": "default-sdd",
  "task_id": "design-l1",
  "agent": "architect",
  "details": {
    "duration_ms": 4200,
    "tokens_used": 3100,
    "estimated_cost_usd": 0.031,
    "retry_count": 0,
    "loop_count": 2
  }
}
```

---

## 3. Phase 0: Pre-Implementation Gate

**T000 — Spec Gate** must reach `COMPLETED` before any Phase 1 task starts.

It is a T2-tier task: the `sdd-reviewer` agent verifies all checklist items against
the spec, then the engine fires a HIL gate requiring **two human sign-offs**
(tech lead + security reviewer). Only then do T001–T016 become `PENDING`.

This is the framework gating its own implementation using its own overlay system.

```
T000 (Spec Gate — T2 HIL)
    │
    └──► T001, T002, T003 ... (all Phase 1 tasks become PENDING only after T000 = COMPLETED)
```

---

## 4. Phase 1: Core Engine (Enhanced)

**New additions vs. synthesized-claude:**

| ID | Deliverable | Size | Source |
|---|---|---|---|
| P1-D1 | Agent YAML schema + loader | S (4d) | All |
| P1-D2 | Default agents (6 roles) | XS (3d) | All |
| P1-D3 | Workflow YAML schema + DAG loader | M (5d) | All |
| P1-D4 | Core engine + hooks + asyncio | L (8d) | All |
| P1-D5 | State manager (checkpoint/resume) | S (4d) | All |
| P1-D6 | Context manager + constitution artifact manifest writer | S (3d) | **+Gemini→simplified** |
| P1-D7 | Constitution resolver | XS (3d) | All |
| P1-D8 | HIL overlay (default ON) | S (4d) | All |
| P1-D9 | Default SDD workflow template | XS (2d) | All |
| P1-D10 | CLI (run/resume/status/validate/hil/**step**/metrics) | M (7d) | **+Gemini step** |
| P1-D11 | RuntimeAdapter + MockAdapter + ClaudeCodeAdapter | M (5d) | All |
| P1-D12 | **Expression DSL + Safe Evaluator** | S (4d) | **Codex** |
| P1-D13 | **Artifact Contract + I/O Schema** | S (4d) | **Codex** |
| P1-D14 | **Observability (run IDs + cost/token metrics)** | S (4d) | **+Codex** |
| P1-D15 | Concurrency budget config in engine | XS (2d) | **Codex (gap)** |
| P1-D16 | **HIL resume state fix (T025)** | XS (2d) | **Bug fix — HIL_PENDING resume skips pre-overlays** |

**Phase 1 total estimate: ~60 developer-days** *(+2d for HIL resume fix)*

---

## 4. Phase 2: Overlay Suite (Enhanced)

| ID | Deliverable | Size | Source |
|---|---|---|---|
| P2-D1 | Confidence scoring (composite + raw mode) | S (4d) | All |
| P2-D2 | Confidence loop overlay (advisory) | XS (3d) | All |
| P2-D3 | Evidence policy gate (T0/T1/T2) | M (6d) | All |
| P2-D4 | Paired workflow overlay (role switch, session history) | M (6d) | All |
| P2-D5 | Agentic review overlay (GO/NO_GO, audit log) | S (5d) | All |
| P2-D6 | Enhanced HIL (ACKED/RESOLVED/REJECTED lifecycle) | S (3d) | All |
| P2-D7 | **Overlay composition matrix tests** | M (5d) | **Codex** |
| P2-D8 | **Adapter reliability contract** | S (4d) | **Codex** |
| P2-D9 | **Security baseline + prompt injection** | M (5d) | **Codex** |
| P2-D10 | CodexAdapter + GeminiAdapter (full impl) | M (6d) | All |

**Phase 2 total estimate: ~47 developer-days**

---

## 5. Phase 3: Native Integration with AI Coding Tools

**New phase — not in any source plan.**

Goal: `ai-sdd` runs natively within Claude Code, OpenAI Codex CLI, and Roo Code. No separate process needed for interactive use — each tool drives the `ai-sdd` CLI via its own native mechanisms.

| ID | Deliverable | Size | Notes |
|---|---|---|---|
| P3-D1 | Claude Code: slash commands + `CLAUDE.md` template | S (4d) | 5 slash commands (markdown only); headless `ClaudeCodeAdapter` for CI |
| P3-D2 | OpenAI / Codex: `AGENTS.md` template + `OpenAIAdapter` | S (4d) | `AGENTS.md` for `codex` CLI; `OpenAIAdapter` for API path; no Jinja2 |
| P3-D3 | Roo Code: static `.roomodes` + `mcp_config.json` | S (3d) | 6 static agent mode definitions; no `generate_modes.py` |
| P3-D4 | Shared MCP server (`integration/mcp_server/`) | S (3d) | ~100 lines; all tools delegate to `ai-sdd` CLI; used by Roo Code + Claude Code |
| P3-D5 | Shared tool schemas (`integration/shared/`) | XS (1d) | `write_output_tool.json` + `workflow_tools.json` reused by OpenAI + MCP |
| P3-D6 | `ai-sdd init --tool <name>` CLI command | S (3d) | Replaces per-tool install.sh scripts; copies integration files to project |
| P3-D7 | Integration test suite | M (5d) | Headless adapter tests + MCP server contract tests |
| P3-D8 | **Adaptive `/sdd-scaffold` + feature constitutions** | S (3d) | Context-aware scaffold (greenfield / brownfield-feature / brownfield-quickfix); feature constitutions in `specs/<feature>/constitution.md`; resolver support |

**Phase 3 total estimate: ~26 developer-days** *(added P3-D8 adaptive scaffold)*

---

## 6. Phase 4: Workflow SDK

| ID | Deliverable | Size |
|---|---|---|
| P4-D1 | Python Workflow SDK | L (12d) |
| P4-D2 | TypeScript Workflow SDK | L (10d) |
| P4-D3 | SDK ↔ YAML parity tests | M (5d) |
| P4-D4 | Reference projects (minimal + high-assurance) | M (6d) |
| P4-D5 | Cost/latency tradeoff documentation | S (3d) |

**Phase 4 total estimate: ~36 developer-days**

---

## 7. Phase 5: Production Hardening

| Track | Deliverables | Size |
|---|---|---|
| Reliability | Retries/backoff, idempotency, load tests | L (10d) |
| Observability (extended) | OpenTelemetry traces, Prometheus metrics, SLO alerts | L (12d) |
| Governance | Audit export, policy packs | M (8d) |
| Schema Migration | `ai-sdd migrate` CLI, version compatibility matrix | M (7d) |

**Phase 5 total estimate: ~37 developer-days**

---

## 8. MVP Exit Criteria

MVP is ready when all of the following are demonstrable:

1. End-to-end YAML workflow execution with handovers and bounded loops.
2. Resume from persisted checkpoint after interruption.
3. HIL queue lifecycle: list, resolve, reject.
4. Evidence-based gate decisions are logged and auditable.
5. Expression DSL evaluates exit conditions (no `eval()`).
6. Artifact compatibility check prevents incompatible task handovers.
7. Mock adapter + at least one real-provider path (Claude Code) are verified.
8. Config errors fail fast with actionable diagnostics.
9. Constitution artifact manifest lists all completed outputs; agents read only what they need via native tools (no ContextReducer).
10. Cost/token metrics visible in `ai-sdd status --metrics`.

---

## 9. Migration from sdd-unified

| sdd-unified | ai-sdd |
|---|---|
| `agents/roles/*.yaml` | `agents/defaults/*.yaml` |
| `commands/**/*.yaml` | Referenced in agent YAML `commands` section |
| `templates/workflow.json.template` | `workflows/default-sdd.yaml` |
| `orchestrator/main.py` | `core/engine.py` |
| `orchestrator/policy_gate.py` | `overlays/policy_gate/` |
| `orchestrator/human_queue.py` | `overlays/hil/` |
| Claude Code slash commands | `integration/claude_code/slash_commands/` |
| Hardcoded role names | Configurable via agent YAML `name` field |

---

## 10. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Overlay composition non-determinism | Phase 2: overlay composition matrix tests in CI |
| Expression DSL evaluates untrusted input | DSL grammar is whitelist-only; no `eval()` |
| Context window exceeded mid-run | Constitution artifact manifest + agent pull model; agents read only what they need via native tools |
| Adapter error breaks resume | Adapter reliability contract + idempotency keys |
| Cost spike from parallel LLM calls | Concurrency budget + cost threshold HIL escalation |
| Prompt injection via constitution/spec files | Input sanitization pipeline (T017) |
| Evidence gate bypassed by raising threshold | T2 tier requires HIL by design — no config bypass |
| Schema breaking change mid-run | State file `version` field; `ai-sdd migrate` CLI (Phase 5) |
| HIL resume resets state machine | T025: HIL resume guard in `runTaskIteration()` skips pre-overlays for HIL_PENDING tasks |
