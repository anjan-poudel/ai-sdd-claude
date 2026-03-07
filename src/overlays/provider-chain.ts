/**
 * Provider chain runner — iterates OverlayProvider[] and applies pre/post hooks.
 * Replaces runPreTaskChain/runPostTaskChain for the new provider-based architecture.
 */
import type { OverlayProvider, OverlayDecision, OverlayContext } from "../types/overlay-protocol.ts";
import type { TaskResult, AgentContext } from "../types/index.ts";

const IDENTITY_FIELDS = new Set<string>(["task_id", "workflow_id", "run_id", "status"]);

/**
 * Strip identity fields from an updated_context before merging into OverlayContext.
 * This is the engine's enforcement of the no-mutation invariant for context updates.
 */
export function mergeContextUpdate(ctx: OverlayContext, update: Partial<AgentContext>): OverlayContext {
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
