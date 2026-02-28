/**
 * HIL overlay — pre-task hook, trigger logic.
 * Default ON. T2 risk tier always triggers HIL regardless of enabled flag.
 */

import type { BaseOverlay, OverlayContext, OverlayResult } from "../base-overlay.ts";
import { HilQueue } from "./hil-queue.ts";
import type { RiskTier } from "../../types/index.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";

export interface HilOverlayConfig {
  enabled?: boolean;
  queue_path?: string;
  poll_interval_ms?: number;
  notify?: {
    on_created?: string[];
    on_t2_gate?: string[];
  };
}

export class HilOverlay implements BaseOverlay {
  readonly name = "hil";
  readonly enabled: boolean;
  private readonly queue: HilQueue;
  private readonly config: HilOverlayConfig;
  private readonly emitter: ObservabilityEmitter;

  constructor(
    config: HilOverlayConfig,
    queuePath: string,
    emitter: ObservabilityEmitter,
  ) {
    this.config = config;
    this.enabled = config.enabled ?? true;
    this.queue = new HilQueue(queuePath);
    this.emitter = emitter;
  }

  async preTask(ctx: OverlayContext): Promise<OverlayResult> {
    const taskDef = ctx.task_definition;
    const hilConfig = taskDef.overlays?.hil;
    const policyConfig = taskDef.overlays?.policy_gate;

    // Task-level override
    const taskEnabled = hilConfig?.enabled;
    const riskTier: RiskTier = policyConfig?.risk_tier ?? hilConfig?.risk_tier ?? "T0";

    // T2 always triggers HIL regardless of enabled flag
    const shouldTrigger = riskTier === "T2" || (taskEnabled ?? this.enabled);
    if (!shouldTrigger) {
      return { proceed: true };
    }

    // Check if there's already a pending HIL item for this task
    const existing = this.queue.list("PENDING").find((i) => i.task_id === ctx.task_id);
    if (existing) {
      // Wait for resolution
      return this.waitForHil(existing.id, ctx);
    }

    // Create new HIL item
    const hilId = crypto.randomUUID();
    const item = {
      id: hilId,
      task_id: ctx.task_id,
      workflow_id: ctx.workflow_id,
      status: "PENDING" as const,
      reason: riskTier === "T2"
        ? `T2 risk tier — mandatory human sign-off required before executing task '${ctx.task_id}'`
        : `HIL triggered for task '${ctx.task_id}'`,
      context: {
        task_description: ctx.task_definition.description,
        risk_tier: riskTier,
        agent: ctx.task_definition.agent,
      },
      created_at: new Date().toISOString(),
    };

    this.queue.create(item);
    this.emitter.emit("hil.created", {
      hil_id: hilId,
      task_id: ctx.task_id,
      reason: item.reason,
      risk_tier: riskTier,
    });

    // Run notifications
    await this.runNotifications(riskTier, hilId, ctx);

    return this.waitForHil(hilId, ctx);
  }

  private async waitForHil(
    hilId: string,
    ctx: OverlayContext,
  ): Promise<OverlayResult> {
    try {
      const resolved = await this.queue.waitForResolution(
        hilId,
        this.config.poll_interval_ms ?? 5000,
      );

      if (resolved.status === "REJECTED") {
        this.emitter.emit("hil.rejected", {
          hil_id: hilId,
          task_id: ctx.task_id,
          reason: resolved.rejection_reason,
        });
        return {
          proceed: false,
          feedback: `HIL rejected: ${resolved.rejection_reason ?? "No reason given"}`,
        };
      }

      this.emitter.emit("hil.resolved", {
        hil_id: hilId,
        task_id: ctx.task_id,
        notes: resolved.notes,
      });
      return { proceed: true };
    } catch (err) {
      return {
        proceed: false,
        feedback: `HIL timeout: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async runNotifications(
    riskTier: RiskTier,
    hilId: string,
    ctx: OverlayContext,
  ): Promise<void> {
    const hooks = riskTier === "T2"
      ? this.config.notify?.on_t2_gate
      : this.config.notify?.on_created;

    if (!hooks || hooks.length === 0) return;

    // Hooks are shell commands (Phase 2 feature — stub for now)
    // In Phase 2, each hook would be executed as a subprocess
    void hooks;
    void hilId;
    void ctx;
  }
}
