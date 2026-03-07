# T008 — CANCELLED Task State

## Metadata
- **ID**: T008
- **FR/NFR**: FR-006, NFR-002, NFR-004
- **Owner**: developer
- **Depends on**: none (pure addition to type system)
- **Estimate**: S (<2h)

## Context

The current `TaskStatus` union has six states: `PENDING`, `RUNNING`, `COMPLETED`, `NEEDS_REWORK`, `HIL_PENDING`, `FAILED`. There is no way to cleanly terminate a task without marking it as FAILED (which implies an error). The coding-standards governance system needs a `CANCELLED` state to represent a task that was terminated by operator intervention or governance policy without implying an error.

`CANCELLED` is a terminal state (no outgoing transitions), reachable from all four non-terminal states. It is persisted atomically using the existing tmp+rename pattern. The engine does not directly trigger CANCELLED transitions in this phase — that is deferred to a future phase when a governance SKIP verdict is wired up.

This task touches three files: the type definition, the state manager, and the status CLI command display.

**After this change, all exhaustive switch statements over `TaskStatus` in the codebase must be updated.** The TypeScript compiler will catch these at `bun run typecheck` time. Known locations:
- `src/cli/commands/status.ts`: `STATUS_SYMBOLS` record (keyed by `TaskStatus`)

## Files to create/modify

- `src/types/index.ts` — modify — add `"CANCELLED"` to `TaskStatus` union and `VALID_TRANSITIONS`
- `src/core/state-manager.ts` — modify — update `isTerminal()` and `transition()` to include `CANCELLED`
- `src/cli/commands/status.ts` — modify — add `CANCELLED` to `STATUS_SYMBOLS` with distinct display marker
- `tests/state-manager.test.ts` — modify (extend) — add CANCELLED transition test cases
- `tests/cli/status-cancelled.test.ts` — create — CLI status display test

## Implementation spec

### Modifications to `src/types/index.ts`

**`TaskStatus` union:**
```typescript
export type TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "NEEDS_REWORK"
  | "HIL_PENDING"
  | "FAILED"
  | "CANCELLED";
```

**`VALID_TRANSITIONS` map:**
```typescript
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING:      ["RUNNING", "CANCELLED"],
  RUNNING:      ["COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED", "CANCELLED"],
  COMPLETED:    [],
  NEEDS_REWORK: ["RUNNING", "FAILED", "CANCELLED"],
  HIL_PENDING:  ["RUNNING", "FAILED", "CANCELLED"],
  FAILED:       [],
  CANCELLED:    [],   // terminal — no outgoing transitions
};
```

### Modifications to `src/core/state-manager.ts`

**`isTerminal()` method:**
```typescript
isTerminal(): boolean {
  return Object.values(this.state.tasks).every(
    (s) => s.status === "COMPLETED" || s.status === "FAILED" || s.status === "CANCELLED",
  );
}
```

**`transition()` method — `completed_at` assignment:**
```typescript
completed_at: (newStatus === "COMPLETED" || newStatus === "FAILED" || newStatus === "CANCELLED")
  ? now
  : current.completed_at,
```

### Modifications to `src/cli/commands/status.ts`

**`STATUS_SYMBOLS` record** — add `CANCELLED` with a visually distinct marker:
```typescript
const STATUS_SYMBOLS: Record<TaskStatus, string> = {
  PENDING: "○",
  RUNNING: "◉",
  COMPLETED: "✓",
  NEEDS_REWORK: "↺",
  HIL_PENDING: "⏳",
  FAILED: "✗",
  CANCELLED: "⊘",   // distinct from ✗ (FAILED)
};
```

The summary line at the bottom of the status output must also be updated to include a cancelled count:
```typescript
const cancelled = tasks.filter(([, s]) => s.status === "CANCELLED").length;
// Add to summary line: | ⊘ ${cancelled}
```

### Exhaustive switch audit

Run `bun run typecheck` after making the type change. Any switch statement over `TaskStatus` without a `default` branch will cause a compile error on the new `CANCELLED` value. Fix all such locations before the task is complete.

## Tests to write

**File**: `tests/state-manager.test.ts` (extend existing file)

Add these test cases in a new `describe("CANCELLED state", ...)` block:

1. `PENDING → CANCELLED` succeeds — `getTaskState().status === "CANCELLED"`
2. `RUNNING → CANCELLED` succeeds — state file updated atomically (verify by reading state file)
3. `NEEDS_REWORK → CANCELLED` succeeds
4. `HIL_PENDING → CANCELLED` succeeds
5. `CANCELLED → RUNNING` → throws `StateError` — message identifies `CANCELLED` as terminal (error message is a contract — CLAUDE.md §5)
6. `CANCELLED → FAILED` → throws `StateError`
7. `CANCELLED → COMPLETED` → throws `StateError`
8. `COMPLETED → CANCELLED` → throws `StateError` (COMPLETED is terminal)
9. `FAILED → CANCELLED` → throws `StateError` (FAILED is terminal)
10. `isTerminal()` returns `true` when task is `CANCELLED`
11. `completed_at` is set (non-null) after `CANCELLED` transition
12. State file is readable with status `"CANCELLED"` immediately after atomic write

**File**: `tests/cli/status-cancelled.test.ts` (new)

Integration test for the CLI status command (CLAUDE.md §7 — one integration test per CLI command):

1. Set up a temp project directory with a workflow state file where one task has status `"CANCELLED"`.
2. Run the `status` command (invoke the registered command logic directly, not as a subprocess).
3. Assert: output includes the task ID.
4. Assert: output includes the `CANCELLED` label with the `⊘` symbol.
5. Assert: `CANCELLED` display is visually distinct from `FAILED` display (different symbol).
6. Assert: the summary line includes a cancelled count distinct from the failed count.

## Acceptance criteria

- [ ] `TaskStatus` union in `src/types/index.ts` includes `"CANCELLED"`
- [ ] `VALID_TRANSITIONS["CANCELLED"]` is `[]` (empty array — no outgoing transitions)
- [ ] `VALID_TRANSITIONS["PENDING"]` includes `"CANCELLED"`
- [ ] `VALID_TRANSITIONS["RUNNING"]` includes `"CANCELLED"`
- [ ] `VALID_TRANSITIONS["NEEDS_REWORK"]` includes `"CANCELLED"`
- [ ] `VALID_TRANSITIONS["HIL_PENDING"]` includes `"CANCELLED"`
- [ ] `VALID_TRANSITIONS["COMPLETED"]` does NOT include `"CANCELLED"`
- [ ] `VALID_TRANSITIONS["FAILED"]` does NOT include `"CANCELLED"`
- [ ] Attempting to transition out of `CANCELLED` throws `StateError` with actionable message
- [ ] `isTerminal()` returns `true` for tasks in `CANCELLED` state
- [ ] `completed_at` is set on `CANCELLED` transition
- [ ] `status` command displays `CANCELLED` tasks with `⊘` symbol (distinct from `✗`)
- [ ] `bun run typecheck` exits 0 — all exhaustive switches updated
- [ ] All existing 177 tests still pass
