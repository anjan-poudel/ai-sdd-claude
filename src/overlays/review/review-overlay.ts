/**
 * Agentic review overlay — coder/reviewer loop with GO/NO_GO decisions.
 *
 * Roles never switch (coder stays coder, reviewer stays reviewer).
 * Exit is driven by GO/NO_GO, not confidence score.
 * Targeted at formal quality gates (PR code review, design review).
 *
 * Flow:
 *   1. Coder produces an artifact (handled by engine dispatch).
 *   2. Reviewer evaluates it against constitution quality guidelines.
 *   3. GO → accept (COMPLETED), append GO to review log.
 *   4. NO_GO → NEEDS_REWORK with feedback injected into coder context.
 *   5. If max_iterations reached without GO → HIL escalation.
 *
 * Review log is written to .ai-sdd/state/review-logs/<task-id>.json
 */

import type { BaseOverlay, OverlayContext, PostTaskOverlayResult } from "../base-overlay.ts";
import type { TaskResult } from "../../types/index.ts";
import type { RuntimeAdapter, DispatchOptions } from "../../adapters/base-adapter.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";
import { ReviewLogWriter } from "./review-log.ts";

export class ReviewOverlay implements BaseOverlay {
  readonly name = "review";
  readonly enabled: boolean;

  constructor(
    private readonly emitter: ObservabilityEmitter,
    options: { enabled?: boolean } = {},
    private readonly adapter?: RuntimeAdapter,
    private readonly logDir?: string,
  ) {
    this.enabled = options.enabled ?? false;
  }

  async postTask(
    ctx: OverlayContext,
    result: TaskResult,
  ): Promise<PostTaskOverlayResult> {
    const reviewConfig = ctx.task_definition.overlays?.review;
    if (!reviewConfig?.enabled) {
      return { accept: true, new_status: "COMPLETED" };
    }

    if (!this.adapter) {
      return {
        accept: false,
        new_status: "FAILED",
        feedback: "ReviewOverlay requires a RuntimeAdapter to dispatch the reviewer agent. Wire in the adapter at overlay construction time.",
      };
    }

    const reviewerAgent = reviewConfig.reviewer_agent ?? ctx.task_definition.agent;
    const coderAgent = reviewConfig.coder_agent ?? ctx.task_definition.agent;
    const maxIterations = reviewConfig.max_iterations ?? 3;

    const logDir = this.logDir ?? ReviewLogWriter.logDir(ctx.agent_context.project_path ?? ".");
    const logWriter = new ReviewLogWriter(logDir, ctx.task_id);
    const existingLog = logWriter.read();
    const currentIteration = existingLog.iterations.length + 1;

    // Build reviewer prompt
    const reviewerPrompt = this.buildReviewerPrompt(ctx, result, existingLog.iterations);
    const reviewCtx = {
      ...ctx.agent_context,
      constitution: reviewerPrompt,
      task_definition: {
        ...ctx.task_definition,
        agent: reviewerAgent,
        description: `Review coder output for task '${ctx.task_id}'`,
      },
    };

    const options: DispatchOptions = {
      operation_id: `${ctx.workflow_id}:${ctx.task_id}:review:${reviewerAgent}:iter${currentIteration}`,
      attempt_id: `${ctx.workflow_id}:${ctx.task_id}:review:${reviewerAgent}:iter${currentIteration}:${Date.now()}`,
    };

    this.emitter.emit("review.reviewer_dispatched", {
      task_id: ctx.task_id,
      reviewer_agent: reviewerAgent,
      iteration: currentIteration,
    });

    const reviewResult = await this.adapter.dispatch(reviewerAgent, reviewCtx, options);

    const { decision, feedback, qualityChecks } = this.parseReviewDecision(reviewResult);

    // Append to review log
    logWriter.append({
      task_id: ctx.task_id,
      reviewer_agent: reviewerAgent,
      coder_agent: coderAgent,
      iteration: currentIteration,
      decision,
      feedback,
      ...(qualityChecks !== undefined && { quality_checks: qualityChecks }),
      timestamp: new Date().toISOString(),
    });

    this.emitter.emit("review.decision", {
      task_id: ctx.task_id,
      reviewer_agent: reviewerAgent,
      iteration: currentIteration,
      decision,
      feedback,
    });

    if (decision === "GO") {
      logWriter.finalize("GO");
      return {
        accept: true,
        new_status: "COMPLETED",
        data: { review_decision: "GO", review_iteration: currentIteration },
      };
    }

    // NO_GO — check iteration budget
    if (currentIteration >= maxIterations) {
      logWriter.finalize("NO_GO");
      this.emitter.emit("review.max_iterations_reached", {
        task_id: ctx.task_id,
        iterations: currentIteration,
        max_iterations: maxIterations,
      });

      return {
        accept: false,
        new_status: "NEEDS_REWORK",
        feedback: `Agentic review: max_iterations (${maxIterations}) reached without GO decision. ` +
          `Last reviewer feedback: ${feedback || "(none)"}. Human review (HIL) required.`,
        data: {
          review_decision: "NO_GO",
          review_iteration: currentIteration,
          hil_suggested: true,
          review_log: existingLog,
        },
      };
    }

    return {
      accept: false,
      new_status: "NEEDS_REWORK",
      feedback: `[Agentic review — iteration ${currentIteration}/${maxIterations}] Reviewer '${reviewerAgent}' returned NO_GO.\n${feedback}`,
      data: { review_decision: "NO_GO", review_iteration: currentIteration },
    };
  }

  /**
   * Build the reviewer evaluation prompt.
   * Includes: task description, acceptance criteria, coder outputs,
   * constitution quality guidelines, and history of previous NO_GO decisions.
   */
  private buildReviewerPrompt(
    ctx: OverlayContext,
    result: TaskResult,
    previousDecisions: Array<{ iteration: number; decision: string; feedback: string }>,
  ): string {
    const lines = [
      `You are the reviewer agent for task '${ctx.task_id}'.`,
      ``,
      `TASK: ${ctx.task_definition.description}`,
      ``,
      `QUALITY GUIDELINES (from project constitution):`,
      ctx.agent_context.constitution,
      ``,
      `CODER OUTPUTS PRODUCED:`,
      JSON.stringify(result.outputs ?? [], null, 2),
    ];

    // Include acceptance criteria if present
    const acceptanceCriteria = (ctx.task_definition as Record<string, unknown>)["acceptance_criteria"];
    if (Array.isArray(acceptanceCriteria) && acceptanceCriteria.length > 0) {
      lines.push(``, `ACCEPTANCE CRITERIA:`);
      for (const criterion of acceptanceCriteria) {
        lines.push(`  - ${String(criterion)}`);
      }
    }

    if (previousDecisions.length > 0) {
      lines.push(``, `PREVIOUS REVIEW HISTORY (most recent last):`);
      for (const d of previousDecisions) {
        lines.push(`  Iteration ${d.iteration}: ${d.decision} — ${d.feedback}`);
      }
    }

    lines.push(
      ``,
      `Evaluate the coder's output against the quality guidelines and acceptance criteria above.`,
      ``,
      `Respond with ONLY a JSON object:`,
      `  { "decision": "GO", "feedback": "All criteria met." }`,
      `  or`,
      `  { "decision": "NO_GO", "feedback": "<specific actionable feedback>", "quality_checks": { "acceptance_criteria_met": true/false, "code_standards_met": true/false, "test_coverage_adequate": true/false, "security_review_passed": true/false } }`,
      ``,
      `No other text. The decision must be exactly "GO" or "NO_GO".`,
    );

    return lines.join("\n");
  }

  /**
   * Parse reviewer decision from TaskResult.
   * Checks handover_state.decision, then parses error/JSON field.
   */
  private parseReviewDecision(result: TaskResult): {
    decision: "GO" | "NO_GO";
    feedback: string;
    qualityChecks?: Record<string, boolean>;
  } {
    const defaultDecision = result.status === "FAILED" ? "NO_GO" : "GO";

    // Check handover_state first
    const hs = result.handover_state as Record<string, unknown> | undefined;
    if (hs?.["decision"] === "GO" || hs?.["decision"] === "NO_GO") {
      const qc = hs["quality_checks"] as Record<string, boolean> | undefined;
      return {
        decision: hs["decision"] as "GO" | "NO_GO",
        feedback: (hs["feedback"] as string | undefined) ?? "",
        ...(qc !== undefined && { qualityChecks: qc }),
      };
    }

    // Try JSON from error field
    try {
      const parsed = JSON.parse(result.error ?? "");
      if (parsed.decision === "GO" || parsed.decision === "NO_GO") {
        return {
          decision: parsed.decision,
          feedback: parsed.feedback ?? "",
          qualityChecks: parsed.quality_checks,
        };
      }
    } catch { /* ignore */ }

    return { decision: defaultDecision, feedback: result.error ?? "" };
  }
}
