/**
 * Paired workflow overlay — full driver/challenger loop.
 *
 * Loop:
 *   1. Driver executes task (handled by normal engine dispatch).
 *   2. Challenger reviews driver output and either approves or provides feedback.
 *   3. If challenger approves → accept (COMPLETED).
 *   4. If challenger rejects and iterations remain → NEEDS_REWORK with feedback.
 *   5. If max_iterations reached without approval → HIL escalation.
 *
 * Role switch modes:
 *   "session"     — driver/challenger stay fixed for the entire workflow session
 *   "subtask"     — roles swap after each subtask (every challenger approval or rejection)
 *   "checkpoint"  — roles swap at explicit checkpoint markers (not yet implemented; behaves like session)
 */

import type { BaseOverlay, OverlayContext, PostTaskOverlayResult } from "../base-overlay.ts";
import type { TaskResult } from "../../types/index.ts";
import type { RuntimeAdapter, DispatchOptions } from "../../adapters/base-adapter.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";
import { PairSession } from "./pair-session.ts";

export class PairedOverlay implements BaseOverlay {
  readonly name = "paired";
  readonly enabled: boolean;

  constructor(
    private readonly emitter: ObservabilityEmitter,
    options: { enabled?: boolean } = {},
    private readonly adapter?: RuntimeAdapter,
    private readonly sessionDir?: string,
  ) {
    this.enabled = options.enabled ?? false;
  }

  async postTask(
    ctx: OverlayContext,
    result: TaskResult,
  ): Promise<PostTaskOverlayResult> {
    const pairedConfig = ctx.task_definition.overlays?.paired;
    if (!pairedConfig?.enabled) {
      return { accept: true, new_status: "COMPLETED" };
    }

    if (!this.adapter) {
      // No adapter injected — cannot dispatch challenger. Fail loudly.
      return {
        accept: false,
        new_status: "FAILED",
        feedback: "PairedOverlay requires a RuntimeAdapter to dispatch the challenger agent. Wire in the adapter at overlay construction time.",
      };
    }

    const challengerAgent = pairedConfig.challenger_agent!;
    const driverAgent = pairedConfig.driver_agent ?? ctx.task_definition.agent;
    const maxIterations = pairedConfig.max_iterations ?? 3;
    const roleSwitch = pairedConfig.role_switch ?? "session";

    const sessDir = this.sessionDir ?? PairSession.sessionDir(ctx.agent_context.project_path ?? ".");
    const session = new PairSession(sessDir, ctx.task_id, {
      task_id: ctx.task_id,
      driver_agent: driverAgent,
      challenger_agent: challengerAgent,
      role_switch: roleSwitch,
      max_iterations: maxIterations,
    });

    const currentIteration = session.iteration + 1;

    // Build challenger prompt
    const challengerPrompt = this.buildChallengerPrompt(ctx, result, session.history);
    const judgeContext = {
      ...ctx.agent_context,
      constitution: challengerPrompt,
      task_definition: {
        ...ctx.task_definition,
        agent: challengerAgent,
        description: `Review driver output for task '${ctx.task_id}'`,
      },
    };

    const options: DispatchOptions = {
      operation_id: `${ctx.workflow_id}:${ctx.task_id}:paired:${challengerAgent}:iter${currentIteration}`,
      attempt_id: `${ctx.workflow_id}:${ctx.task_id}:paired:${challengerAgent}:iter${currentIteration}:${Date.now()}`,
    };

    this.emitter.emit("paired.challenger_dispatched", {
      task_id: ctx.task_id,
      challenger_agent: challengerAgent,
      iteration: currentIteration,
    });

    const challengerResult = await this.adapter.dispatch(challengerAgent, judgeContext, options);

    const approved = this.parseChallengerApproval(challengerResult);
    const feedback = challengerResult.error ?? challengerResult.handover_state?.["feedback"] as string ?? "";

    session.recordIteration({
      iteration: currentIteration,
      driver_output_summary: JSON.stringify(result.outputs ?? []),
      challenger_feedback: feedback,
      challenger_approved: approved,
    });

    this.emitter.emit("paired.challenger_decision", {
      task_id: ctx.task_id,
      challenger_agent: challengerAgent,
      iteration: currentIteration,
      approved,
      feedback,
    });

    if (approved) {
      if (roleSwitch === "subtask") session.switchRoles();
      return {
        accept: true,
        new_status: "COMPLETED",
        data: { paired_iterations: currentIteration, challenger_approved: true },
      };
    }

    // Challenger rejected — check iteration budget
    if (currentIteration >= maxIterations) {
      // Max iterations reached without approval — escalate to HIL
      this.emitter.emit("paired.max_iterations_reached", {
        task_id: ctx.task_id,
        iterations: currentIteration,
        max_iterations: maxIterations,
      });

      return {
        accept: false,
        new_status: "NEEDS_REWORK",
        feedback: `Paired workflow: max_iterations (${maxIterations}) reached without challenger approval. ` +
          `Last challenger feedback: ${feedback || "(none)"}. Human review required.`,
        data: { paired_iterations: currentIteration, hil_suggested: true },
      };
    }

    if (roleSwitch === "subtask") session.switchRoles();

    return {
      accept: false,
      new_status: "NEEDS_REWORK",
      feedback: `[Paired workflow — iteration ${currentIteration}/${maxIterations}] Challenger '${challengerAgent}' rejected this output.\n${feedback}`,
      data: { paired_iterations: currentIteration, challenger_approved: false },
    };
  }

  /**
   * Build the review prompt for the challenger agent.
   */
  private buildChallengerPrompt(
    ctx: OverlayContext,
    result: TaskResult,
    history: Array<{ iteration: number; challenger_feedback: string; challenger_approved: boolean }>,
  ): string {
    const lines = [
      `You are the challenger agent reviewing task '${ctx.task_id}'.`,
      `Task description: ${ctx.task_definition.description}`,
      ``,
      `Driver outputs produced:`,
      JSON.stringify(result.outputs ?? [], null, 2),
    ];

    if (history.length > 0) {
      lines.push(``, `Previous review history:`);
      for (const h of history) {
        lines.push(`  Iteration ${h.iteration}: ${h.challenger_approved ? "APPROVED" : "REJECTED"} — ${h.challenger_feedback}`);
      }
    }

    lines.push(
      ``,
      `Review the driver's output carefully. If it meets quality standards, respond with:`,
      `  { "approved": true }`,
      `If it needs improvement, respond with:`,
      `  { "approved": false, "feedback": "<specific actionable feedback>" }`,
      `Respond with ONLY the JSON object. No other text.`,
    );

    return lines.join("\n");
  }

  /**
   * Parse challenger approval from TaskResult.
   * Checks handover_state.approved, then tries to parse error field as JSON.
   */
  private parseChallengerApproval(result: TaskResult): boolean {
    if (result.status === "FAILED") return false;

    const fromState = result.handover_state?.["approved"];
    if (typeof fromState === "boolean") return fromState;

    // Try to parse JSON from error field
    try {
      const parsed = JSON.parse(result.error ?? "");
      if (typeof parsed.approved === "boolean") return parsed.approved;
    } catch { /* ignore */ }

    // Default: if adapter returned COMPLETED with no explicit approval, treat as approved
    return result.status === "COMPLETED";
  }
}
