/**
 * AdapterError taxonomy — 8 error types.
 */

import type { AdapterErrorType } from "../types/index.ts";

export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly error_type: AdapterErrorType,
    public readonly retryable: boolean,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export class RateLimitError extends AdapterError {
  constructor(message: string, public readonly retry_after_ms?: number) {
    super(message, "rate_limit", true, { retry_after_ms });
    this.name = "RateLimitError";
  }
}

export class ContextOverflowError extends AdapterError {
  constructor(message: string, public readonly token_count?: number, public readonly limit?: number) {
    super(message, "context_overflow", false, { token_count, limit });
    this.name = "ContextOverflowError";
  }
}

export class AuthError extends AdapterError {
  constructor(message: string) {
    super(message, "auth_error", false);
    this.name = "AuthError";
  }
}

export class NetworkError extends AdapterError {
  constructor(message: string) {
    super(message, "network_error", true);
    this.name = "NetworkError";
  }
}

export class ToolError extends AdapterError {
  constructor(message: string, public readonly tool_name?: string) {
    super(message, "tool_error", true, { tool_name });
    this.name = "ToolError";
  }
}

export class TimeoutError extends AdapterError {
  constructor(message: string, public readonly timeout_ms?: number) {
    super(message, "timeout", true, { timeout_ms });
    this.name = "TimeoutError";
  }
}

export class ProviderError extends AdapterError {
  constructor(message: string, public readonly status_code?: number) {
    super(message, "provider_error", true, { status_code });
    this.name = "ProviderError";
  }
}

export class UnknownAdapterError extends AdapterError {
  constructor(message: string) {
    super(message, "unknown", false);
    this.name = "UnknownAdapterError";
  }
}

/**
 * Wrap an unknown error into an AdapterError.
 */
export function wrapError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new UnknownAdapterError(msg);
}
