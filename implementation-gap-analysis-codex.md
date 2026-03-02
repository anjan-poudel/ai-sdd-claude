# ai-sdd Claim vs Implementation Gap Analysis (Codex)

Date: 2026-03-02
Repo: `ai-sdd-claude`

## Scope and method
- Compared claimed behavior in `README.md`, `docs/USER_GUIDE.md`, and specs to current TypeScript implementation in `src/`.
- Verified baseline with `bun test` (218 passing tests).
- Focused on gaps between:
  - “says it does now” vs actual behavior
  - “says it will do” vs current readiness and migration path

## Executive summary
The largest functional gap is that runtime execution still behaves like a Phase-1 mock system while docs present full adapter + overlay orchestration as available. Most critical issues are integration wiring, not missing low-level building blocks.

## Priority gaps and proposed solutions

### 1) Adapter selection is documented, but `run` always uses `MockAdapter` (Critical)
- Claim:
  - `README.md:5` says tasks are dispatched to Claude Code/OpenAI/mock.
  - `docs/USER_GUIDE.md:600-630` documents adapter config for `claude_code` and `openai`.
- Actual:
  - `src/cli/commands/run.ts:96-97` hardcodes `const adapter = new MockAdapter();`.
- Impact:
  - Real adapter config in `.ai-sdd/ai-sdd.yaml` has no effect for workflow execution.
- Proposed solution:
  1. Add adapter factory (`createAdapter(config.adapter)`), supporting `mock`, `claude_code`, `openai` now.
  2. Fail fast for unsupported configured types (`roo_code`) with actionable message.
  3. Add integration tests for each adapter selection path.

### 2) Overlay chain is documented as core runtime behavior, but not wired into engine (Critical)
- Claim:
  - `README.md:5` and `README.md:217-221` describe HIL/evidence/review/paired/confidence overlays as execution chain.
- Actual:
  - Overlay chain helpers exist (`src/overlays/base-overlay.ts:62-89`) and overlay implementations exist, but engine imports/calls none (`src/core/engine.ts:1-80`).
- Impact:
  - No HIL gating, no policy gate verdicts, no review/paired/confidence effects during `ai-sdd run`.
- Proposed solution:
  1. Build overlay chain per task before dispatch and run `runPreTaskChain`.
  2. Run `runPostTaskChain` after adapter result; map `accept/new_status` to state transitions.
  3. Add tests that assert HIL_PENDING/NEEDS_REWORK transitions from overlays.

### 3) `status --next` returns all PENDING, not dependency-ready tasks (High)
- Claim:
  - `README.md:150` and MCP docs say “next ready tasks”.
- Actual:
  - `src/cli/commands/status.ts:45-49` filters only by `status === "PENDING"`.
- Impact:
  - MCP agents can pick blocked tasks, breaking autonomous loops.
- Proposed solution:
  1. Load workflow DAG in `status` and compute readiness from dependency completion.
  2. Return both `ready_tasks` and `blocked_tasks` with unmet deps for diagnostics.

### 4) `status --metrics` is exposed but ignored (High)
- Claim:
  - `README.md:151` says cost/token stats available.
- Actual:
  - Option exists (`src/cli/commands/status.ts:28`) but is never used.
- Impact:
  - Observability promise is incomplete from operator perspective.
- Proposed solution:
  1. Persist per-task token/cost/duration in state or sidecar metrics file.
  2. Implement `--metrics` rendering (table + JSON).
  3. Add regression tests for metric output contract.

### 5) MCP “port” interface is misleading; server is stdio-only (High)
- Claim:
  - `README.md:203` / `docs/USER_GUIDE.md:593` imply `--port` network endpoint.
- Actual:
  - Uses `StdioServerTransport` (`src/integration/mcp-server/server.ts:7,182-184`); `port` is unused.
- Impact:
  - Operator confusion; integration setup mismatch (especially Roo workflows).
- Proposed solution:
  1. Either implement streamable HTTP transport and honor `--port`, or
  2. Remove/deprecate `--port` and document stdio-only behavior explicitly.

### 6) Roo integration docs promise role modes; init generates one generic mode (Medium)
- Claim:
  - `docs/USER_GUIDE.md:688` says choose `sdd-ba`, `sdd-architect`, etc.
- Actual:
  - `src/cli/commands/init.ts:189-196` writes only one mode: `ai-sdd-agent`.
- Impact:
  - Documented operator flow cannot be followed as written.
- Proposed solution:
  1. Generate the 6 role-specific modes in `.roomodes`, aligned with default agent roles.
  2. Add fixture test for `init --tool roo_code` output files.

### 7) Codex guide references `ai-sdd hil list --json`, but CLI does not support it (Medium)
- Claim:
  - `docs/USER_GUIDE.md:671` includes `hil list --json`.
- Actual:
  - No `--json` option in HIL commands (`src/cli/commands/hil.ts:15-93`).
- Impact:
  - Scripted loops/docs break.
- Proposed solution:
  1. Add `--json` to `hil list/show`.
  2. Keep current human-readable output as default.

### 8) `complete-task` injection failure says NEEDS_REWORK but does not transition state (Medium)
- Claim:
  - Transaction semantics indicate explicit state behavior; error message says task set to NEEDS_REWORK.
- Actual:
  - Injection branch exits without transition (`src/cli/commands/complete-task.ts:90-97`).
- Impact:
  - State and operator messaging diverge.
- Proposed solution:
  1. Mirror secret-detection branch behavior: load state + `transition(taskId, "NEEDS_REWORK", ...)` before exit.

### 9) `complete-task` says output path is allowlisted, but only path traversal is enforced (Medium)
- Claim:
  - CLI option text: allowlisted output path (`src/cli/commands/complete-task.ts:30`).
- Actual:
  - Validation only checks project-bound path traversal.
- Impact:
  - Agents can write undeclared artifacts unexpectedly.
- Proposed solution:
  1. Load workflow + task definition and enforce output path in declared `outputs` for the task.
  2. Provide override flag for intentionally dynamic outputs if needed.

### 10) Workflow config field exists but run-path ignores configurable workflow name/path (Medium)
- Claim:
  - Config includes `workflow` field (`src/types/index.ts:216-219`, `docs/USER_GUIDE.md:735`).
- Actual:
  - `run` uses fixed lookup order and does not read `config.workflow` (`src/cli/commands/run.ts:37-49`).
- Impact:
  - Config contract is partially non-functional.
- Proposed solution:
  1. Resolve workflow from `config.workflow` first (if provided), with existing fallback order.
  2. Validate missing configured workflow as hard error.

### 11) Migration UX mismatch: docs encourage `ai-sdd migrate`, command is stub (Low, acknowledged)
- Claim:
  - Schema mismatch errors direct users to migrate (`README.md:304`).
- Actual:
  - Stub command (`src/cli/commands/migrate.ts:1-45`).
- Impact:
  - Manual intervention needed for schema drift.
- Proposed solution:
  1. Implement minimal v1->v1 state/config verifier and no-op migration now.
  2. Keep full multi-version migrations in Phase 5.

### 12) Documentation drift: test count outdated (Low)
- Claim:
  - README says 195 tests (`README.md:332`).
- Actual:
  - Current suite reports 218 passing tests.
- Impact:
  - Minor trust/maintenance signal.
- Proposed solution:
  1. Update README test count or remove hardcoded number.

## Suggested delivery plan

### Sprint A (stabilize core truthfulness)
1. Wire adapter factory into `run`.
2. Wire overlay chain into engine execution.
3. Fix `status --next` readiness semantics.
4. Fix `complete-task` injection transition bug.

### Sprint B (operator contract completion)
1. Implement `status --metrics` end-to-end.
2. Align MCP transport/CLI flags (`--port` behavior).
3. Add HIL JSON output and Codex loop parity.
4. Enforce output allowlist by task definition.

### Sprint C (integration consistency + docs)
1. Expand Roo mode scaffolding to role-specific modes.
2. Respect `config.workflow` in run path resolution.
3. Deliver minimal `migrate` verifier/no-op and update docs.
4. Sweep docs for drift (test counts, command examples, behavior notes).

## Validation checklist after fixes
- `run` dispatches to configured adapter type.
- Enabling HIL/policy/review overlays changes runtime task states as documented.
- `status --next --json` returns only dependency-ready tasks.
- `status --metrics` outputs non-empty metrics after a run.
- `serve --mcp` behavior matches docs (stdio vs network).
- `hil list --json` works and is documented.
- `complete-task` enforces declared outputs and consistent NEEDS_REWORK transitions.

