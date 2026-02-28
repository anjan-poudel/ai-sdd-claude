/**
 * Token → USD cost computation.
 */

export interface ModelPricing {
  input_per_1k: number;   // USD per 1K input tokens
  output_per_1k: number;  // USD per 1K output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": { input_per_1k: 0.015, output_per_1k: 0.075 },
  "claude-sonnet-4-6": { input_per_1k: 0.003, output_per_1k: 0.015 },
  "claude-haiku-4-5-20251001": { input_per_1k: 0.00025, output_per_1k: 0.00125 },
  "gpt-4o": { input_per_1k: 0.005, output_per_1k: 0.015 },
  "gpt-4o-mini": { input_per_1k: 0.00015, output_per_1k: 0.0006 },
  "gpt-4-turbo": { input_per_1k: 0.01, output_per_1k: 0.03 },
  // Default fallback
  "default": { input_per_1k: 0.003, output_per_1k: 0.015 },
};

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  cost_usd?: number;
}

export class CostTracker {
  private totalCostUsd = 0;
  private taskCosts = new Map<string, number>();

  /**
   * Compute cost for a given model and token usage.
   */
  static computeCost(model: string, input_tokens: number, output_tokens: number): number {
    const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["default"]!;
    return (
      (input_tokens / 1000) * pricing.input_per_1k +
      (output_tokens / 1000) * pricing.output_per_1k
    );
  }

  /**
   * Record cost for a task.
   */
  recordTask(task_id: string, model: string, usage: { input: number; output: number }): number {
    const cost = CostTracker.computeCost(model, usage.input, usage.output);
    this.taskCosts.set(task_id, (this.taskCosts.get(task_id) ?? 0) + cost);
    this.totalCostUsd += cost;
    return cost;
  }

  /**
   * Get total cost so far.
   */
  getTotalCost(): number {
    return this.totalCostUsd;
  }

  /**
   * Get cost for a specific task.
   */
  getTaskCost(task_id: string): number {
    return this.taskCosts.get(task_id) ?? 0;
  }

  /**
   * Check if budget is exceeded.
   */
  isOverBudget(budget_usd: number): boolean {
    return this.totalCostUsd > budget_usd;
  }

  /**
   * Get a summary of all task costs.
   */
  getSummary(): Record<string, number> {
    return Object.fromEntries(this.taskCosts);
  }

  /**
   * Add USD pricing for a custom model.
   */
  static addModelPricing(model: string, pricing: ModelPricing): void {
    MODEL_PRICING[model] = pricing;
  }
}
