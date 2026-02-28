/**
 * Paired workflow overlay — driver/challenger loop.
 */

import type { BaseOverlay, OverlayContext, PostTaskOverlayResult } from "../base-overlay.ts";
import type { TaskResult } from "../../types/index.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";

export class PairedOverlay implements BaseOverlay {
  readonly name = "paired";
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
    // Phase 1 stub — paired workflow is Phase 3
    // Check if task's paired overlay is enabled
    const taskEnabled = ctx.task_definition.overlays?.paired?.enabled;
    if (!taskEnabled) {
      return { accept: true, new_status: "COMPLETED" };
    }

    // In full implementation, this would:
    // 1. Run challenger agent on same task
    // 2. Compare driver vs challenger outputs
    // 3. Return consensus or flag divergence

    // Phase 1: pass-through
    return { accept: true, new_status: "COMPLETED" };
  }
}
