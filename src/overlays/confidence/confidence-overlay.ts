/**
 * Confidence overlay — advisory confidence score post-task.
 * Score gates task completion: below threshold → NEEDS_REWORK.
 * Supports llm_judge metric with external evaluator agent dispatch.
 * Uses the src/eval/scorer.ts framework for weighted metric computation.
 */

import type { BaseOverlay, OverlayContext, PostTaskOverlayResult } from "../base-overlay.ts";
import type { TaskResult, TaskOverlays } from "../../types/index.ts";
import type { RuntimeAdapter, DispatchOptions } from "../../adapters/base-adapter.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";
import { computeConfidence } from "../../eval/scorer.ts";
import type { MetricType } from "../../eval/metrics.ts";

type ConfidenceMetricConfig = NonNullable<NonNullable<TaskOverlays["confidence"]>["metrics"]>[number];

export class ConfidenceOverlay implements BaseOverlay {
  readonly name = "confidence";
  readonly enabled: boolean;
  private readonly threshold: number;

  constructor(
    private readonly emitter: ObservabilityEmitter,
    options: { enabled?: boolean; threshold?: number } = {},
    private readonly adapter?: RuntimeAdapter,
  ) {
    this.enabled = options.enabled ?? true;
    this.threshold = options.threshold ?? 0.7;
  }

  async postTask(
    ctx: OverlayContext,
    result: TaskResult,
  ): Promise<PostTaskOverlayResult> {
    const configuredMetrics = ctx.task_definition.overlays?.confidence?.metrics ?? [];
    const builtMetrics = this.buildMetrics(result);
    const llmJudgeScores = await this.dispatchLLMJudgeMetrics(ctx, result, configuredMetrics);

    const allMetrics = [...builtMetrics, ...llmJudgeScores];
    const evalResult = computeConfidence(ctx.task_id, allMetrics);

    // Per-task threshold overrides the overlay-level default when explicitly configured.
    const effectiveThreshold = ctx.task_definition.overlays?.confidence?.threshold ?? this.threshold;
    const belowThreshold = evalResult.confidence_score < effectiveThreshold;
    const lowConfThreshold = ctx.task_definition.overlays?.confidence?.low_confidence_threshold;
    const belowLowThreshold =
      lowConfThreshold !== undefined && evalResult.confidence_score < lowConfThreshold;

    this.emitter.emit("confidence.computed", {
      task_id: ctx.task_id,
      score: evalResult.confidence_score,
      threshold: effectiveThreshold,
      below_threshold: belowThreshold,
      below_low_threshold: belowLowThreshold,
      ...(lowConfThreshold !== undefined && { low_confidence_threshold: lowConfThreshold }),
      metrics: evalResult.metrics,
    });

    if (belowThreshold) {
      return {
        accept: false,
        new_status: "NEEDS_REWORK",
        feedback:
          `Confidence score ${evalResult.confidence_score.toFixed(2)} is below threshold ` +
          `${effectiveThreshold.toFixed(2)}. Improve output completeness and quality.`,
        data: {
          confidence_score: evalResult.confidence_score,
          eval_result: evalResult,
          // Signal to the engine to use the regeneration+escalation chain instead of
          // ordinary NEEDS_REWORK when the score is critically low.
          ...(belowLowThreshold && { confidence_action: "regenerate" }),
        },
      };
    }

    return {
      accept: true,
      new_status: "COMPLETED",
      data: { confidence_score: evalResult.confidence_score, eval_result: evalResult },
    };
  }

  /**
   * Dispatch llm_judge metrics to their configured evaluator agents.
   * Returns scored metrics to fold into the confidence computation.
   */
  private async dispatchLLMJudgeMetrics(
    ctx: OverlayContext,
    result: TaskResult,
    configuredMetrics: ConfidenceMetricConfig[],
  ): Promise<Array<{ type: MetricType; score: number; detail?: string }>> {
    const judgeMetrics = configuredMetrics.filter((m) => m.type === "llm_judge" && m.evaluator_agent);
    if (judgeMetrics.length === 0 || !this.adapter) return [];

    const judgements: Array<{ type: MetricType; score: number; detail?: string }> = [];

    for (const metric of judgeMetrics) {
      try {
        const score = await this.runLLMJudge(ctx, result, metric);
        judgements.push({ type: "llm_judge", score, detail: `Evaluated by ${metric.evaluator_agent}` });
      } catch (err) {
        this.emitter.emit("task.failed", {
          task_id: ctx.task_id,
          error: `llm_judge dispatch failed for evaluator '${metric.evaluator_agent}': ${err instanceof Error ? err.message : String(err)}`,
        });
        // On judge failure, score 0.5 (neutral) and continue — don't abort task evaluation
        judgements.push({ type: "llm_judge", score: 0.5, detail: `Judge error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    return judgements;
  }

  /**
   * Dispatch a single llm_judge call to the evaluator agent.
   * The evaluator receives the task outputs and returns a JSON score 0.0–1.0.
   */
  private async runLLMJudge(
    ctx: OverlayContext,
    result: TaskResult,
    metric: ConfidenceMetricConfig,
  ): Promise<number> {
    const evaluatorAgent = metric.evaluator_agent!;

    // Build a shallow judge context: evaluator gets task definition + outputs for review
    const judgeInstruction = [
      `You are an evaluator agent assessing the quality of task '${ctx.task_id}'.`,
      `Task description: ${ctx.task_definition.description}`,
      ``,
      `Task outputs produced:`,
      JSON.stringify(result.outputs ?? [], null, 2),
      ``,
      `Respond with ONLY a JSON object: { "score": <number 0.0 to 1.0> }`,
      `Where 1.0 = perfect quality, 0.0 = unacceptable. No other text.`,
    ].join("\n");

    const judgeContext = {
      ...ctx.agent_context,
      constitution: judgeInstruction,
      task_definition: {
        ...ctx.task_definition,
        agent: evaluatorAgent,
        description: `Evaluate quality of task '${ctx.task_id}' output`,
      },
    };

    const options: DispatchOptions = {
      operation_id: `${ctx.workflow_id}:${ctx.task_id}:llm_judge:${evaluatorAgent}`,
      attempt_id: `${ctx.workflow_id}:${ctx.task_id}:llm_judge:${evaluatorAgent}:${Date.now()}`,
    };

    const judgeResult = await this.adapter!.dispatch(evaluatorAgent, judgeContext, options);

    if (judgeResult.status === "FAILED") {
      throw new Error(`Judge agent '${evaluatorAgent}' returned FAILED: ${judgeResult.error ?? "unknown"}`);
    }

    // Parse score from handover_state or from error field (some adapters return text there)
    const rawScore = judgeResult.handover_state?.["score"] as number | undefined;
    if (typeof rawScore === "number") {
      return Math.max(0, Math.min(1, rawScore));
    }

    // Fallback: try to parse JSON from error field (used by some mock adapters in tests)
    const errorText = judgeResult.error ?? "";
    try {
      const parsed = JSON.parse(errorText);
      if (typeof parsed.score === "number") {
        return Math.max(0, Math.min(1, parsed.score));
      }
    } catch { /* ignore */ }

    // Cannot extract score
    throw new Error(`Judge agent '${evaluatorAgent}' did not return a parseable score`);
  }

  /**
   * Derive metric scores from the task result.
   * Heuristic: callers with real evidence pass it via handover_state.
   */
  private buildMetrics(result: TaskResult): Array<{ type: MetricType; score: number; detail?: string }> {
    const metrics: Array<{ type: MetricType; score: number; detail?: string }> = [];

    const hasOutputs = result.outputs !== undefined && result.outputs.length > 0;
    metrics.push({
      type: "output_completeness",
      score: hasOutputs ? 1.0 : 0.0,
      detail: hasOutputs ? `${result.outputs!.length} output(s) produced` : "No outputs",
    });

    const contractClean = result.handover_state?.["contract_valid"] === true;
    const contractFailed = result.handover_state?.["contract_valid"] === false;
    metrics.push({
      type: "contract_compliance",
      score: contractFailed ? 0.0 : contractClean ? 1.0 : 0.5,
      detail: contractFailed ? "Contract validation failed" : contractClean ? "Contract validated" : "Not checked",
    });

    if (result.handover_state?.["lint_passed"] !== undefined) {
      metrics.push({
        type: "lint_pass",
        score: result.handover_state["lint_passed"] === true ? 1.0 : 0.0,
      });
    }

    if (result.handover_state?.["security_clean"] !== undefined) {
      metrics.push({
        type: "security_clean",
        score: result.handover_state["security_clean"] === true ? 1.0 : 0.0,
      });
    }

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
