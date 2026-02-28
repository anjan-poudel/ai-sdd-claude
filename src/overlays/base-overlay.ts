/**
 * BaseOverlay interface and overlay chain types.
 *
 * Overlay chain order (locked):
 *   HIL (default ON) → Evidence Gate → Agentic Review → Paired Workflow → Confidence Loop → Agent Execution
 */

import type { TaskDefinition, AgentContext, TaskResult } from "../types/index.ts";

export interface OverlayContext {
  task_id: string;
  workflow_id: string;
  run_id: string;
  task_definition: TaskDefinition;
  agent_context: AgentContext;
}

export interface OverlayResult {
  /** If false, overlay signals the task should not proceed (abort/rework/HIL). */
  proceed: boolean;
  /** Override context for downstream overlays. */
  updated_context?: Partial<AgentContext>;
  /** Feedback for rework if proceed=false. */
  feedback?: string;
  /** Signal that task should go to HIL_PENDING. */
  hil_trigger?: boolean;
  /** Arbitrary extra data from the overlay. */
  data?: Record<string, unknown>;
}

export interface PostTaskOverlayResult {
  /** Whether the task result should be accepted (COMPLETED) or rejected (NEEDS_REWORK/FAILED). */
  accept: boolean;
  new_status?: "COMPLETED" | "NEEDS_REWORK" | "FAILED";
  feedback?: string;
  data?: Record<string, unknown>;
}

export interface BaseOverlay {
  readonly name: string;
  readonly enabled: boolean;

  /**
   * Pre-task hook — called before agent dispatch.
   * Can block execution (hil_trigger) or modify context.
   */
  preTask?(ctx: OverlayContext): Promise<OverlayResult>;

  /**
   * Post-task hook — called after agent dispatch returns.
   * Can reject the result (triggering NEEDS_REWORK).
   */
  postTask?(ctx: OverlayContext, result: TaskResult): Promise<PostTaskOverlayResult>;
}

export type OverlayChain = BaseOverlay[];

/**
 * Run pre-task hooks in overlay chain order.
 * Returns first non-proceed result, or proceed=true if all pass.
 */
export async function runPreTaskChain(
  chain: OverlayChain,
  ctx: OverlayContext,
): Promise<OverlayResult> {
  for (const overlay of chain) {
    if (!overlay.enabled || !overlay.preTask) continue;
    const result = await overlay.preTask(ctx);
    if (!result.proceed) return result;
    if (result.updated_context) {
      ctx = { ...ctx, agent_context: { ...ctx.agent_context, ...result.updated_context } };
    }
  }
  return { proceed: true };
}

/**
 * Run post-task hooks in overlay chain order.
 * Returns first non-accept result, or accept=true if all pass.
 */
export async function runPostTaskChain(
  chain: OverlayChain,
  ctx: OverlayContext,
  result: TaskResult,
): Promise<PostTaskOverlayResult> {
  for (const overlay of chain) {
    if (!overlay.enabled || !overlay.postTask) continue;
    const overlayResult = await overlay.postTask(ctx, result);
    if (!overlayResult.accept) return overlayResult;
  }
  return { accept: true, new_status: "COMPLETED" };
}
