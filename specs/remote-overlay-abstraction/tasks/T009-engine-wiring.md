# T009 — Engine Wiring

## Metadata
- **ID**: T009
- **FR/NFR**: FR-007, NFR-002, NFR-003, NFR-004
- **Owner**: developer
- **Depends on**: T001, T002, T005, T006, T008
- **Estimate**: L (4-8h)

## Context

The engine (`src/core/engine.ts`) currently:
1. Accepts `OverlayChain` (`BaseOverlay[]`) as the last constructor parameter.
2. Calls `runPreTaskChain` / `runPostTaskChain` from `base-overlay.ts`.
3. Handles `OverlayResult` / `PostTaskOverlayResult` with boolean `proceed` / `accept` flags.
4. Finds the HIL overlay by name via `this.overlayChain.find((o) => o.name === "hil")`.

After this task, the engine:
1. Accepts `OverlayProvider[]` as the last constructor parameter.
2. Calls `runPreProviderChain` / `runPostProviderChain` from `provider-chain.ts`.
3. Handles `OverlayDecision` with verdict string via an exhaustive switch.
4. Finds the HIL overlay as a `LocalOverlayProvider` via `p.id === "hil" && p.runtime === "local"`, then accesses `.inner.awaitResolution`.

The CLI `run.ts` command currently calls `buildOverlayChain()` and passes `overlayChain` to the `Engine` constructor. After this change it must call `buildProviderChain()` instead.

**Critical invariant**: All 177 existing tests must pass after this change. The behavior change is internal (provider interface vs. direct overlay calls), not external. The outcome for any given task must be identical.

## Files to create/modify

- `src/core/engine.ts` — modify — constructor signature, imports, pre/post chain calls, verdict mapping, HIL lookup
- `src/cli/commands/run.ts` — modify — switch from `buildOverlayChain` to `buildProviderChain`
- `src/types/index.ts` — verify `TaskState` has `overlay_evidence` field (added in T001)
- `tests/engine.test.ts` — modify (extend) — add verdict mapping tests + integration point test

## Implementation spec

### Modifications to `src/core/engine.ts`

**Import changes:**
```typescript
// REMOVE:
import type { OverlayChain, OverlayContext } from "../overlays/base-overlay.ts";
import { runPreTaskChain, runPostTaskChain } from "../overlays/base-overlay.ts";

// ADD:
import type { OverlayProvider, OverlayDecision, OverlayVerdict, OverlayContext } from "../types/overlay-protocol.ts";
import { runPreProviderChain, runPostProviderChain } from "../overlays/provider-chain.ts";
import type { LocalOverlayProvider } from "../overlays/local-overlay-provider.ts";
```

**Constructor change:**
```typescript
// REMOVE:
private readonly overlayChain: OverlayChain = [],

// ADD:
private readonly providerChain: OverlayProvider[] = [],
```

**`runTaskIteration` — pre-chain replacement:**
```typescript
// REMOVE the old pre-task overlay chain block (the one calling runPreTaskChain)
// and REPLACE with:

if (this.providerChain.length > 0) {
  const overlayCtx: OverlayContext = {
    task_id: taskId,
    workflow_id: this.workflow.config.name,
    run_id: this.runId,
    task_definition: taskDef,
    agent_context: context,
  };

  const preDecision = await runPreProviderChain(this.providerChain, overlayCtx);

  const preResult = await this.applyPreDecision(taskId, preDecision, iteration);
  if (preResult === "NEEDS_REWORK") return "NEEDS_REWORK";
  if (preResult === "FAILED") return "FAILED";
  if (preResult === "HIL_AWAITING") {
    // HIL: find the local HIL provider's inner overlay for awaitResolution
    const hilProvider = this.providerChain.find(
      (p) => p.id === "hil" && p.runtime === "local"
    ) as (LocalOverlayProvider | undefined);
    const hilOverlay = hilProvider?.inner;
    const hilId = preDecision.evidence?.data?.["hil_id"] as string | undefined;
    const waitResult = hilOverlay?.awaitResolution && hilId
      ? await hilOverlay.awaitResolution(hilId)
      : { proceed: false, feedback: "HIL overlay unavailable or hil_id missing" };

    if (!waitResult.proceed) {
      this.stateManager.transition(taskId, "FAILED", {
        error: waitResult.feedback ?? "HIL rejected",
      });
      this.emitter.emit("task.failed", {
        task_id: taskId,
        error: waitResult.feedback ?? "HIL rejected",
      });
      return "FAILED";
    }
    // HIL resolved — re-arm to RUNNING
    this.stateManager.transition(taskId, "RUNNING");
  }
  // preResult === "CONTINUE" — proceed to dispatch
}
```

**Post-chain replacement:**
```typescript
// REMOVE the old post-task overlay chain block
// and REPLACE with:

if (this.providerChain.length > 0) {
  const overlayCtx: OverlayContext = {
    task_id: taskId,
    workflow_id: this.workflow.config.name,
    run_id: this.runId,
    task_definition: taskDef,
    agent_context: context,
  };

  const postDecision = await runPostProviderChain(this.providerChain, overlayCtx, result);
  const postResult = await this.applyPostDecision(taskId, postDecision, iteration);
  if (postResult === "NEEDS_REWORK") return "NEEDS_REWORK";
  if (postResult === "FAILED") return "FAILED";
}
```

**`applyPreDecision` private method (exhaustive switch):**
```typescript
private async applyPreDecision(
  taskId: string,
  decision: OverlayDecision,
  iteration: number,
): Promise<"CONTINUE" | "NEEDS_REWORK" | "FAILED" | "HIL_AWAITING"> {
  const verdict: OverlayVerdict = decision.verdict;

  switch (verdict) {
    case "PASS":
      return "CONTINUE";

    case "REWORK":
      this.stateManager.transition(taskId, "NEEDS_REWORK", {
        rework_feedback: decision.feedback ?? "Pre-task overlay requested rework",
        ...(decision.evidence && { overlay_evidence: decision.evidence }),
      });
      this.emitter.emit("task.rework", {
        task_id: taskId,
        iteration,
        feedback: decision.feedback ?? "",
      });
      this.stateManager.transition(taskId, "RUNNING");
      return "NEEDS_REWORK";

    case "FAIL":
      this.stateManager.transition(taskId, "FAILED", {
        error: decision.feedback ?? "Pre-task overlay returned FAIL",
        ...(decision.evidence && { overlay_evidence: decision.evidence }),
      });
      this.emitter.emit("task.failed", {
        task_id: taskId,
        error: decision.feedback ?? "Pre-task overlay returned FAIL",
      });
      return "FAILED";

    case "HIL":
      const hilId = decision.evidence?.data?.["hil_id"] as string | undefined;
      this.stateManager.transition(taskId, "HIL_PENDING", {
        ...(hilId !== undefined && { hil_item_id: hilId }),
        ...(decision.evidence && { overlay_evidence: decision.evidence }),
      });
      this.emitter.emit("task.hil_pending", {
        task_id: taskId,
        hil_id: hilId,
        feedback: decision.feedback,
      });
      return "HIL_AWAITING";

    default: {
      // This branch is unreachable if OverlayVerdict is exhaustive.
      // TypeScript compilation fails if a new verdict is added without a handler.
      const _exhaustive: never = verdict;
      throw new Error(`Unhandled OverlayVerdict: ${String(_exhaustive)}`);
    }
  }
}
```

**`applyPostDecision` private method** — mirrors `applyPreDecision`:
```typescript
private async applyPostDecision(
  taskId: string,
  decision: OverlayDecision,
  iteration: number,
): Promise<"PASS" | "NEEDS_REWORK" | "FAILED"> {
  switch (decision.verdict) {
    case "PASS":
      return "PASS";
    case "REWORK":
      this.stateManager.transition(taskId, "NEEDS_REWORK", {
        rework_feedback: decision.feedback ?? "Post-task overlay requested rework",
        ...(decision.evidence && { overlay_evidence: decision.evidence }),
      });
      this.emitter.emit("task.rework", { task_id: taskId, iteration, feedback: decision.feedback ?? "" });
      this.stateManager.transition(taskId, "RUNNING");
      return "NEEDS_REWORK";
    case "FAIL":
      this.stateManager.transition(taskId, "FAILED", {
        error: decision.feedback ?? "Post-task overlay returned FAIL",
        ...(decision.evidence && { overlay_evidence: decision.evidence }),
      });
      this.emitter.emit("task.failed", { task_id: taskId, error: decision.feedback ?? "FAIL" });
      return "FAILED";
    case "HIL":
      // HIL from post-task chain is an unusual case — treat as NEEDS_REWORK
      // (post-task HIL is not fully specified; conservative handling)
      this.stateManager.transition(taskId, "NEEDS_REWORK", {
        rework_feedback: decision.feedback ?? "Post-task overlay requested HIL review",
      });
      this.emitter.emit("task.rework", { task_id: taskId, iteration, feedback: decision.feedback ?? "" });
      this.stateManager.transition(taskId, "RUNNING");
      return "NEEDS_REWORK";
    default: {
      const _exhaustive: never = decision.verdict;
      throw new Error(`Unhandled OverlayVerdict: ${String(_exhaustive)}`);
    }
  }
}
```

### Modifications to `src/cli/commands/run.ts`

Replace the overlay chain construction block:
```typescript
// REMOVE:
import { buildOverlayChain } from "../../overlays/composition-rules.ts";
// ... (individual overlay constructor calls)
const overlayChain = buildOverlayChain({ hil, policy_gate, review, paired, confidence });

// ADD:
import { buildProviderChain } from "../../overlays/registry.ts";
import { loadRemoteOverlayConfig } from "../config-loader.ts"; // from T007
// ... (same individual overlay constructor calls)
const remoteConfig = loadRemoteOverlayConfig(projectPath);
const providerChain = buildProviderChain({
  localOverlays: { hil: hilOverlay, policy_gate: policyGateOverlay, review: reviewOverlay, paired: pairedOverlay, confidence: confidenceOverlay },
  remoteConfig,
  emitter,
});

// In Engine constructor call:
// CHANGE: overlayChain → providerChain
const engine = new Engine(
  workflow, stateManager, agentRegistry, adapter,
  constitutionResolver, manifestWriter, emitter,
  { max_concurrent_tasks: ..., ... },
  providerChain,  // ← was overlayChain
);
```

## Tests to write

**File**: `tests/engine.test.ts` (extend existing)

Add a describe block `"Engine verdict mapping (OverlayProvider chain)"`:

1. Pre-chain PASS → adapter `dispatchWithRetry` is called (integration: verifies wiring)
2. Pre-chain REWORK → `stateManager.getTaskState().status` is `"NEEDS_REWORK"` after the call
3. Pre-chain FAIL → `stateManager.getTaskState().status` is `"FAILED"`, no further iterations
4. Pre-chain HIL → `stateManager.getTaskState().status` is `"HIL_PENDING"`
5. Post-chain PASS → task reaches `"COMPLETED"`
6. Post-chain REWORK → task re-iterates (iteration counter incremented)
7. Post-chain FAIL → `"FAILED"`, no further iterations
8. Evidence written to task state: `decision.evidence` present → `taskState.overlay_evidence` matches
9. Remote `updated_context` with `task_id: "injected"` → `stateManager.getTaskState().status` unchanged (no spurious transition); the actual `task_id` in the state record is unchanged
10. **Integration point test (CLAUDE.md §2)**: assert that `LocalOverlayProvider.invokePre` is called (not `BaseOverlay.preTask` directly) when the engine runs with a `LocalOverlayProvider`-wrapped overlay in the chain. Use a spy/mock that records calls.
11. Regression: all 177 existing tests pass after this change (run `bun test` and verify count)

## Acceptance criteria

- [ ] `Engine` constructor accepts `OverlayProvider[]` as its last parameter
- [ ] Engine calls `runPreProviderChain` / `runPostProviderChain` (not the old `runPreTaskChain`)
- [ ] `applyPreDecision` has exhaustive switch with `default: never` cast — compile error if new verdict added
- [ ] `applyPostDecision` has exhaustive switch with `default: never` cast
- [ ] REWORK verdict → `NEEDS_REWORK` transition + re-arm to RUNNING
- [ ] FAIL verdict → `FAILED` transition (terminal, no further iterations)
- [ ] HIL verdict → `HIL_PENDING` transition; HIL overlay's `awaitResolution` called via `inner` property
- [ ] Evidence written to `TaskState.overlay_evidence` when present
- [ ] Remote `updated_context.task_id` cannot overwrite state record task ID
- [ ] CLI `run.ts` uses `buildProviderChain` (not `buildOverlayChain`)
- [ ] `bun run typecheck` exits 0
- [ ] All existing 177 tests still pass
