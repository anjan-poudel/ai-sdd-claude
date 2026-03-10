/**
 * LocalOverlayProvider — wraps a BaseOverlay in the OverlayProvider interface.
 * Zero behavioral change: delegates to the wrapped overlay's preTask/postTask methods.
 */
import type { BaseOverlay, OverlayContext as LegacyContext, OverlayResult, PostTaskOverlayResult } from "./base-overlay.ts";
import type { OverlayProvider, OverlayDecision, OverlayHook, OverlayContext, OverlayEvidence } from "../types/overlay-protocol.ts";
import type { TaskResult } from "../types/index.ts";

function toLegacyCtx(ctx: OverlayContext): LegacyContext {
  return {
    task_id: ctx.task_id,
    workflow_id: ctx.workflow_id,
    run_id: ctx.run_id,
    task_definition: ctx.task_definition,
    agent_context: ctx.agent_context,
  };
}

function makeEvidence(overlayId: string, data: Record<string, unknown> | undefined): OverlayEvidence {
  const evidence: OverlayEvidence = { overlay_id: overlayId, source: "local" };
  if (data !== undefined) evidence.data = data;
  return evidence;
}

function mapPreResult(result: OverlayResult, overlayId: string): OverlayDecision {
  if (result.proceed) {
    const decision: OverlayDecision = { verdict: "PASS" };
    if (result.feedback !== undefined) decision.feedback = result.feedback;
    if (result.updated_context !== undefined) decision.updated_context = result.updated_context;
    return decision;
  }
  if (result.hil_trigger) {
    const decision: OverlayDecision = {
      verdict: "HIL",
      evidence: makeEvidence(overlayId, result.data),
    };
    if (result.feedback !== undefined) decision.feedback = result.feedback;
    return decision;
  }
  const decision: OverlayDecision = {
    verdict: "REWORK",
    evidence: makeEvidence(overlayId, result.data),
  };
  if (result.feedback !== undefined) decision.feedback = result.feedback;
  return decision;
}

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
    const decision: OverlayDecision = {
      verdict: "FAIL",
      evidence: makeEvidence(overlayId, result.data),
    };
    if (result.feedback !== undefined) decision.feedback = result.feedback;
    return decision;
  }
  // NEEDS_REWORK or undefined
  const decision: OverlayDecision = {
    verdict: "REWORK",
    evidence: makeEvidence(overlayId, result.data),
  };
  if (result.feedback !== undefined) decision.feedback = result.feedback;
  return decision;
}

export class LocalOverlayProvider implements OverlayProvider {
  readonly id: string;
  readonly runtime: "local" = "local";
  readonly hooks: OverlayHook[];
  readonly phases?: string[];
  readonly inner: BaseOverlay; // exposed for engine's HIL awaitResolution lookup

  invokePre?: (ctx: OverlayContext) => Promise<OverlayDecision>;
  invokePost?: (ctx: OverlayContext, result: TaskResult) => Promise<OverlayDecision>;

  constructor(overlay: BaseOverlay) {
    this.inner = overlay;
    this.id = overlay.name;

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
  }

  get enabled(): boolean {
    return this.inner.enabled;
  }
}
