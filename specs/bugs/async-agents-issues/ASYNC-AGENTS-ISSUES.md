# ai-sdd Issues & Bugs — Running Sheet

_Project: ai-coaching-assistant | Session started: 2026-03-12_
_Last updated: 2026-03-13 — all 12 issues resolved_

---

## Open Issues

_None._

---

## Resolved Issues

| ID | Summary | Severity | Resolved | Fix |
|----|---------|----------|---------|-----|
| ISSUE-001 | Agent hangs indefinitely — no output, no error | Critical | 2026-03-13 | Incremental stdout/stderr streaming chunk-by-chunk in `claude-code-adapter.ts`; liveness ticker warns if no output for N min (`AI_SDD_LIVENESS_INTERVAL_MS`, default 5 min) with `tail -f` hint |
| ISSUE-002 | Agent never calls `complete-task` — gate fails with "No outputs produced" | Critical | 2026-03-13 | All 5 agent prompts (`sdd-ba`, `sdd-le`, `sdd-architect`, `sdd-pe`, `sdd-dev`) corrected to use `ai-sdd complete-task` with correct `specs/` output paths |
| ISSUE-003 | T1 policy gate on review tasks incorrectly requires test/lint evidence | High | 2026-03-13 | `risk_tier: T1 → T0` in `review-l1.yaml` and `review-l2.yaml`; override added in `workflow.yaml` |
| ISSUE-004 | Default agent timeout (5 min) too low for Claude Code subagents | High | 2026-03-13 | Default raised to 10 min in `claude-code-adapter.ts`; `timeout_ms: 1200000` in `ai-sdd.yaml`; `FAIL_ON_TASK_TIMEOUT=false` mode warns and waits instead of failing |
| ISSUE-005 | `hil resolve` doesn't advance workflow state — engine re-enters same task | High | 2026-03-13 | `hil resolve` (and `hil approve`) now transitions `HIL_PENDING → RUNNING` in `workflow-state.json` after resolving the queue item (`src/cli/commands/hil.ts`) |
| ISSUE-006 | Concurrent `ai-sdd run` processes clobber workflow state | High | 2026-03-13 | PID lock file (`engine.pid`) in session dir; second run checks liveness of existing PID and refuses to start if alive; stale locks cleaned up automatically (`src/cli/commands/run.ts`) |
| ISSUE-007 | No liveness or diagnostic visibility into running agent | Medium | 2026-03-13 | Agent stdout/stderr streamed live to `.ai-sdd/sessions/default/logs/<task-id>.log`; progress printer on stdout shows `▶ started`, `✓ completed`, `↺ rework`, `⏸ HIL`, `✗ failed` events with elapsed time and token counts (`src/cli/commands/run.ts`) |
| ISSUE-008 | `ai-sdd hil approve` command does not exist | Low | 2026-03-13 | `approve` added as alias for `resolve` in `src/cli/commands/hil.ts` |
| ISSUE-009 | `ai-sdd status --task <id>` not supported | Low | 2026-03-13 | `--task <id>` option added to `status` command showing per-task detail: status, iterations, duration, tokens, cost, rework feedback, error, outputs (`src/cli/commands/status.ts`) |
| ISSUE-010 | `complete-task` rejects `FAILED → COMPLETED` — no recovery path | Medium | 2026-03-13 | `ai-sdd task reset <id>` command added; directly patches `workflow-state.json` bypassing state machine; supports `--to PENDING\|RUNNING\|NEEDS_REWORK` (`src/cli/commands/task.ts`) |
| ISSUE-011 | Collaboration hooks (Confluence/Jira) not firing after manual state repair | Medium | 2026-03-13 | `ai-sdd task replay-hooks <id>` command added; re-fires Confluence page update and Jira status transition using stored `collaboration_refs` from `async_state`; supports `--dry-run` (`src/cli/commands/task.ts`) |
| ISSUE-012 | Agent prompts reference stale `.ai-sdd/outputs/` paths | Medium | 2026-03-13 | All 5 agent files updated: `sdd-ba.md`, `sdd-le.md`, `sdd-architect.md`, `sdd-pe.md`, `sdd-dev.md` — all paths corrected to `specs/<task-id>.md` convention matching the task library |

---

## Root cause retrospective

See `specs/bugs/ASYNC-AGENTS-RETROSPECTIVE.md` for the full post-mortem on why these issues
arose (nested Claude Code session block, no integration tests for the `complete-task` pathway,
agent prompt drift from the task library, incomplete CLI surface design).

---

## Concurrency issues identified (follow-on work)

A separate concurrency audit identified race conditions in the engine, state manager, adapter,
and collaboration layer. These are tracked as follow-on work and not yet fixed:

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| C1 | `StateManager` non-atomic RMW under concurrent `transition()` + `updateTaskFields()` | Critical | Open |
| C2 | PID lock TOCTOU window between existence check and write | High | Open |
| C3 | `ClaudeCodeAdapter` liveness timer not in `finally` block — can leak on timeout | High | Open |
| C4 | Multiple HIL creation paths can overwrite `hil_item_id` for same task | High | Open |
| C5 | `AsyncTaskManager` listener registered after Slack notification posted — approval signal drop window | High | Open |
| C6 | `HilQueue` + state transition not atomic — partial resolution if CLI crashes between the two writes | High | Open |
| C7 | `ApprovalManager` dedup check races with concurrent approvals from same stakeholder | Medium | Open |
