# Implementation Review — Remote Overlay Abstraction (Re-review)

**Reviewer**: Reviewer agent (Claude Sonnet 4.6)
**Review date**: 2026-03-07
**Artifact**: Remote Overlay Abstraction feature (T001–T010) — re-review after rework

---

## Decision: GO

## Summary

All blocking defects from the previous NO_GO are resolved: `bun run typecheck` shows zero errors in `src/overlays/mcp/mcp-overlay-provider.ts` and `src/cli/commands/run.ts`, confirming the seven `exactOptionalPropertyTypes` violations are fixed. All three advisory items from the previous review that were flagged as requiring attention are now addressed (`overlay.remote.connected` data payload includes `workflow_id` and `run_id`; `overlay.remote.fallback` is emitted for both `warn` and `skip` failure policies). The test suite continues to pass at 472 / 0.

---

## Findings

### Blocking

None.

### Advisory (non-blocking, carried forward)

1. **CLAUDE.md §7 — `status` CLI integration test is shallow (unchanged from previous review)**

   `tests/cli/status-cancelled.test.ts` mirrors `STATUS_SYMBOLS` internally and calls `StateManager` directly rather than invoking the `ai-sdd status` CLI command end-to-end. A regression in `src/cli/commands/status.ts` that removes CANCELLED from its display table would not be caught. The state-machine and symbol contract tests cover the core logic; however a full CLI invocation test would fully satisfy §7. This was non-blocking in the previous review and remains non-blocking.

---

## Verification of Previous Advisory Items

| Item | Previous status | Current status |
|------|----------------|----------------|
| `overlay.remote.connected` data missing `workflow_id` / `run_id` | Advisory — fields present at envelope level only | **Resolved** — `mcp-overlay-provider.ts` lines 129–136 now include both fields in `data` |
| `overlay.remote.fallback` not emitted for `skip` policy | Advisory — only `warn` emitted it | **Resolved** — `mcp-overlay-provider.ts` lines 166–174: `skip` branch now emits fallback event before returning |
| `status` CLI integration test is shallow | Advisory | Still advisory — no change made |

---

## Test Results

```
bun test v1.3.10 (30e609e0)
 472 pass
 0 fail
 823 expect() calls
Ran 472 tests across 28 files. [1335.00ms]
```

All 472 tests pass (295 new + 177 pre-existing).

---

## Typecheck Results

```
bun run typecheck
exit code: 2

Errors in new/modified files (mcp-overlay-provider.ts, run.ts):
  (none)
```

The seven `exactOptionalPropertyTypes` violations previously blocking this review are gone. The 76 remaining TypeScript errors are all pre-existing (in `src/adapters/claude-code-adapter.ts`, `src/cli/commands/complete-task.ts`, `src/config/defaults.ts`, `src/constitution/manifest-writer.ts`, `src/core/agent-loader.ts`, `src/core/workflow-loader.ts`) and were present before this feature was introduced. None of the files modified by this feature produce any typecheck errors.

---

## FR Coverage (final)

| FR | Title | Status | Notes |
|----|-------|--------|-------|
| FR-001 | Overlay Provider Interface | SATISFIED | `OverlayProvider` interface matches spec; hook-without-method detection at construction time |
| FR-002 | Overlay Decision Contract | SATISFIED | `OverlayInvokeOutputSchema` validates all remote responses; schema violations fail_closed |
| FR-003 | MCP Client Wrapper | SATISFIED | `McpClientWrapper` with typed errors; stdio-only; external fixture present |
| FR-004 | Provider Chain Composition | SATISFIED | Locked chain order enforced; short-circuit, phase filter, disabled-skip all tested |
| FR-005 | Configuration Schema | SATISFIED | `OverlayBackendConfigSchema` with `mcp` runtime + required `tool`; `RemoteOverlayConfigSchema` with `.min(1)` hooks |
| FR-006 | CANCELLED Task State | SATISFIED | `VALID_TRANSITIONS` updated; terminal state; `status` CLI shows ⊘ distinct from ✗ |
| FR-007 | Engine Verdict Mapping | SATISFIED | Exhaustive switch with `never` cast; evidence written to task state |
| FR-008 | Remote Failure Handling | SATISFIED | Two-tier separation; schema always fail_closed; `blocking: false` overrides Tier 1 to warn |
| FR-009 | Observability Events | SATISFIED | All 6 event schemas defined; `overlay.remote.fallback` now emitted for both `warn` and `skip`; `workflow_id`/`run_id` now present in `overlay.remote.connected` data payload |
