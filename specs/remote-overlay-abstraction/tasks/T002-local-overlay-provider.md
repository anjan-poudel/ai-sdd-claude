# T002 — LocalOverlayProvider

## Metadata
- **ID**: T002
- **FR/NFR**: FR-001, FR-002, NFR-004
- **Owner**: developer
- **Depends on**: T001
- **Estimate**: M (2-4h)

## Context

The engine currently calls `runPreTaskChain` and `runPostTaskChain` from `src/overlays/base-overlay.ts`, which work directly with `BaseOverlay` instances and return `OverlayResult` / `PostTaskOverlayResult`. The refactored engine (T009) will call `runPreProviderChain` / `runPostProviderChain` from `src/overlays/provider-chain.ts` (T006), which work with `OverlayProvider` instances and return `OverlayDecision`.

`LocalOverlayProvider` is the adapter that bridges these two worlds. It wraps an existing `BaseOverlay` instance and exposes the `OverlayProvider` interface. Crucially, zero behavior of the wrapped overlay changes — the same pre/post methods are called with the same inputs, and the results are mapped to the new normalized type. This guarantees backward compatibility: all 177 existing tests remain valid after this change, because the underlying overlay logic is untouched.

## Files to create/modify

- `src/overlays/local-overlay-provider.ts` — create — `LocalOverlayProvider` class + mapping functions
- `tests/overlays/local-overlay-provider.test.ts` — create — mapping + equivalence tests

## Implementation spec

### `src/overlays/local-overlay-provider.ts`

```typescript
import type { BaseOverlay, OverlayContext as LegacyContext, OverlayResult, PostTaskOverlayResult } from "./base-overlay.ts";
import type { OverlayProvider, OverlayDecision, OverlayHook, OverlayContext, OverlayEvidence } from "../types/overlay-protocol.ts";
import type { TaskResult } from "../types/index.ts";

export class LocalOverlayProvider implements OverlayProvider {
  readonly id: string;
  readonly runtime: "local" = "local";
  readonly hooks: OverlayHook[];
  readonly enabled: boolean;
  readonly phases?: string[];
  readonly inner: BaseOverlay; // exposed for engine's HIL awaitResolution lookup

  constructor(overlay: BaseOverlay) { ... }

  // invokePre and invokePost are conditionally assigned in the constructor
  // based on which methods the wrapped overlay implements.
  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}
```

**Hook detection at construction time:**
```typescript
const hooks: OverlayHook[] = [];
if (typeof overlay.preTask === "function") hooks.push("pre_task");
if (typeof overlay.postTask === "function") hooks.push("post_task");
if (hooks.length === 0) {
  throw new TypeError(
    `LocalOverlayProvider: overlay '${overlay.name}' declares no hooks (preTask/postTask). ` +
    `A provider must implement at least one hook method.`
  );
}
this.hooks = hooks;
```

Conditionally assign methods (use arrow functions in constructor, not prototype methods):
```typescript
if (typeof overlay.preTask === "function") {
  this.invokePre = async (ctx: OverlayContext): Promise<OverlayDecision> => {
    const result = await overlay.preTask!(toLegacyCtx(ctx));
    return mapPreResult(result, overlay.name);
  };
}
if (typeof overlay.postTask === "function") {
  this.invokePost = async (ctx: OverlayContext, taskResult: TaskResult): Promise<OverlayDecision> => {
    const result = await overlay.postTask!(toLegacyCtx(ctx), taskResult);
    return mapPostResult(result, overlay.name);
  };
}
```

**Context conversion (`toLegacyCtx`):**
```typescript
function toLegacyCtx(ctx: OverlayContext): LegacyContext {
  return {
    task_id: ctx.task_id,
    workflow_id: ctx.workflow_id,
    run_id: ctx.run_id,
    task_definition: ctx.task_definition,
    agent_context: ctx.agent_context,
  };
}
```

**OverlayResult → OverlayDecision mapping (`mapPreResult`):**

| `OverlayResult` | `OverlayDecision.verdict` | Notes |
|-----------------|--------------------------|-------|
| `proceed: true` | `"PASS"` | `feedback` and `updated_context` forwarded if present |
| `proceed: false, hil_trigger: true` | `"HIL"` | `data.hil_id` preserved in `evidence.data` |
| `proceed: false, hil_trigger: false/undefined` | `"REWORK"` | `feedback` forwarded |

```typescript
function mapPreResult(result: OverlayResult, overlayId: string): OverlayDecision {
  if (result.proceed) {
    return {
      verdict: "PASS",
      feedback: result.feedback,
      updated_context: result.updated_context,
    };
  }
  if (result.hil_trigger) {
    return {
      verdict: "HIL",
      feedback: result.feedback,
      evidence: { overlay_id: overlayId, source: "local", data: result.data },
    };
  }
  return {
    verdict: "REWORK",
    feedback: result.feedback,
    evidence: { overlay_id: overlayId, source: "local", data: result.data },
  };
}
```

**PostTaskOverlayResult → OverlayDecision mapping (`mapPostResult`):**

| `PostTaskOverlayResult` | `OverlayDecision.verdict` |
|-------------------------|--------------------------|
| `accept: true` | `"PASS"` |
| `accept: false, new_status: "NEEDS_REWORK"` or `undefined` | `"REWORK"` |
| `accept: false, new_status: "FAILED"` | `"FAIL"` |
| `accept: false, new_status: "COMPLETED"` | Throw `TypeError` — invalid; engine decides COMPLETED |

```typescript
function mapPostResult(result: PostTaskOverlayResult, overlayId: string): OverlayDecision {
  if (result.accept) {
    return { verdict: "PASS" };
  }
  if (result.new_status === "COMPLETED") {
    throw new TypeError(
      `LocalOverlayProvider: overlay '${overlayId}' returned accept:false with new_status:"COMPLETED". ` +
      `Only the engine may transition a task to COMPLETED. Use accept:true instead.`
    );
  }
  if (result.new_status === "FAILED") {
    return {
      verdict: "FAIL",
      feedback: result.feedback,
      evidence: { overlay_id: overlayId, source: "local", data: result.data },
    };
  }
  // NEEDS_REWORK or undefined
  return {
    verdict: "REWORK",
    feedback: result.feedback,
    evidence: { overlay_id: overlayId, source: "local", data: result.data },
  };
}
```

**The `enabled` property:**
```typescript
get enabled(): boolean {
  return this.inner.enabled;
}
```
This is a getter (not a cached copy) so it reflects live changes to the underlying overlay.

## Tests to write

**File**: `tests/overlays/local-overlay-provider.test.ts`

Test fixtures: create a `MockBaseOverlay` helper in the test file that returns configurable `OverlayResult` / `PostTaskOverlayResult` values.

Required test cases (config-to-behavior pattern — each changes input and asserts different output):
1. Pre-task `proceed: true` → verdict `"PASS"`
2. Pre-task `proceed: false` (no hil_trigger) → verdict `"REWORK"` with `feedback` forwarded
3. Pre-task `proceed: false, hil_trigger: true` → verdict `"HIL"`; `evidence.data.hil_id` matches `result.data.hil_id`
4. Post-task `accept: true` → verdict `"PASS"`
5. Post-task `accept: false, new_status: "NEEDS_REWORK"` → verdict `"REWORK"`
6. Post-task `accept: false, new_status: undefined` → verdict `"REWORK"`
7. Post-task `accept: false, new_status: "FAILED"` → verdict `"FAIL"`
8. Post-task `accept: false, new_status: "COMPLETED"` → throws `TypeError` with message naming the overlay
9. Overlay with no preTask and no postTask methods → constructor throws `TypeError` naming the overlay
10. `inner` property === wrapped overlay instance
11. `enabled` getter reflects `overlay.enabled` (test both true and false)
12. `runtime` is always `"local"`
13. Equivalence: construct the same `BaseOverlay` directly and via `LocalOverlayProvider`; assert identical verdicts for all mapping cases

**Integration point test** (required by CLAUDE.md standard — verifies wiring, not just unit):
14. After T009 lands, ensure engine calls `LocalOverlayProvider.invokePre` (not `BaseOverlay.preTask` directly) — this test lives in `tests/engine.test.ts`

## Acceptance criteria

- [ ] `src/overlays/local-overlay-provider.ts` exists and exports `LocalOverlayProvider`
- [ ] `LocalOverlayProvider` implements `OverlayProvider` interface from T001
- [ ] `runtime` is always `"local"`
- [ ] `inner` property exposes the wrapped `BaseOverlay`
- [ ] `enabled` getter reads live from `inner.enabled`
- [ ] Overlay with no preTask/postTask throws `TypeError` at construction, message names the overlay
- [ ] `accept: false, new_status: "COMPLETED"` throws `TypeError` at call time
- [ ] `hil_trigger: true` maps to `"HIL"` verdict (not `"REWORK"`)
- [ ] `bun run typecheck` exits 0
- [ ] All existing 177 tests still pass
- [ ] `tests/overlays/local-overlay-provider.test.ts` covers all 13 cases above
