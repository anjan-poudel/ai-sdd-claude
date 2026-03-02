/**
 * Confidence overlay — advisory confidence score post-task.
 * Score is advisory only; never changes pass/fail verdict.
 * Uses the src/eval/scorer.ts framework for weighted metric computation.
 */

import type { BaseOverlay, OverlayContext, PostTaskOverlayResult } from "../base-overlay.ts";
import type { TaskResult } from "../../types/index.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";
import { computeConfidence } from "../../eval/scorer.ts";
import type { MetricType } from "../../eval/metrics.ts";

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
    const evalResult = computeConfidence(ctx.task_id, this.buildMetrics(result));

    this.emitter.emit("confidence.computed", {
      task_id: ctx.task_id,
      score: evalResult.confidence_score,
      threshold: this.threshold,
      advisory: true,
      metrics: evalResult.metrics,
    });

    // Advisory only — always accept regardless of score
    return {
      accept: true,
      new_status: "COMPLETED",
      data: { confidence_score: evalResult.confidence_score, eval_result: evalResult },
    };
  }

  /**
   * Derive metric scores from the task result.
   * All scores are heuristic since we don't run linters or test suites here;
   * callers that have real evidence should pass it via handover_state.
   */
  private buildMetrics(result: TaskResult): Array<{ type: MetricType; score: number; detail?: string }> {
    const metrics: Array<{ type: MetricType; score: number; detail?: string }> = [];

    // output_completeness: did the task produce outputs?
    const hasOutputs = result.outputs !== undefined && result.outputs.length > 0;
    metrics.push({
      type: "output_completeness",
      score: hasOutputs ? 1.0 : 0.0,
      detail: hasOutputs ? `${result.outputs!.length} output(s) produced` : "No outputs",
    });

    // contract_compliance: inferred from handover_state if available
    const contractClean = result.handover_state?.["contract_valid"] === true;
    const contractFailed = result.handover_state?.["contract_valid"] === false;
    metrics.push({
      type: "contract_compliance",
      score: contractFailed ? 0.0 : contractClean ? 1.0 : 0.5,
      detail: contractFailed ? "Contract validation failed" : contractClean ? "Contract validated" : "Not checked",
    });

    // lint_pass: from handover_state
    if (result.handover_state?.["lint_passed"] !== undefined) {
      metrics.push({
        type: "lint_pass",
        score: result.handover_state["lint_passed"] === true ? 1.0 : 0.0,
      });
    }

    // security_clean: from handover_state
    if (result.handover_state?.["security_clean"] !== undefined) {
      metrics.push({
        type: "security_clean",
        score: result.handover_state["security_clean"] === true ? 1.0 : 0.0,
      });
    }

    // token_efficiency: output tokens / 500 (informational, capped at 1)
    if (result.tokens_used) {
      metrics.push({
        type: "token_efficiency",
        score: Math.min(1.0, result.tokens_used.output / 500),
        detail: `${result.tokens_used.output} output tokens`,
      });
    }

    return metrics;
  }
}
