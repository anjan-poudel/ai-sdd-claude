/**
 * Confidence overlay — advisory confidence score post-task.
 * Score is advisory only; never changes pass/fail verdict.
 */

import type { BaseOverlay, OverlayContext, PostTaskOverlayResult } from "../base-overlay.ts";
import type { TaskResult } from "../../types/index.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";

export class ConfidenceOverlay implements BaseOverlay {
  readonly name = "confidence";
  readonly enabled: boolean;
  private readonly threshold: number;

  constructor(
    private readonly emitter: ObservabilityEmitter,
    options: { enabled?: boolean; threshold?: number } = {},
  ) {
    this.enabled = options.enabled ?? true;
    this.threshold = options.threshold ?? 0.7;
  }

  async postTask(
    ctx: OverlayContext,
    result: TaskResult,
  ): Promise<PostTaskOverlayResult> {
    // Compute advisory confidence score
    const score = this.computeScore(result);

    this.emitter.emit("confidence.computed", {
      task_id: ctx.task_id,
      score,
      threshold: this.threshold,
      advisory: true,
    });

    // Advisory only — always accept regardless of score
    return {
      accept: true,
      new_status: "COMPLETED",
      data: { confidence_score: score },
    };
  }

  private computeScore(result: TaskResult): number {
    let score = 0.5; // baseline

    if (result.outputs && result.outputs.length > 0) score += 0.2;
    if (result.handover_state && Object.keys(result.handover_state).length > 0) score += 0.1;
    if (result.tokens_used && result.tokens_used.output > 100) score += 0.1;
    if (result.status === "COMPLETED") score += 0.1;

    return Math.min(1.0, score);
  }
}
