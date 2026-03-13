# Async-Agents Implementation Retrospective

_Root cause analysis of issues discovered during ai-coaching-assistant integration testing._
_Date: 2026-03-13_

---

## Why the implementation was so poor

### 1. Agents never executed real code

The `sdd-run` skill ran inside Claude Code, which blocked nested `claude` CLI spawning
(`CLAUDECODE=1` env var). Every implement task fell back to the skill agent acting as the
developer directly — writing notes files and calling `ai-sdd complete-task` manually.

**Consequence**: No code was ever actually executed. The implementation was a documentation
exercise masquerading as working software. Bugs that would have been caught in 30 seconds of
real execution (wrong output paths, missing CLI commands) shipped undetected.

### 2. No integration test for the full agent → complete-task pathway

Dev standards §7 requires "one integration test per CLI command". The `complete-task`
command had unit tests but **no end-to-end test that exercised the full pathway**:
agent writes file → calls `complete-task` → state advances → next task unblocked.

Because this pathway was never tested as a whole, the output path mismatch between agent
prompts (`.ai-sdd/outputs/…`) and task library (`specs/…`) went unnoticed.

### 3. Agent prompts were never validated against the task library

`sdd-ba.md` and `sdd-le.md` referenced `.ai-sdd/outputs/` paths that were from an earlier
layout that no longer matched. The task library had moved to `specs/` but the agent prompts
were not updated. There was no automated check for this drift.

### 4. The CLI surface was incompletely specified

Real users immediately needed:
- `ai-sdd hil approve` (vs `resolve`) — ISSUE-008
- `ai-sdd status --task <id>` — ISSUE-009
- `ai-sdd task reset` for FAILED recovery — ISSUE-010
- `ai-sdd hil resolve` advancing state when engine is dead — ISSUE-005

None of these were in the spec. The spec was written from the engine's perspective, not
the operator's. No user-journey walkthroughs were conducted.

### 5. No liveness feedback during long-running tasks

Tasks silently vanish for 20+ minutes with no output. Users have no way to distinguish
"working hard" from "hung". This is a usability gap that produces operator panic, manual
kills, and cascading state corruption (ISSUE-006).

---

## Mitigations applied to ai-sdd

### A. Fixes shipped in this session

| Issue | Fix | File |
|-------|-----|------|
| ISSUE-005 | `hil resolve` now advances `HIL_PENDING → RUNNING` in state file | `src/cli/commands/hil.ts` |
| ISSUE-007/001 | Agent stdout streamed to `.ai-sdd/sessions/default/logs/<task-id>.log` | `src/adapters/claude-code-adapter.ts` |
| ISSUE-008 | `hil approve` added as alias for `hil resolve` | `src/cli/commands/hil.ts` |
| ISSUE-009 | `status --task <id>` shows per-task detail | `src/cli/commands/status.ts` |
| ISSUE-010 | `ai-sdd task reset <id>` resets FAILED tasks to PENDING | `src/cli/commands/task.ts` |
| ISSUE-002/012 | `sdd-ba.md` and `sdd-le.md` output paths corrected to `specs/` | `data/integration/claude-code/agents/` |
| CLAUDECODE nested | `CLAUDECODE` stripped from spawn env | `src/adapters/claude-code-adapter.ts` |

### B. Process mitigations — to add to ai-sdd constitution

The following must be added to `specs/CONTRACTS.md` §13:

#### B1. Agent prompt output paths are contracts

Every agent `.md` file in `data/integration/claude-code/agents/` must have its
`--output-path` argument audited against the task library after any task library change.
Add a test:

```typescript
// tests/agent-prompts.test.ts
it("agent output paths match task library", () => {
  // parse each agent .md, extract --output-path, assert it matches
  // the task library entry for that task
});
```

#### B2. Mandate operator journey tests per workflow phase

For each workflow phase, add one integration test that:
1. Creates a real (temp) project dir
2. Runs the phase via `ai-sdd run --dry-run` or mock adapter
3. Calls `ai-sdd complete-task` with a real tmp file
4. Asserts the state advances to COMPLETED

This catches ISSUE-002 class bugs before they reach users.

#### B3. Tail log command

For agent visibility, add to the CLI reference:

```bash
# Tail live agent output while a task is RUNNING:
tail -f .ai-sdd/sessions/default/logs/<task-id>.log
```

This is the interim solution until a proper `ai-sdd logs --follow` is implemented.

#### B4. File lock on workflow state (ISSUE-006 — open)

The state manager uses atomic tmp+rename but has no advisory lock preventing concurrent
processes from both loading stale state. Options:

1. **Recommended**: PID lock file — `ai-sdd run` creates `.ai-sdd/engine.pid` on start
   and removes it on exit. A second `ai-sdd run` reads the PID, checks if it is alive,
   and refuses to start if so. Operator guidance: kill the PID file manually if the engine
   was killed uncleanly.

2. **Longer term**: Daemon model — `ai-sdd run` sends a message to a long-running engine
   daemon over a Unix socket, rather than starting a new engine process.

#### B5. Collaboration hooks replay (ISSUE-011 — open)

Manual state repairs bypass post-task hooks (Confluence publish, Jira sync).
Add `ai-sdd task replay-hooks <id>` that re-fires post-task hooks for a given task
using the stored outputs in `collaboration_refs`.

---

## Remaining open issues

| Issue | Severity | Status | Path to fix |
|-------|----------|--------|-------------|
| ISSUE-001 | Critical | Partial | stdout liveness monitor (no output for N min → warn + optional kill) |
| ISSUE-006 | High | Open | PID lock file (see §B4 above) |
| ISSUE-011 | Medium | Open | `task replay-hooks` command (see §B5 above) |
