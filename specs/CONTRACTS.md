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

**Confidence overlay** operates as a post-task quality gate, not advisory:

- `score < threshold` → `NEEDS_REWORK` (default threshold: `0.7`).
- `score < low_confidence_threshold` (when set) → regeneration + escalation chain:
  regen retries (with per-attempt sampling nudges) → paired challenger (once) → HIL.
- `low_confidence_threshold` is disabled until explicitly set; must be ≤ `threshold`.
- The confidence overlay does **not** replace the Evidence Policy Gate — both may run.
  High confidence does not waive a T2 gate's required HIL sign-off.

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
| `ai-sdd serve` | `--mcp` | Start MCP server (stdio transport only) |
| `ai-sdd hil list` | `--json` | Output pending HIL items as machine-readable JSON |

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
| Constitution resolution order | (hardcoded) | root → `.ai-sdd/` → `CLAUDE.md` → `specs/*/constitution.md` (alpha) → submodules |
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

---

## 13. Development Invariants (Gap Prevention)

These invariants are binding rules derived from post-implementation gap analysis
(`specs/GAP-RETROSPECTIVE.md`). They apply to all contributors and AI agents working on this codebase.
Violations are grounds for blocking a PR in the same way a failing test blocks a merge.

### 13.1 Config-to-Behaviour Binding

**Every config field and CLI flag MUST have a test that changes the field and asserts different runtime behaviour.**

- Adding `adapter.type` to the schema requires a test that passes `type: "claude_code"` and asserts a `ClaudeCodeAdapter` is constructed.
- A flag that exists in the CLI definition but has no behaviour test is **not yet implemented** — it must either be removed or implemented before merging.
- The `satisfies never` pattern in exhaustive `switch` statements is the structural enforcement mechanism. New enum values without factory cases are compile errors.

### 13.2 Integration Point Tests

**Every time component A is wired into component B, a test MUST verify A is called when B runs.**

- Unit tests of A in isolation are not sufficient.
- Example: wiring the overlay chain into the engine requires a test that creates an engine with a spy overlay and asserts the overlay's `preTask` was called during `engine.run()`.
- Structural coupling tests ("this module imports that module") prevent silent forks where two independent implementations drift apart.

### 13.3 No Silent Stubs

**Deferred features MUST fail loudly. A placeholder MUST NOT return a successful result.**

- If a feature is planned for a future phase, the current implementation must either throw `NotImplementedError` with an actionable message, or return an explicit failure result (e.g. `accept: false, new_status: "NEEDS_REWORK"`) that is visible to the caller.
- Silent pass-through (returning `{ accept: true }` without doing the work) is forbidden.
- The error/failure message must name the feature and the phase in which it will be implemented, e.g. `"Paired overlay requires Phase 3 adapter injection. Set overlays.paired.enabled: false to bypass."`.

### 13.4 External Schema Fixtures

**Any code that integrates with an external CLI or API MUST be tested against a fixture of actual captured output.**

- Write a fixture file containing real CLI/API JSON output. Write tests against that fixture.
- Do not write tests against an assumed or guessed schema — run the real CLI/API once, capture its output, commit the fixture.
- A fallback path (e.g. `catch → raw fallback`) that silently swallows a parse error is a gap concealer, not a safety net. Any fallback must emit an observable signal (log, metric, counter) so it can be detected.
- When the external schema changes, the fixture test breaks — this is the correct behaviour.

### 13.5 Error Message Contracts

**Every error message that says "X happened" MUST be verified by a test that asserts X actually happened.**

- If a message says `"Task set to NEEDS_REWORK"`, there must be a test that calls the code and then reads the task state to confirm it is `NEEDS_REWORK`.
- Error messages are contracts, not comments. Code review should flag any message that describes an outcome without the code performing that outcome.
- Mechanically: if the message contains a state name (e.g. `NEEDS_REWORK`, `FAILED`), grep the surrounding branch for a `transition()` call with that state. If absent, the message is wrong.

### 13.6 No Empty Directories

**No empty directory may be committed. A directory must contain at least one file on the day it is created.**

- If a directory is created as a structural placeholder, it must contain a `README.md` explaining what will go there, or a `.gitkeep` with a comment.
- An empty directory is a dangling reference — it implies code exists or is coming soon without committing to either.
- CI check: `find src -type d` with no source files in a directory should fail the build.

### Summary

| Rule | What it prevents |
|------|-----------------|
| 13.1 Config-to-behaviour binding | Config parsed but never read (Gap #1, #8, #13, #23) |
| 13.2 Integration point tests | Component implemented but never wired (Gap #2, #3, #18) |
| 13.3 No silent stubs | Placeholder silently succeeds (Gap #11, #12) |
| 13.4 External schema fixtures | Assumed schema never matched real output (Gap #5) |
| 13.5 Error message contracts | Message and code say different things (Gap #9) |
| 13.6 No empty directories | Structure implies code that does not exist (Gap #4, #22) |
