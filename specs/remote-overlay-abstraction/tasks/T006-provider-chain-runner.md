# T006 — Provider Chain Runner

## Metadata
- **ID**: T006
- **FR/NFR**: FR-004, NFR-002, NFR-003
- **Owner**: developer
- **Depends on**: T001, T005
- **Estimate**: M (2-4h)

## Context

The engine currently calls `runPreTaskChain` / `runPostTaskChain` from `src/overlays/base-overlay.ts`. These functions iterate over `BaseOverlay[]` and short-circuit on the first `proceed: false` result. They will be replaced by `runPreProviderChain` / `runPostProviderChain` from a new `src/overlays/provider-chain.ts` which iterate over `OverlayProvider[]` and short-circuit on the first non-PASS `OverlayDecision`.

Key additions over the old chain runner:
1. Phase filtering: skip providers whose `phases` filter does not include the task's phase.
2. Unhandled exception catch: any provider that throws unexpectedly is converted to a FAIL decision — no unhandled rejections escape to the engine (NFR-002).
3. Identity field stripping: `updated_context` from providers cannot overwrite `task_id`, `workflow_id`, `run_id`, or `status`.

The old `runPreTaskChain` / `runPostTaskChain` in `base-overlay.ts` are NOT deleted — they remain for backward compatibility with existing tests that import them directly.

## Files to create/modify

- `src/overlays/provider-chain.ts` — create — `runPreProviderChain`, `runPostProviderChain`, `mergeContextUpdate`
- `tests/overlays/provider-chain.test.ts` — create — full chain execution tests

## Implementation spec

### `src/overlays/provider-chain.ts`

```typescript
import type { OverlayProvider, OverlayDecision, OverlayContext } from "../types/overlay-protocol.ts";
import type { TaskResult, AgentContext } from "../types/index.ts";

const IDENTITY_FIELDS = new Set<string>(["task_id", "workflow_id", "run_id", "status"]);

/**
 * Strip identity fields from an updated_context before merging into OverlayContext.
 * This is the engine's enforcement of the no-mutation invariant for context updates.
 */
function mergeContextUpdate(ctx: OverlayContext, update: Partial<AgentContext>): OverlayContext {
  const safeUpdate = Object.fromEntries(
    Object.entries(update).filter(([k]) => !IDENTITY_FIELDS.has(k))
  ) as Partial<AgentContext>;
  return {
    ...ctx,
    agent_context: { ...ctx.agent_context, ...safeUpdate },
  };
}

/**
 * Run pre-task hook for each provider in chain order.
 * - Short-circuits on first non-PASS verdict.
 * - Skips providers that do not declare "pre_task" hook.
 * - Skips disabled providers.
 * - Skips providers where phases is set and task_definition has no matching phase.
 * - Converts any unhandled provider exception to a FAIL decision.
 */
export async function runPreProviderChain(
  chain: OverlayProvider[],
  ctx: OverlayContext,
): Promise<OverlayDecision> {
  let currentCtx = ctx;
  for (const provider of chain) {
    if (!provider.enabled) continue;
    if (!provider.hooks.includes("pre_task")) continue;
    if (provider.phases !== undefined) {
      const taskPhase = (currentCtx.task_definition as { phase?: string }).phase;
      if (taskPhase === undefined || !provider.phases.includes(taskPhase)) continue;
    }

    let decision: OverlayDecision;
    try {
      decision = await provider.invokePre!(currentCtx);
    } catch (err) {
      // Reliability catch: convert unhandled exception to FAIL (NFR-002)
      decision = {
        verdict: "FAIL",
        feedback: `Provider '${provider.id}' threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
        evidence: { overlay_id: provider.id, source: provider.runtime },
      };
    }

    if (decision.verdict !== "PASS") {
      return decision; // short-circuit
    }

    // Accumulate safe context update for next provider
    if (decision.updated_context) {
      currentCtx = mergeContextUpdate(currentCtx, decision.updated_context);
    }
  }
  return { verdict: "PASS" };
}

/**
 * Run post-task hook for each provider in chain order.
 * Symmetric to runPreProviderChain but calls invokePost.
 */
export async function runPostProviderChain(
  chain: OverlayProvider[],
  ctx: OverlayContext,
  result: TaskResult,
): Promise<OverlayDecision> {
  let currentCtx = ctx;
  for (const provider of chain) {
    if (!provider.enabled) continue;
    if (!provider.hooks.includes("post_task")) continue;
    if (provider.phases !== undefined) {
      const taskPhase = (currentCtx.task_definition as { phase?: string }).phase;
      if (taskPhase === undefined || !provider.phases.includes(taskPhase)) continue;
    }

    let decision: OverlayDecision;
    try {
      decision = await provider.invokePost!(currentCtx, result);
    } catch (err) {
      decision = {
        verdict: "FAIL",
        feedback: `Provider '${provider.id}' threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
        evidence: { overlay_id: provider.id, source: provider.runtime },
      };
    }

    if (decision.verdict !== "PASS") {
      return decision;
    }

    if (decision.updated_context) {
      currentCtx = mergeContextUpdate(currentCtx, decision.updated_context);
    }
  }
  return { verdict: "PASS" };
}
```

**Phase filtering rule**: When `provider.phases` is set and `task_definition.phase` is `undefined`, the provider is skipped (conservative: unknown phase does not match any filter). When `provider.phases` is `undefined`, the provider is always included regardless of task phase.

**`task_definition.phase` access**: `TaskDefinition` has `[key: string]: unknown` at the end, so `(ctx.task_definition as { phase?: string }).phase` is the correct access pattern without `any`.

## Tests to write

**File**: `tests/overlays/provider-chain.test.ts`

Create `MockOverlayProvider` helper that returns configurable verdicts and records whether it was called.

**Pre-chain tests:**
1. Empty chain → verdict `"PASS"`
2. All three providers return PASS → verdict `"PASS"`, all three called
3. Second provider returns REWORK → verdict `"REWORK"`, third provider NOT called (short-circuit — assert call count)
4. Second provider returns FAIL → verdict `"FAIL"`, third provider NOT called
5. Second provider returns HIL → verdict `"HIL"`, third provider NOT called
6. Provider with `enabled: false` → skipped, `invokePre` not called
7. Provider not declaring `pre_task` hook → skipped for pre chain
8. Provider with `phases: ["planning"]` and task `phase: "implementation"` → skipped
9. Provider with `phases: ["planning"]` and task `phase: "planning"` → included
10. Provider with `phases: undefined` → always included regardless of task phase
11. Provider with `phases: ["planning"]` and task `phase: undefined` → skipped (conservative)
12. Unhandled provider exception → returns `{ verdict: "FAIL" }` with feedback message containing provider ID; no unhandled rejection propagates
13. `updated_context` forwarded to next provider — second provider receives merged context
14. Identity field `task_id` in `updated_context` stripped — second provider does NOT see updated `task_id`
15. Identity field `status` in `updated_context` stripped — second provider does NOT see updated `status`

**Post-chain tests (symmetric):**
16-22: Replicate tests 1-7 above for `runPostProviderChain`

**Config-to-behavior (CLAUDE.md §1):**
23. `phases: ["design"]` config → provider skipped for `phase: "implementation"` task; change config to `phases: ["implementation"]` → provider included. Assert different call counts.

## Acceptance criteria

- [ ] `src/overlays/provider-chain.ts` exists and exports `runPreProviderChain` and `runPostProviderChain`
- [ ] Short-circuits on first non-PASS verdict — subsequent providers not called
- [ ] Unhandled provider exception converts to FAIL, no unhandled rejection propagates
- [ ] Phase filter: `phases: undefined` → always included; `phases` set + task phase mismatch → skipped; task phase `undefined` with phases filter → skipped
- [ ] Identity fields (`task_id`, `workflow_id`, `run_id`, `status`) stripped from `updated_context`
- [ ] `updated_context` non-identity fields propagated to subsequent providers
- [ ] Old `runPreTaskChain` / `runPostTaskChain` in `base-overlay.ts` still exported and unchanged
- [ ] `bun run typecheck` exits 0
- [ ] All existing 177 tests still pass
