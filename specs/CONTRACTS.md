# ai-sdd: Canonical Contracts Appendix

**Date:** 2026-02-27
**Purpose:** Single source of truth for all normalized names, enums, and transaction
boundaries. Resolves any ambiguity between task files.

---

## 1. Tool Names

| Context | Value | Notes |
|---|---|---|
| `ai-sdd init --tool` | `claude_code` | Installs `.claude/agents/` + `.claude/skills/` |
| `ai-sdd init --tool` | `codex` | Installs `AGENTS.md` |
| `ai-sdd init --tool` | `roo_code` | Installs `.roomodes` + `.roo/mcp.json` |
| `adapter.type` in `ai-sdd.yaml` | `claude_code` | Runtime: Claude Code subprocess |
| `adapter.type` in `ai-sdd.yaml` | `openai` | Runtime: OpenAI Chat Completions API |
| `adapter.type` in `ai-sdd.yaml` | `roo_code` | Runtime: Roo Code MCP path |
| `adapter.type` in `ai-sdd.yaml` | `mock` | Runtime: deterministic mock (tests) |

`--tool` controls the **UX integration files** installed in the project.
`adapter.type` controls the **LLM runtime** used by the engine.
They are independent — a project can use `--tool roo_code` with `adapter.type: openai`.

---

## 2. Task States

```
PENDING ──► RUNNING ──► COMPLETED
                │
                ├──► NEEDS_REWORK ──► RUNNING   (rework loop; feedback injected)
                │         └──────────► FAILED   (max_rework_iterations exceeded)
                │
                ├──► HIL_PENDING ──► RUNNING    (HIL resolved)
                │         └──────────► FAILED   (HIL rejected)
                │
                └──► FAILED
```

| State | Set by | Meaning |
|---|---|---|
| `PENDING` | Init | Not yet ready to run |
| `RUNNING` | Engine dispatch | Currently executing |
| `COMPLETED` | Engine post-task | Output produced, contract passed |
| `NEEDS_REWORK` | Evidence gate fail / reviewer NO_GO | Output rejected; agent must rerun with feedback |
| `HIL_PENDING` | HIL overlay | Waiting for human decision |
| `FAILED` | Engine on error / HIL reject / max iterations | Terminal; downstream tasks blocked |

**Invariant:** A task must never remain in `RUNNING` indefinitely.
Gate failure → `NEEDS_REWORK`. HIL trigger → `HIL_PENDING`. Crash → `FAILED`.

---

## 3. HIL Queue Item States

| State | Meaning |
|---|---|
| `PENDING` | Created; awaiting human acknowledgement |
| `ACKED` | Human has seen it |
| `RESOLVED` | Human approved; task unblocks |
| `REJECTED` | Human rejected; task transitions to `FAILED` |

---

## 4. Idempotency Keys

Two distinct keys per task execution:

| Key | Format | Stability | Used for |
|---|---|---|---|
| `operation_id` | `workflow_id:task_id:task_run_id` | **Stable across retries and resume** | Sent to provider as idempotency header; dedup |
| `attempt_id` | `workflow_id:task_id:task_run_id:attempt_N` | Changes per retry | Observability / tracing only |

Rule: adapters send `operation_id` to the provider. Both IDs are logged in every
`task.started` / `task.retrying` event. `attempt_id` is never sent to the provider.

---

## 5. Evidence Gate Risk Tiers

| Tier | Evidence Required | Human Sign-off |
|---|---|---|
| `T0` | Acceptance evidence only | No |
| `T1` | Acceptance + verification (tests/lint/security) | No |
| `T2` | Acceptance + verification + operational readiness | **Always** |

Confidence score is **advisory only** at all tiers. It is included in the gate report but
never changes the pass/fail verdict.

---

## 6. CLI Flags — Complete Reference

| Command | Flag | Description |
|---|---|---|
| `ai-sdd run` | (none) | Run workflow from beginning |
| `ai-sdd run` | `--resume` | Resume from last persisted state |
| `ai-sdd run` | `--task <id>` | Run specific task + unmet deps |
| `ai-sdd run` | `--dry-run` | Print plan; no LLM calls |
| `ai-sdd run` | `--step` | Pause after each task |
| `ai-sdd status` | (none) | Human-readable task table |
| `ai-sdd status` | `--json` | Full workflow state as JSON |
| `ai-sdd status` | `--next --json` | Next READY task(s) as JSON (used by MCP) |
| `ai-sdd status` | `--metrics` | Include cost/token/duration per task |
| `ai-sdd complete-task` | `--task <id>` | Task ID to complete |
| `ai-sdd complete-task` | `--output-path <path>` | Declared output path (allowlisted) |
| `ai-sdd complete-task` | `--content-file <tmp>` | Temp file holding artifact content |
| `ai-sdd validate-config` | (none) | Validate all YAML configs |
| `ai-sdd constitution` | (none) | Print merged constitution |
| `ai-sdd constitution` | `--task <id>` | Print constitution for task context |
| `ai-sdd hil list` | (none) | List PENDING HIL items |
| `ai-sdd hil show <id>` | | Show HIL item context |
| `ai-sdd hil resolve <id>` | `--notes` | Approve; unblock task |
| `ai-sdd hil reject <id>` | `--reason` | Reject; fail task |
| `ai-sdd init` | `--tool <name>` | Install tool integration files |
| `ai-sdd init` | `--project <path>` | Target project directory |
| `ai-sdd serve` | `--mcp` | Start MCP server |
| `ai-sdd serve` | `--port <n>` | MCP server port (default 3000) |

---

## 7. `ai-sdd complete-task` Transaction Boundary

The `complete-task` command is the **single transaction boundary** for task completion.
It performs the following steps atomically — either all succeed or none are committed:

```
1. Validate output_path against project allowlist  → reject path traversal (../../)
2. Run security sanitization on content:
   - Injection pattern detected  → abort; task → NEEDS_REWORK; no write
   - Secret detected in output   → abort; task → NEEDS_REWORK; no write
     (the agent must remove/sanitize the secret and resubmit)
   Note: secret *redaction* ([REDACTED:TYPE]) applies to logs/events only, not task output.
3. Validate artifact contract                      → section/field presence check
4. Write file to output_path                       → atomic write (tmp + rename)
5. Update workflow state: task → COMPLETED         → atomic state file write
6. Update constitution manifest                    → manifest_writer hook
```

If any step fails, no state mutation occurs. The task remains in its prior state.

---

## 8. Adapter Dispatch Modes

| Mode | Who assembles the prompt | Adapters |
|---|---|---|
| `direct` | Engine builds full system prompt (persona + constitution + task) → sends to LLM API | `OpenAIAdapter`, `ClaudeCodeAdapter` (headless/CI) |
| `delegation` | Engine sends lightweight task brief only → tool manages its own context via CLAUDE.md / .roomodes / MCP | Claude Code (interactive skills/subagents), Roo Code (MCP modes) |

`dispatch_mode` is declared per adapter. Mixing modes within one workflow is allowed —
different tasks can use different adapters.

---

## 9. Schema Versioning

Every schema file carries a `schema_version` field from day one:

| File | Field | Phase 1 value |
|---|---|---|
| `workflow-state.json` | `schema_version` | `"1"` |
| `ai-sdd.yaml` | `version` | `"1"` |
| `workflow.yaml` | `version` | `"1"` |
| `agent.yaml` | `version` | `"1"` |
| `artifacts/schema.yaml` | `version` | `"1"` |

**Version mismatch at startup** → hard error: `"schema version mismatch; run ai-sdd migrate"`.
**Migration CLI** (interface defined Phase 1; implementation Phase 5):
```
ai-sdd migrate --dry-run        → print plan, no writes
ai-sdd migrate                  → migrate to current version
ai-sdd migrate --from 1 --to 2  → explicit range
```

---

## 10. Config Namespace Summary

| Setting | Location | Notes |
|---|---|---|
| Secret redaction patterns | `security.secret_patterns` | Consumed by both sanitizer and observability |
| Injection detection level | `security.injection_detection_level` | `pass` / `warn` / `quarantine` |
| LLM adapter type | `adapter.type` | `claude_code` / `openai` / `roo_code` / `mock` |
| Constitution strict parse | `constitution.strict_parse` | `true` (default) = root malformed → hard error |
| Legacy untyped artifacts | CLI flag `--allow-legacy-untyped-artifacts` | Never a config file default |
| Concurrency budget | `engine.max_concurrent_tasks` | Semaphore on parallel dispatch |
| Cost budget | `engine.cost_budget_per_run_usd` | Threshold; action set by `cost_enforcement` |
| Cost enforcement mode | `engine.cost_enforcement` | `warn` / `pause` (→HIL) / `stop` (→FAILED); default `pause` |
| Context warning threshold | `engine.context_warning_threshold_pct` | Emit `context.warning` event; default 80% |
| Context HIL threshold | `engine.context_hil_threshold_pct` | Trigger HIL in direct mode; default 95% |
| Observability log level | `observability.log_level` | `DEBUG` / `INFO` / `WARN` / `ERROR` |

---

## 11. Backward-Compatibility Modes

| Mode | How to activate | Behavior |
|---|---|---|
| **strict** (default for new projects) | No config needed | Root constitution malformed → error; contracts declared + missing registry → error |
| **legacy** | `--allow-legacy-untyped-artifacts` CLI flag | Missing registry → warn + skip; submodule parse failure → warn + skip |

`legacy` mode is for gradual adoption only. Projects should migrate to `strict` mode.
There are no hidden permissive fallbacks — every relaxation is explicit and flagged.

---

## 12. HIL Config Hierarchy

HIL is configured at two independent levels:

| Level | File | Path | Controls |
|---|---|---|---|
| **Project (global)** | `ai-sdd.yaml` | `overlays.hil.*` | Queue path, poll interval, notification hooks, default enabled state |
| **Task (per-task)** | `workflow.yaml` | `tasks.<id>.overlays.hil.*` | Per-task enabled/disabled override, risk_tier override |

Both use the `overlays.hil` key path — there is no root-level `hil:` key. This ensures all
overlay config is discoverable under the single `overlays:` namespace.

```yaml
# ai-sdd.yaml — project-wide HIL settings
overlays:
  hil:
    enabled: true                      # global default
    queue_path: ".ai-sdd/state/hil/"
    notify:
      on_created: [...]
      on_t2_gate: [...]

# workflow.yaml — per-task HIL override
tasks:
  low-risk-task:
    overlays:
      hil:
        enabled: false                 # disable for this specific task
  critical-task:
    overlays:
      policy_gate:
        risk_tier: T2                  # T2 always triggers HIL regardless of enabled flag
```
