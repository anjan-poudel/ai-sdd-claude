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
    _result: TaskResult,
  ): Promise<PostTaskOverlayResult> {
    const taskEnabled = ctx.task_definition.overlays?.paired?.enabled;
    if (!taskEnabled) {
      return { accept: true, new_status: "COMPLETED" };
    }

    // Paired workflow requires a second adapter dispatch (challenger agent).
    // This overlay does not have direct adapter access — the driver/challenger
    // pattern is a Phase 3 feature. Fail loudly rather than silently pass through,
    // so configs with paired.enabled: true are not silently ignored.
    this.emitter.emit("paired.not_implemented", {
      task_id: ctx.task_id,
      message: "Paired workflow is not yet implemented. Disable overlays.paired.enabled in this task's definition to proceed.",
    });
    return {
      accept: false,
      new_status: "NEEDS_REWORK",
      feedback: "Paired overlay is not yet implemented (Phase 3). " +
        "Set overlays.paired.enabled: false on this task to bypass.",
    };
  }
}
