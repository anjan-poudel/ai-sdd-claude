# Gap Fixes — Sprint A+B (Retrospective Spec)

**Date:** 2026-03-03
**Sprint:** A (critical wiring) + B (adapter correctness)
**Status:** COMPLETED
**Fixes:** Gaps #1–#6 from `gap-analysis.md`

---

## Purpose

This document records what was broken, what the correct behaviour is, and what
was changed to fix it.  It acts as the canonical source of truth for future
agents reading the codebase and should be consulted before modifying any of the
affected files.

---

## Gap #1 — Adapter always MockAdapter (FIXED)

### What was wrong
`src/cli/commands/run.ts` contained `const adapter = new MockAdapter()` with a
comment acknowledging the problem.  `config.adapter.type` was parsed but never
read.

### Correct behaviour
`config.adapter.type` (from `.ai-sdd/ai-sdd.yaml`) MUST determine which adapter
is constructed.  The default when the field is absent is `"mock"`.

### Solution implemented
- **`src/adapters/factory.ts`** (new): `createAdapter(config)` — exhaustive
  `switch` over `AdapterType`.  The `default` branch contains
  `config.type satisfies never` so adding a new `AdapterType` without a matching
  case is a compile error.
- `roo_code` throws immediately with an actionable message (it is an integration
  mode, not a runtime adapter — agents use the MCP server instead).
- `run.ts` now calls `createAdapter({ type: config.adapter?.type ?? "mock", ...config.adapter })`.

### Tests
`tests/adapters/adapter-factory.test.ts` — 8 tests covering correct class per
type, dispatch_mode override, roo_code error message, and negative assertions
confirming MockAdapter is never returned for `claude_code` or `openai`.

---

## Gap #2 — Overlay chain never called by engine (FIXED)

### What was wrong
Five overlay classes existed (`HilOverlay`, `PolicyGateOverlay`, `ReviewOverlay`,
`PairedOverlay`, `ConfidenceOverlay`) and the chain utilities
(`runPreTaskChain`, `runPostTaskChain`) were implemented in `base-overlay.ts`,
but `engine.ts` imported none of them.  Every `ai-sdd run` skipped HIL gating,
evidence gates, review decisions, and confidence scoring entirely.

### Correct behaviour
`Engine.runTaskIteration` MUST:
1. Build an `OverlayContext` for the task.
2. Call `runPreTaskChain(overlayChain, ctx)` **before** adapter dispatch.
3. If the chain returns `!proceed`:
   - `hil_trigger: true` → transition `RUNNING → HIL_PENDING`, await
     resolution (see Gap #3), then continue or fail.
   - `hil_trigger` absent/false → transition `RUNNING → NEEDS_REWORK`, return
     `"NEEDS_REWORK"` for the rework loop to retry.
4. Call `runPostTaskChain(overlayChain, ctx, result)` **after** adapter dispatch,
   but **before** the `COMPLETED` transition.
5. If the post chain returns `!accept`: transition to `postResult.new_status`
   (defaults to `NEEDS_REWORK`) and return accordingly.

### Solution implemented
- `Engine` constructor gains optional `overlayChain: OverlayChain = []` as the
  last parameter (backward-compatible — existing callers without overlays pass
  nothing; default is empty chain = no-op).
- `run.ts` instantiates the full 5-overlay chain from project config and passes
  it to `Engine`.
- `runTaskIteration` now runs pre + post overlay chains with correct state
  transitions at each branch.
- Per-task `duration_ms` is now tracked (start time recorded before dispatch,
  real elapsed emitted in `task.completed`).

---

## Gap #3 — HIL_PENDING was an unreachable state (FIXED)

### What was wrong
`HilOverlay.preTask` blocked internally (called `queue.waitForResolution`
synchronously) before returning.  The engine transitioned to `RUNNING` before
the chain ran, so there was never a window to set `HIL_PENDING`.  The state
existed in `VALID_TRANSITIONS` and tests but was never reachable during a real
workflow run.

### Correct behaviour
The `HilOverlay.preTask` MUST:
1. Create the HIL queue item.
2. Return **immediately** with `{ proceed: false, hil_trigger: true, data: { hil_id } }`.

The engine MUST:
1. On receiving `hil_trigger: true`: transition `RUNNING → HIL_PENDING`.
2. Call `overlay.awaitResolution(hilId)` — this is the blocking poll.
3. On `RESOLVED`: transition `HIL_PENDING → RUNNING`, continue to dispatch.
4. On `REJECTED` or timeout: transition `HIL_PENDING → FAILED`.

### Solution implemented
- `BaseOverlay` interface gains optional `awaitResolution?(hilId, pollIntervalMs?): Promise<OverlayResult>`.
- `HilOverlay.preTask` no longer blocks.  It creates the item and returns
  `hil_trigger: true` with `data.hil_id`.
- `HilOverlay.awaitResolution` is the extracted poll-and-emit method (previously
  the private `waitForHil`).
- Engine handles the `hil_trigger` branch as described above.
- On retry, `preTask` detects an existing PENDING HIL item for the same task_id
  and re-uses it (idempotent).

---

## Gap #4 / #22 — Empty `src/integration/` subdirectories (FIXED)

> **Note:** Gap #22 in `gap-analysis.md` ("src/integration/ dirs exist but are empty, Severity: Low")
> is the exact same issue as Gap #4 (Severity: High).  Both are resolved by the same fix below.

### What was wrong
`src/integration/claude-code/`, `src/integration/openai/`, and
`src/integration/roo-code/` were empty directories that implied additional
integration code beyond the adapters, creating a false impression of
completeness.

### Correct behaviour
Integration-specific runtime code lives in `src/adapters/`.  Integration
scaffolding (agent prompts, skill files, init templates) lives in
`data/integration/`.  Empty directories with no content and no planned near-term
use should not exist.

### Solution implemented
The three empty directories were deleted.  The remaining
`src/integration/mcp-server/server.ts` is correct and stays.

---

## Gap #5 — `ClaudeCodeAdapter` parsed a schema the CLI never produces (FIXED)

### What was wrong
`parseOutput` looked for `outputs`, `handover_state`, and
`usage.input_tokens` — fields that `claude --print --output-format json` does
not produce.  Every invocation fell through to the non-JSON fallback path,
returning zero token usage and raw stdout as the handover state.

### Correct `claude` CLI JSON schema (as of Claude Code CLI)
```json
{
  "result": "<response text>",
  "is_error": false,
  "total_input_tokens": 123,
  "total_output_tokens": 45,
  "total_cost_usd": 0.001,
  "session_id": "...",
  "num_turns": 1
}
```

### Correct behaviour
`parseOutput` MUST:
- Read `result` as the response content (→ `handover_state.raw_output`).
- Read `is_error` — if `true`, return `status: "FAILED"` with `error_type: "tool_error"`.
- Read `total_input_tokens` / `total_output_tokens` for `tokens_used`.
- Fall back to raw text (non-JSON stdout) as before.

### Solution implemented
`parseOutput` rewritten.  The `_task_id` parameter is now prefixed with `_`
(unused in the new implementation).

### Tests updated
`tests/adapters/claude-code-adapter.test.ts` — four parseOutput tests updated to
use the real CLI schema (`result`, `is_error`, `total_input_tokens`,
`total_output_tokens`).  An additional test covers the `is_error: true → FAILED`
path.

---

## Gap #6 — OpenAI adapter always returned empty `outputs` array (FIXED)

### What was wrong
`dispatch` always returned `outputs: []`.  Any task with declared outputs
produced no artifacts; the LLM response was only available in
`handover_state.raw_output`.

### Correct behaviour
When `context.task_definition.outputs` is non-empty AND `context.project_path`
is set:
1. The system prompt includes a **structured-output instruction** asking the
   model to return a JSON envelope:
   ```json
   { "files": [{ "path": "<declared_path>", "content": "..." }] }
   ```
2. The adapter parses the response, writes each declared file **atomically**
   (tmp + rename) to `project_path / file.path`.
3. Returns `outputs` populated with the written paths.

When outputs are not declared, or the model returns non-JSON, the adapter falls
back to `outputs: [], handover_state: { raw_output: content }`.

### Why `project_path` in `AgentContext`
The adapter needs to resolve relative output paths to absolute disk paths.
Rather than threading it through a new parameter on the adapter interface,
`project_path?: string` was added to `AgentContext` — it is semantically part of
the task execution context.  The engine reads it from
`stateManager.getState().project` and includes it in `assembleContext`.

### Files changed
- `src/types/index.ts` — `AgentContext.project_path?: string`
- `src/core/context-manager.ts` — `ContextAssemblyOptions.project_path?`,
  threaded into `assembleContext`
- `src/core/engine.ts` — passes `project_path` when assembling context
- `src/adapters/openai-adapter.ts` — structured output prompt + `writeOutputFiles`

---

## Invariants introduced / confirmed

| # | Invariant | Where enforced |
|---|-----------|----------------|
| 1 | `config.adapter.type` always determines the runtime adapter | `factory.ts` exhaustive switch + `satisfies never` |
| 2 | Overlay chain runs pre + post for every task dispatch | `engine.ts runTaskIteration` |
| 3 | `HIL_PENDING` is only reachable via the HIL overlay's `hil_trigger` signal | `engine.ts` + `hil-overlay.ts` |
| 4 | `preTask` never blocks the engine thread — it signals, engine waits | `BaseOverlay.awaitResolution` contract |
| 5 | `claude` CLI JSON schema is `result` / `is_error` / `total_*_tokens` | `claude-code-adapter.ts parseOutput` |
| 6 | OpenAI adapter writes files when outputs are declared | `openai-adapter.ts writeOutputFiles` |

| 7 | Policy gate T1 requires `tests_passed` or `lint_passed` in handover_state | `gate-overlay.ts postTask` |
| 8 | Policy gate T2 additionally requires `security_clean` in handover_state | `gate-overlay.ts postTask` |
| 9 | Injection detection in `complete-task` transitions task to `NEEDS_REWORK` | `complete-task.ts` injection branch |
| 10 | Paired overlay enabled on a task fails with actionable message instead of silent pass | `paired-overlay.ts postTask` |
| 11 | HIL notification hooks execute as shell subprocesses with context env vars | `hil-overlay.ts runNotifications` |
| 12 | `config.workflow` name respected in workflow file search order | `run.ts` wfPath resolution |
| 13 | `status` uses the actual loaded workflow name, not hardcoded `"workflow"` | `status.ts resolveWorkflowName` |
| 14 | `hil list --json` outputs machine-readable JSON for MCP agents | `hil.ts list --json` |
| 15 | `complete-task --output-path` validated against task's declared outputs | `complete-task.ts loadDeclaredOutputs` |
| 16 | `ConfidenceOverlay` uses `computeConfidence` from `src/eval/scorer.ts` | `confidence-overlay.ts buildMetrics` |
| 17 | Roo Code init generates 6 role-specific modes matching the default agent roles | `init.ts installRooCode ROO_AGENT_MODES` |
| 18 | `ai-sdd serve --mcp` uses stdio transport only; `--port` removed | `serve.ts` |
| 19 | `sdd-scaffold.md` excluded from `init --tool claude_code` agent installation | `init.ts EXCLUDED_AGENTS` |

---

## Coverage map — all 24 gaps

| Gap | Description | Status | Sprint |
|-----|-------------|--------|--------|
| 1 | MockAdapter hardcoded | **FIXED** | A |
| 2 | Overlay chain never invoked | **FIXED** | A |
| 3 | HIL_PENDING unreachable | **FIXED** | A |
| 4 | Empty `src/integration/` dirs | **FIXED** | A (also covers #22) |
| 5 | ClaudeCodeAdapter schema mismatch | **FIXED** | B |
| 6 | OpenAI adapter empty outputs | **FIXED** | B |
| 7 | `status --next` ignores DAG | deferred | Sprint C |
| 8 | `status --metrics` ignored | deferred | Sprint C |
| 9 | Injection detection → NEEDS_REWORK | **FIXED** | C |
| 10 | Policy gate T1/T2 evidence empty | **FIXED** | C |
| 11 | Paired overlay silent pass-through | **FIXED** | C |
| 12 | HIL notification hooks stubs | **FIXED** | C |
| 13 | `config.workflow` ignored in run | **FIXED** | C |
| 14 | Per-task timing always 0ms | **FIXED** | A (engine rewrite) |
| 15 | `status` hardcoded workflow name | **FIXED** | C |
| 16 | `hil list` no --json | **FIXED** | C |
| 17 | `complete-task` no output path validation | **FIXED** | C |
| 18 | Eval scorer disconnected | **FIXED** | C |
| 19 | Rate-limit / context config ignored | deferred | Phase 3 |
| 20 | Roo Code one generic mode | **FIXED** | D |
| 21 | `migrate` stub dead link | deferred | Phase 5 |
| 22 | Empty `src/integration/` dirs (duplicate of #4) | **FIXED** | A |
| 23 | MCP `--port` silently ignored | **FIXED** | D |
| 24 | `sdd-scaffold` agent copied by init | **FIXED** | D |
