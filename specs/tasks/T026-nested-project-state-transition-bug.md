# T026: Nested Project State Transition Bug

## Problem

When running ai-sdd workflows from nested spec projects (e.g., `specs/async-agents/`), two related bugs prevent proper state management:

### Bug 1: HIL Resolution Path Mismatch
The `sdd-run` skill and `ai-sdd hil resolve` command resolve the project path relative to the parent project root, not the nested spec project's `.ai-sdd/` directory. This means:
- `ai-sdd hil list --json` from the parent project returns empty `pending_hil_items: []`
- `ai-sdd hil resolve <id>` from the parent project returns "HIL item not found"
- Only running from inside the nested project directory (`cd specs/async-agents && ai-sdd hil list`) finds the correct HIL items

**Root cause:** `resolveSession()` and HIL queue path resolution don't account for CWD being inside a nested spec project with its own `.ai-sdd/` directory.

### Bug 2: Task Stuck in PENDING After Engine Failure
When the engine fails mid-execution (e.g., nested Claude Code session error), the task state is reset from RUNNING/HIL_PENDING back to PENDING. This creates a dead state where:
- `complete-task` rejects the transition: "Invalid transition: PENDING -> COMPLETED. Allowed: RUNNING, CANCELLED"
- The only recovery is manual JSON editing of `workflow-state.json`
- The task retains the `error` field from the failure, but the status doesn't reflect it

**Expected behavior:** Failed tasks should be in FAILED state (not PENDING), and there should be a CLI command to retry/reset a failed task cleanly.

## Reproduction

1. `cd specs/async-agents` (a nested spec project with its own `.ai-sdd/`)
2. `ai-sdd run` -- triggers HIL gate, creates HIL item
3. From parent project: `ai-sdd hil list --json` -- returns empty (Bug 1)
4. If engine fails (e.g., nested Claude Code): task is PENDING with error field (Bug 2)
5. `ai-sdd complete-task --task define-requirements ...` -- rejects PENDING -> COMPLETED

## Affected Files
- `src/core/session-resolver.ts` -- project path resolution
- `src/overlays/hil/hil-queue.ts` -- HIL queue path construction
- `src/cli/commands/hil.ts` -- `--feature` flag doesn't cover nested spec projects
- `src/cli/commands/run.ts` -- task state reset on failure
- `.claude/skills/sdd-run/SKILL.md` -- skill doesn't pass correct project context

## Proposed Fix

### For Bug 1:
- `resolveSession()` should detect when CWD is inside a nested spec project and use that project's `.ai-sdd/` directory
- Alternatively, add a `--project` flag to `ai-sdd hil` commands to explicitly set the project root

### For Bug 2:
- On engine failure, tasks should transition to FAILED (not reset to PENDING)
- Add `ai-sdd task reset <id>` CLI command to cleanly reset a failed task to PENDING for retry
- `complete-task` could accept a `--force` flag to bypass state validation in recovery scenarios

## Priority
HIGH -- this blocks the entire nested-project workflow model used by spec projects.

## Related
- T025: HIL Resume State Reset (related HIL state management)
