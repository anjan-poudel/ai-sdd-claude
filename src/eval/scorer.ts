/**
 * Confidence scorer — compute_confidence() and compute_raw().
 */

import type { EvalMetric, EvalResult, MetricType } from "./metrics.ts";
import { METRIC_WEIGHTS } from "./metrics.ts";

/**
 * Compute the raw weighted score from a list of metrics.
 */
export function computeRaw(metrics: EvalMetric[]): number {
  if (metrics.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const m of metrics) {
    weightedSum += m.score * m.weight;
    totalWeight += m.weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Compute the confidence score (normalized 0-1) for a task.
 */
export function computeConfidence(
  task_id: string,
  metrics: Array<{ type: MetricType; score: number; detail?: string }>,
): EvalResult {
  const evalMetrics: EvalMetric[] = metrics.map((m) => ({
    type: m.type,
    score: Math.max(0, Math.min(1, m.score)),
    weight: METRIC_WEIGHTS[m.type] ?? 0,
    detail: m.detail,
  }));

  const rawScore = computeRaw(evalMetrics);
  const confidenceScore = Math.max(0, Math.min(1, rawScore));

  return {
    task_id,
    metrics: evalMetrics,
    raw_score: rawScore,
    confidence_score: confidenceScore,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Validate LLM judge metric: evaluator_agent must ≠ task agent.
 * Throws at load time if violated.
 */
export function validateLLMJudge(taskAgent: string, evaluatorAgent: string): void {
  if (taskAgent === evaluatorAgent) {
    throw new Error(
      `llm_judge metric requires evaluator_agent ('${evaluatorAgent}') ≠ task agent ('${taskAgent}'). ` +
      `An agent cannot judge its own output.`,
    );
  }
}
