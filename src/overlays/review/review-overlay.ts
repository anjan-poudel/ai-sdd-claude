/**
 * Agentic review overlay — coder/reviewer loop with GO/NO_GO decisions.
 */

import type { BaseOverlay, OverlayContext, PostTaskOverlayResult } from "../base-overlay.ts";
import type { TaskResult } from "../../types/index.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";

export class ReviewOverlay implements BaseOverlay {
  readonly name = "review";
  readonly enabled: boolean;

  constructor(
    private readonly emitter: ObservabilityEmitter,
    options: { enabled?: boolean } = {},
  ) {
    this.enabled = options.enabled ?? false;
  }

  async postTask(
    ctx: OverlayContext,
    result: TaskResult,
  ): Promise<PostTaskOverlayResult> {
    const taskEnabled = ctx.task_definition.overlays?.review?.enabled;
    if (!taskEnabled) {
      return { accept: true, new_status: "COMPLETED" };
    }

    // Check if reviewer agent decided GO or NO_GO via handover state
    const reviewDecision = result.handover_state?.["review"]?.decision as string | undefined;

    if (reviewDecision === "NO_GO") {
      const feedback = result.handover_state?.["review"]?.feedback as string | undefined;
      return {
        accept: false,
        new_status: "NEEDS_REWORK",
        feedback: feedback ?? "Reviewer returned NO_GO",
      };
    }

    // GO or no decision (pass through)
    return { accept: true, new_status: "COMPLETED" };
  }
}
