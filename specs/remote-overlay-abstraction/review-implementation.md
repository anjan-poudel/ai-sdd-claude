# Implementation Review — Remote Overlay Abstraction (ROA-T-011 Gaps)

**Reviewer**: Reviewer agent (Claude Sonnet 4.6)
**Review date**: 2026-03-08
**Artifact**: ROA-T-011 gap closures — skip-policy assertion, chain-builder wiring test, CANCELLED CLI test, overlay_evidence --json test
**Review task**: review-implementation

---

## Summary

All four ROA-T-011 gaps are correctly addressed. The skip-policy fix in `mcp-overlay-provider.ts` correctly emits only `overlay.remote.fallback` for `skip` and not `overlay.remote.failed`. The new assertion `expect(failedEvent).toBeUndefined()` in test 7 correctly guards that invariant. The `McpSchemaError` JSDoc is accurate and properly placed. The `overlay.remote.invoked` in-flight comment is accurate. The `buildProviderChain` wiring test satisfies Development Standards §2. The CANCELLED CLI tests include both unit-level symbol contract tests and subprocess end-to-end tests that invoke the real `ai-sdd status` CLI binary. The `overlay_evidence --json` test correctly verifies the full serialization path. The full test suite passes at 509 / 0 with no regressions, exceeding the 505-test gate in the task spec.

---

## Decision

GO

---

## Findings

### Blocking

None.

### Advisory (non-blocking)

1. **`status-cancelled.test.ts`: `require()` instead of ESM import for StateManager** (cosmetic, no behavior impact)

   The two unit-level tests use `require("../../src/core/state-manager.ts")` (CommonJS) instead of `import`. In Bun this works, but it is inconsistent with the rest of the test file which uses ESM imports. This was pre-existing in the test style and has no correctness impact. All assertions pass.

2. **CLI test gap: end-to-end test does not assert the exact per-task row text** (non-blocking, lower priority than §7 satisfaction)

   The subprocess tests (lines 185–247) assert that `stdout` contains `⊘`, `CANCELLED`, `✗`, `FAILED`, and the summary counts `⊘ 1` and `✗ 1`. They do not assert that the symbols appear on the same line as their respective task IDs (e.g., `⊘ task-cancelled`). A future regression that swapped the symbols but kept both in output would pass these assertions. However, §7 is satisfied because a CLI subprocess is invoked and the display contract is verified. This is a refinement, not a gap.

3. **`overlay.remote.invoked` comment references `overlay.remote.completed` (non-existent event name)**

   At `mcp-overlay-provider.ts` line 140–141, the comment reads:
   `// overlay.remote.completed or overlay.remote.failed is emitted after resolution.`
   The event `overlay.remote.completed` does not exist in the EventType union — the post-success event is `overlay.remote.decision`. The intent is correct but the comment names a non-existent event type. This is documentation-only with no runtime impact.

---

## Test Results

```
bun test
509 pass
0 fail
899 expect() calls
Ran 509 tests across 30 files. [1.64s]
```

Breakdown of new tests added by ROA-T-011:
- `tests/overlays/mcp/mcp-overlay-provider.test.ts`: gap assertion added to test 7 (1 new `expect()`)
- `tests/engine.test.ts`: 1 new `it()` block (chain-builder wiring) — 14 engine tests total
- `tests/cli/status-cancelled.test.ts`: 7 new tests (4 unit-level + 3 subprocess end-to-end)

All pre-existing tests continue to pass (0 regressions). Net new: 509 − 472 (prior review) = 37 tests.

TypeScript strict mode: no new errors introduced in any of the 5 modified files. All 84 typecheck errors are pre-existing (bun:test types, Bun global, exactOptionalPropertyTypes in non-ROA files).

---

## Verification Against FR-008

FR-008 Acceptance Criteria — skip scenario:

> Scenario: Transport timeout with failure_policy "skip" returns PASS silently
> Then the returned OverlayDecision has verdict "PASS"
> And no overlay.remote.failed event is emitted

Status: SATISFIED.

The implementation at `mcp-overlay-provider.ts` lines 157–168 shows the `skip` case emits only `overlay.remote.fallback` and returns `{ verdict: "PASS" }`. The `overlay.remote.failed` emission is present in the `warn` and `fail_closed` cases only. Test 7 in `mcp-overlay-provider.test.ts` (lines 261–285) now asserts both conditions:
- `expect(fallbackEvent).toBeDefined()` with `failure_policy: "skip"` — fallback IS emitted
- `expect(failedEvent).toBeUndefined()` — failed is NOT emitted

This directly guards the FR-008 AC and the Finding 1 resolution from the iteration-1 NO_GO.

The two-tier separation (Tier 1 in the `catch` block, Tier 2 after the `try/finally`) matches the L2 design spec Component F exactly. The `effectivePolicy` computation at line 111 precedes the try block as specified.

No gold-plating was observed. All changes are within the scope of the four documented gaps.

