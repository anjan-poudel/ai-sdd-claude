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

    // Reuse an existing pending HIL item for this task (idempotent on retry)
    const existing = this.queue.list("PENDING").find((i) => i.task_id === ctx.task_id);
    if (existing) {
      return { proceed: false, hil_trigger: true, data: { hil_id: existing.id } };
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

    // Return immediately — engine will transition to HIL_PENDING then call awaitResolution
    return { proceed: false, hil_trigger: true, data: { hil_id: hilId } };
  }

  /**
   * Wait for the HIL item to be resolved or rejected (polling).
   * Called by the engine after it has transitioned the task to HIL_PENDING.
   */
  async awaitResolution(hilId: string, pollIntervalMs?: number): Promise<OverlayResult> {
    try {
      const resolved = await this.queue.waitForResolution(
        hilId,
        pollIntervalMs ?? this.config.poll_interval_ms ?? 5000,
      );

      if (resolved.status === "REJECTED") {
        this.emitter.emit("hil.rejected", {
          hil_id: hilId,
          task_id: resolved.task_id,
          reason: resolved.rejection_reason,
        });
        return {
          proceed: false,
          feedback: `HIL rejected: ${resolved.rejection_reason ?? "No reason given"}`,
        };
      }

      this.emitter.emit("hil.resolved", {
        hil_id: hilId,
        task_id: resolved.task_id,
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

    // Execute each notification hook as a shell command with context env vars.
    // Failures are logged but do not block the HIL flow.
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      HIL_ID: hilId,
      HIL_TASK_ID: ctx.task_id,
      HIL_WORKFLOW_ID: ctx.workflow_id,
      HIL_RISK_TIER: riskTier,
      HIL_REASON: ctx.task_definition.overlays?.hil?.risk_tier === "T2"
        ? `T2 risk tier — mandatory human sign-off required before executing task '${ctx.task_id}'`
        : `HIL triggered for task '${ctx.task_id}'`,
    };

    for (const cmd of hooks) {
      try {
        const proc = Bun.spawn(["sh", "-c", cmd], {
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text();
          this.emitter.emit("hil.notify_failed", {
            hil_id: hilId,
            task_id: ctx.task_id,
            command: cmd,
            exit_code: exitCode,
            stderr: stderr.trim(),
          });
        }
      } catch (err) {
        this.emitter.emit("hil.notify_failed", {
          hil_id: hilId,
          task_id: ctx.task_id,
          command: cmd,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
