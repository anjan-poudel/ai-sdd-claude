/**
 * Eval metrics types and weights.
 */

export type MetricType =
  | "output_completeness"  // Did the task produce all required outputs?
  | "contract_compliance"  // Did outputs pass artifact contract validation?
  | "acceptance_criteria"  // Did outputs satisfy acceptance criteria?
  | "test_coverage"        // Test coverage percentage (if applicable)
  | "lint_pass"            // Did lint pass?
  | "security_clean"       // No security violations?
  | "llm_judge"            // LLM-based quality judgment (requires evaluator_agent ≠ task agent)
  | "token_efficiency";    // Output tokens / task complexity ratio

export const METRIC_WEIGHTS: Record<MetricType, number> = {
  output_completeness: 0.25,
  contract_compliance: 0.20,
  acceptance_criteria: 0.20,
  test_coverage: 0.10,
  lint_pass: 0.10,
  security_clean: 0.10,
  llm_judge: 0.05,
  token_efficiency: 0.00, // Informational only
};

export interface EvalMetric {
  type: MetricType;
  score: number;       // 0.0 to 1.0
  weight: number;
  detail?: string;
}

export interface EvalResult {
  task_id: string;
  metrics: EvalMetric[];
  raw_score: number;     // Weighted sum
  confidence_score: number; // Normalized 0-1
  computed_at: string;
}
