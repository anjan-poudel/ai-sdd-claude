# ai-sdd Implementation Gap Analysis

**Date:** 2026-03-03
**Reviewer:** Claude Code (claude-sonnet-4-6)
**Scope:** `src/` vs `README.md`, `CLAUDE.md`, `data/`, and the existing Codex gap analysis

---

## Executive Summary

`ai-sdd` has a solid structural skeleton — types, interfaces, state machine, DSL, and individual overlay classes are all in place. However, the project remains in a **Phase 1 mock execution state**: none of the real adapters are wired in, the overlay chain is never invoked by the engine, and several CLI commands have features that are parsed but silently ignored. The gap between what the framework documents and what it actually does during `ai-sdd run` is large.

The previous gap analysis (`implementation-gap-analysis-codex.md`, 2026-03-02) captured the most critical issues accurately. This document extends that analysis with additional gaps found by reading every relevant source file.

---

## Severity Definitions

| Severity | Meaning |
|---|---|
| **Critical** | Feature is documented as working but is hardcoded/stubbed/never called — breaks the core promise |
| **High** | Feature is partially wired or has a correctness bug that will surface in real use |
| **Medium** | Documented feature is missing, inconsistent, or produces misleading output |
| **Low** | Minor drift, naming, or cosmetic issue |

---

## Gaps

### 1. Adapter selection is hardcoded to MockAdapter — real LLMs never run
**Severity: Critical**
**File:** `src/cli/commands/run.ts:97`

```ts
// Adapter (Phase 1: use mock unless adapter.type configured)
const adapter = new MockAdapter();
```

The comment acknowledges this. `ClaudeCodeAdapter` and `OpenAIAdapter` both exist with full implementations. `config.adapter.type` is parsed from `.ai-sdd/ai-sdd.yaml` and available in `config` at line 35, but it is never read. There is no adapter factory anywhere in the codebase.

**Effect:** Every `ai-sdd run` invocation — regardless of `adapter.type: claude_code` or `adapter.type: openai` in config — silently runs against the mock. Users who follow the setup guide will get mock completions and no LLM calls.

---

### 2. Overlay chain never called by the engine
**Severity: Critical**
**File:** `src/core/engine.ts` (entire file)

Five overlay classes exist with full logic:
- `HilOverlay` (`src/overlays/hil/hil-overlay.ts`)
- `PolicyGateOverlay` (`src/overlays/policy-gate/gate-overlay.ts`)
- `ReviewOverlay` (`src/overlays/review/review-overlay.ts`)
- `PairedOverlay` (`src/overlays/paired/paired-overlay.ts`)
- `ConfidenceOverlay` (`src/overlays/confidence/confidence-overlay.ts`)

The composition utilities (`buildOverlayChain`, `runPreTaskChain`, `runPostTaskChain`) are implemented in `src/overlays/base-overlay.ts:62-92`. None of them are imported or called from `engine.ts`.

The engine's `runTaskIteration` method goes directly:
```
pre_task hook → RUNNING transition → assembleContext → adapter.dispatchWithRetry → COMPLETED/FAILED
```

**Effect:**
- HIL gating never fires; tasks never enter `HIL_PENDING`
- Evidence gate never runs; no gate reports are written during `run`
- Review overlay never runs; `NO_GO` decisions have no effect
- Paired workflow is unreachable
- Confidence events are never emitted via the overlay

The `HIL_PENDING` state is unreachable during normal workflow execution despite being in the state machine and documented throughout.

---

### 3. HIL_PENDING is an orphan state
**Severity: Critical** (consequence of gap 2)
**File:** `src/types/index.ts` (VALID_TRANSITIONS), `src/core/engine.ts`

`VALID_TRANSITIONS` includes `RUNNING → HIL_PENDING` and `HIL_PENDING → RUNNING`, but no code path in the engine ever calls `stateManager.transition(taskId, "HIL_PENDING", ...)`. HIL items can be created and resolved via the CLI (`hil list/resolve/reject`), but the engine will never pause a task to wait for them.

---

### 4. `src/integration/` subdirectories are all empty
**Severity: High**
**Paths:** `src/integration/claude-code/`, `src/integration/openai/`, `src/integration/roo-code/`

All three are empty directories. The framework documentation and README describe integration-specific behavior for each tool (Roo Code MCP wiring, OpenAI batch, Claude Code agent protocol), but there is no implementation code in these locations.

---

### 5. `ClaudeCodeAdapter` output parsing is likely broken in practice
**Severity: High**
**File:** `src/adapters/claude-code-adapter.ts:125-147`

The adapter spawns `claude --print --output-format json <prompt>` and then tries to parse a specific schema:
```ts
outputs: parsed["outputs"] ?? []
handover_state: parsed["handover_state"] ?? {}
tokens_used from parsed["usage"]["input_tokens"]
```

The `claude` CLI with `--print --output-format json` does not natively produce a response with `outputs`, `handover_state`, or `usage.input_tokens` keys — it returns an array of content blocks and metadata in a different schema. This means the adapter would always fall through to the non-JSON fallback (`raw_output: stdout.trim()`) and produce no structured outputs or token usage data.

Additionally, `--print` is a non-interactive mode that may not be the correct flag for headless operation in all versions of the Claude CLI.

---

### 6. OpenAI adapter always returns empty `outputs` array
**Severity: High**
**File:** `src/adapters/openai-adapter.ts:101-106`

```ts
return {
  status: "COMPLETED",
  outputs: [],           // ← always empty
  handover_state: { raw_output: content },
  tokens_used: tokenUsage,
};
```

The LLM response is placed in `handover_state.raw_output` but `outputs` is always `[]`. Any task that declares `outputs:` in its definition will have zero actual artifacts written. The `complete-task` flow (which is what actually writes files) is never triggered from within the OpenAI adapter.

---

### 7. `status --next` returns all PENDING tasks, not dependency-ready ones
**Severity: High**
**File:** `src/cli/commands/status.ts:44-54`

```ts
const ready = Object.entries(state.tasks)
  .filter(([, s]) => s.status === "PENDING")
  .map(([id, s]) => ({ id, ...s }));
```

This returns every PENDING task, including those whose dependencies have not yet completed. The `WorkflowLoader` is imported but never instantiated in `status.ts`. MCP agents calling `get_next_task` can pick up tasks whose predecessors haven't finished, breaking autonomous workflow loops.

---

### 8. `status --metrics` option is parsed but completely ignored
**Severity: High**
**File:** `src/cli/commands/status.ts:28,30`

The `--metrics` option is registered at line 28 but `options.metrics` is never referenced in the action handler. The `CostTracker` in the engine accumulates per-task costs in memory, but they are never persisted to state or read by `status`. Running `ai-sdd status --metrics` produces identical output to `ai-sdd status`.

---

### 9. `complete-task` injection detection does not set NEEDS_REWORK
**Severity: High**
**File:** `src/cli/commands/complete-task.ts:89-97`

The secret detection branch (lines 65-82) correctly loads state and calls `stateManager.transition(taskId, "NEEDS_REWORK", ...)`. The injection detection branch (lines 89-97) prints an error message and exits **without** performing any state transition. The error message says "Task set to NEEDS_REWORK" but no state change occurs.

---

### 10. Policy gate T1/T2 evidence check is commented out
**Severity: High**
**File:** `src/overlays/policy-gate/gate-overlay.ts:49-56`

```ts
// T1: acceptance + verification evidence
if (riskTier === "T1" || riskTier === "T2") {
  const hasVerification = result.handover_state?.["tests_passed"] === true || ...
  if (!hasVerification) {
    // Advisory warning — not a hard failure in Phase 1
    // Phase 3 will add full evidence collection
  }
}
```

Even if the overlay chain were wired in (gap 2), T1 and T2 risk tiers would not enforce any additional evidence requirements. A T1 task with no tests passes the gate. A T2 task requires only `outputs.length > 0`.

---

### 11. Paired overlay is a complete pass-through stub
**Severity: High**
**File:** `src/overlays/paired/paired-overlay.ts:25-37`

```ts
// Phase 1 stub — paired workflow is Phase 3
// In full implementation, this would:
// 1. Run challenger agent on same task
// 2. Compare driver vs challenger outputs
// 3. Return consensus or flag divergence

// Phase 1: pass-through
return { accept: true, new_status: "COMPLETED" };
```

The paired workflow is documented as a core overlay feature. Its implementation is explicitly deferred to Phase 3.

---

### 12. HIL notification hooks are stubs
**Severity: Medium**
**File:** `src/overlays/hil/hil-overlay.ts:129-145`

```ts
// Hooks are shell commands (Phase 2 feature — stub for now)
void hooks;
void hilId;
void ctx;
```

The `notify.on_created` and `notify.on_t2_gate` config fields are accepted in the schema and documented in `data/config/defaults.yaml`, but the hook runner does nothing. No shell commands are ever executed for notifications.

---

### 13. `config.workflow` field is ignored by the run command
**Severity: Medium**
**File:** `src/cli/commands/run.ts:37-49`, `src/config/defaults.ts:10`

`DEFAULT_CONFIG.workflow = "default-sdd"` and `ProjectConfig` has a `workflow` field, but `run.ts` uses its own hardcoded 3-path lookup order and never reads `config.workflow`. A user who sets `workflow: custom-workflow` in `.ai-sdd/ai-sdd.yaml` will not have it respected.

---

### 14. Engine does not track per-task timing
**Severity: Medium**
**File:** `src/core/engine.ts:349`

```ts
this.emitter.emit("task.completed", {
  task_id: taskId,
  duration_ms: 0, // TODO: track per-task timing
  ...
});
```

All `task.completed` events report `duration_ms: 0`. The start time is not captured when a task iteration begins.

---

### 15. `status` command uses hardcoded workflow name "workflow"
**Severity: Medium**
**File:** `src/cli/commands/status.ts:34`

```ts
const stateManager = new StateManager(stateDir, "workflow", projectPath);
```

The StateManager is initialized with the string `"workflow"` hardcoded, but the actual workflow name comes from the loaded YAML (`workflow.config.name`). If the workflow is not named exactly `"workflow"`, the state file path won't match what the engine wrote. The `run` command uses the actual workflow name from `WorkflowLoader.loadFile(wfPath)`.

---

### 16. `hil list` and `hil show` lack `--json` output
**Severity: Medium**
**File:** `src/cli/commands/hil.ts:15-40`

`hil list` outputs only human-readable text. The MCP server's `list_hil_items` tool calls `hil list` and receives plain text, which an agent cannot reliably parse. `hil show` already outputs JSON (`console.log(JSON.stringify(item, null, 2))`), but `hil list` does not.

---

### 17. `complete-task` does not validate output path against task-declared outputs
**Severity: Medium**
**File:** `src/cli/commands/complete-task.ts:30,43-57`

The `--output-path` option description says "must be allowlisted," but the only check is a path-traversal guard (`rel.startsWith("..")`). The implementation never loads the workflow or task definition to verify that `outputPath` matches a path declared in the task's `outputs:` list. An agent can write to any path inside the project directory.

---

### 18. `src/eval/` scoring framework is completely disconnected
**Severity: Medium**
**File:** `src/eval/scorer.ts`, `src/eval/metrics.ts`

`computeConfidence()` and `validateLLMJudge()` are fully implemented with weighted metric types. The `ConfidenceOverlay` (gap 2) exists but uses a completely separate, ad-hoc heuristic score (`src/overlays/confidence/confidence-overlay.ts:45-52`) that doesn't use the eval framework. The eval module is never imported anywhere except tests.

---

### 19. Config fields `context_warning_threshold_pct`, `context_hil_threshold_pct`, and `rate_limit_requests_per_minute` have no implementation
**Severity: Medium**
**File:** `src/config/defaults.ts:17-19`

These three fields are defined in `DEFAULT_CONFIG.engine` and accepted in the config schema but are never read by the engine. Context window management and rate-limit throttling are undocumented as pending features.

---

### 20. Roo Code `init` generates a single generic mode, not role-specific modes
**Severity: Medium**
**File:** `src/cli/commands/init.ts:182-199`

`installRooCode()` writes a single `ai-sdd-agent` mode to `.roomodes`. The six default agent roles (ba, architect, pe, le, dev, reviewer) each have their own `.md` files in `data/integration/claude-code/agents/`, but there is no Roo-specific equivalent. The `data/integration/roo-code/` directory in the data layer does not exist.

---

### 21. `migrate` is a complete stub with a dead link
**Severity: Low**
**File:** `src/cli/commands/migrate.ts`

The command prints "not yet implemented" and exits 0. It also references `https://github.com/your-org/ai-sdd` — a placeholder URL that was never updated.

---

### 22. `src/integration/` integration module directories exist but are empty
**Severity: Low (structural)**
**Paths:** `src/integration/claude-code/`, `src/integration/roo-code/`, `src/integration/openai/`

Three empty directories. These were presumably intended for integration-specific logic but have no files. This creates the false impression of integration support beyond what the adapters in `src/adapters/` provide.

---

### 23. MCP `--port` is accepted and silently ignored
**Severity: Low**
**File:** `src/cli/commands/serve.ts`, `src/integration/mcp-server/server.ts:182-184`

`serve --mcp --port 3000` is documented in the README. The `McpServerOptions` type has a `port?: number` field. The server always uses `StdioServerTransport` with no HTTP/SSE transport path. The `port` option is ignored entirely.

---

### 24. README documents `sdd-scaffold` skill but it is not in `sdd-run`/`sdd-status` skills listing
**Severity: Low**
**File:** `data/integration/claude-code/skills/sdd-scaffold/SKILL.md` exists
**File:** `data/integration/claude-code/agents/sdd-scaffold.md` — a scaffold **agent** also exists

The distinction between `sdd-scaffold` as a skill vs. an agent file is potentially confusing. The init flow copies all agent `.md` files from `data/integration/claude-code/agents/` to `.claude/agents/`, which would include `sdd-scaffold.md` as a sub-agent.

---

## Summary Table

| # | Gap | Severity | File(s) |
|---|-----|----------|---------|
| 1 | MockAdapter hardcoded; real adapters never run | **Critical** | `run.ts:97` |
| 2 | Overlay chain never invoked by engine | **Critical** | `engine.ts` |
| 3 | `HIL_PENDING` is an unreachable state | **Critical** | `engine.ts`, `types/index.ts` |
| 4 | `src/integration/` subdirectories all empty | **High** | `src/integration/` |
| 5 | `ClaudeCodeAdapter` output parsing schema mismatch | **High** | `claude-code-adapter.ts:125` |
| 6 | OpenAI adapter always returns empty `outputs` | **High** | `openai-adapter.ts:101` |
| 7 | `status --next` ignores dependency DAG | **High** | `status.ts:44` |
| 8 | `status --metrics` parsed but ignored | **High** | `status.ts:28` |
| 9 | Injection detection doesn't transition to NEEDS_REWORK | **High** | `complete-task.ts:89` |
| 10 | Policy gate T1/T2 evidence check stubbed out | **High** | `gate-overlay.ts:49` |
| 11 | Paired overlay is a complete pass-through | **High** | `paired-overlay.ts:25` |
| 12 | HIL notification hooks are stubs | **Medium** | `hil-overlay.ts:129` |
| 13 | `config.workflow` ignored by run command | **Medium** | `run.ts:37` |
| 14 | Per-task timing always reports 0ms | **Medium** | `engine.ts:349` |
| 15 | `status` uses hardcoded name "workflow", not actual workflow name | **Medium** | `status.ts:34` |
| 16 | `hil list` has no `--json` output | **Medium** | `hil.ts:15` |
| 17 | `complete-task` doesn't validate against declared task outputs | **Medium** | `complete-task.ts:43` |
| 18 | `src/eval/` scoring framework disconnected from overlays | **Medium** | `scorer.ts`, `confidence-overlay.ts` |
| 19 | Config fields `rate_limit_requests_per_minute` etc. never read | **Medium** | `defaults.ts:17` |
| 20 | Roo Code init generates one generic mode, not role-specific | **Medium** | `init.ts:182` |
| 21 | `migrate` stub has dead placeholder URL | **Low** | `migrate.ts` |
| 22 | `src/integration/` dirs exist but are empty | **Low** | `src/integration/` |
| 23 | MCP `--port` accepted but silently ignored | **Low** | `server.ts:182` |
| 24 | `sdd-scaffold` skill vs. agent distinction unclear | **Low** | `data/integration/` |

---

## Suggested Sprint Groupings

### Sprint A — Make `ai-sdd run` tell the truth (Critical gaps)
1. Add adapter factory (`createAdapter(config.adapter)`) and wire it into `run.ts`
2. Instantiate and wire overlay chain in `engine.runTaskIteration` (pre + post chain calls)
3. Handle `hil_trigger: true` pre-chain result → transition to `HIL_PENDING` + poll
4. Fix `status --next` to load workflow DAG and filter by dependency readiness

### Sprint B — Correctness fixes (High gaps)
5. Fix `ClaudeCodeAdapter.parseOutput` to match actual `claude` CLI JSON schema
6. Make OpenAI adapter support structured artifact output (or document it as text-only)
7. Fix `complete-task` injection branch to perform NEEDS_REWORK transition
8. Implement `status --metrics` using persisted CostTracker data
9. Implement Policy gate T1/T2 evidence enforcement

### Sprint C — Feature completeness (Medium gaps)
10. Execute HIL notification shell hooks
11. Respect `config.workflow` in run path resolution
12. Add per-task start-time capture; report real `duration_ms`
13. Fix `status` to use the actual loaded workflow name
14. Add `--json` to `hil list`
15. Enforce declared output paths in `complete-task`
16. Wire `src/eval/scorer.ts` into `ConfidenceOverlay`

### Sprint D — Polish and Phase 3 (Low + deferred)
17. Implement Roo Code role-specific modes in init
18. Either implement streamable HTTP transport or remove `--port` flag
19. Implement `migrate` verifier (even a no-op v1→v1)
20. Populate or remove `src/integration/` subdirectories
21. Fix placeholder URL in `migrate.ts`
