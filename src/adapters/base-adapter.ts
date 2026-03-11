/**
 * RuntimeAdapter abstract base class.
 * All adapters implement this interface.
 */

import type {
  AgentContext,
  AdapterErrorType,
  DispatchMode,
  TaskResult,
  TokenUsage,
} from "../types/index.ts";
import { AdapterError } from "./errors.ts";

export interface RetryPolicy {
  max_attempts: number;
  retryable_errors: AdapterErrorType[];
  backoff_base_ms: number;
  backoff_max_ms: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 3,
  retryable_errors: ["rate_limit", "network_error", "tool_error", "timeout", "provider_error"],
  backoff_base_ms: 1000,
  backoff_max_ms: 30000,
};

export interface SamplingParams {
  /** Override temperature for this dispatch only (0.0–1.0). */
  temperature?: number;
  /** Override top_p nucleus sampling for this dispatch only (0.0–1.0). */
  top_p?: number;
}

export interface DispatchOptions {
  operation_id: string;
  attempt_id: string;
  timeout_ms?: number;
  /** Sampling parameter overrides — set by the engine on regeneration retries. */
  sampling_params?: SamplingParams;
}

export abstract class RuntimeAdapter {
  abstract readonly dispatch_mode: DispatchMode;
  abstract readonly adapter_type: string;

  protected retry_policy: RetryPolicy = DEFAULT_RETRY_POLICY;

  /**
   * Dispatch a task to the underlying LLM or tool.
   *
   * @param task_id - The task identifier
   * @param context - Agent context (constitution + handover state + task definition)
   * @param options - Idempotency keys and dispatch options
   */
  abstract dispatch(
    task_id: string,
    context: AgentContext,
    options: DispatchOptions,
  ): Promise<TaskResult>;

  /**
   * Check if the adapter is healthy / available.
   */
  async healthCheck(): Promise<boolean> {
    return true;
  }

  /**
   * Dispatch with retry logic.
   */
  async dispatchWithRetry(
    task_id: string,
    context: AgentContext,
    options: DispatchOptions,
  ): Promise<TaskResult> {
    let lastResult: TaskResult | undefined;
    const policy = this.retry_policy;

    for (let attempt = 1; attempt <= policy.max_attempts; attempt++) {
      const attempt_id = `${options.attempt_id}:attempt_${attempt}`;
      try {
        const result = await this.dispatch(task_id, context, {
          ...options,
          attempt_id,
        });

        if (result.status === "FAILED" && result.error_type) {
          if (!policy.retryable_errors.includes(result.error_type)) {
            return result;
          }
          lastResult = result;
          if (attempt < policy.max_attempts) {
            const delay = Math.min(
              policy.backoff_base_ms * Math.pow(2, attempt - 1),
              policy.backoff_max_ms,
            );
            await sleep(delay);
            continue;
          }
        }
        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const adapterErr = err instanceof AdapterError ? err : null;
        const error_type: AdapterErrorType = adapterErr?.error_type ?? "unknown";
        const retryable = adapterErr !== null ? adapterErr.retryable : true;

        lastResult = {
          status: "FAILED",
          error: errMsg,
          error_type,
        };

        if (!retryable || attempt >= policy.max_attempts) {
          return lastResult;
        }

        const delay = Math.min(
          policy.backoff_base_ms * Math.pow(2, attempt - 1),
          policy.backoff_max_ms,
        );
        await sleep(delay);
      }
    }

    return lastResult ?? {
      status: "FAILED",
      error: "Max retry attempts exceeded",
      error_type: "unknown",
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { AgentContext, TaskResult, TokenUsage };
