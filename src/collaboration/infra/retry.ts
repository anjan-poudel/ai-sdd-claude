/**
 * RetryWithBackoff and CollabHttpClient — HTTP infrastructure for collaboration adapters.
 * Uses Bun's native fetch. Respects Retry-After header. 10s default request timeout.
 */

import type { Result, AdapterError } from "../types.ts";

export interface RetryOptions {
  maxRetries: number;       // default 3
  initialDelayMs: number;   // default 1000
  multiplier: number;       // default 2
  retryableStatuses: number[];  // default [429, 500, 502, 503, 504]
  timeoutMs: number;        // default 10000
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  multiplier: 2,
  retryableStatuses: [429, 500, 502, 503, 504],
  timeoutMs: 10_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRetryDelay(response: Response | null, attempt: number, opts: RetryOptions): number {
  // Check Retry-After header first.
  if (response) {
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
      const seconds = parseFloat(retryAfter);
      if (!isNaN(seconds)) return seconds * 1000;
    }
  }
  // Exponential backoff.
  return opts.initialDelayMs * Math.pow(opts.multiplier, attempt);
}

export interface CollabHttpClient {
  get<T>(url: string, headers?: Record<string, string>): Promise<Result<T>>;
  post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<Result<T>>;
  put<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<Result<T>>;
  delete<T>(url: string, headers?: Record<string, string>): Promise<Result<T>>;
}

export class RetryHttpClient implements CollabHttpClient {
  private opts: RetryOptions;

  constructor(
    private readonly baseHeaders: Record<string, string> = {},
    opts: Partial<RetryOptions> = {},
  ) {
    this.opts = { ...DEFAULT_RETRY_OPTIONS, ...opts };
  }

  async get<T>(url: string, headers?: Record<string, string>): Promise<Result<T>> {
    return this.request<T>("GET", url, undefined, headers);
  }

  async post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<Result<T>> {
    return this.request<T>("POST", url, body, headers);
  }

  async put<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<Result<T>> {
    return this.request<T>("PUT", url, body, headers);
  }

  async delete<T>(url: string, headers?: Record<string, string>): Promise<Result<T>> {
    return this.request<T>("DELETE", url, undefined, headers);
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Result<T>> {
    const mergedHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.baseHeaders,
      ...extraHeaders,
    };

    let lastResponse: Response | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs);

        let response: Response;
        try {
          response = await fetch(url, {
            method,
            headers: mergedHeaders,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        lastResponse = response;

        if (response.ok) {
          // Handle 204 No Content.
          if (response.status === 204) {
            return { ok: true, value: undefined as T };
          }
          try {
            const json = await response.json() as T;
            return { ok: true, value: json };
          } catch {
            return {
              ok: false,
              error: {
                code: "UNKNOWN",
                message: `Failed to parse JSON response from ${url}`,
                retryable: false,
              },
            };
          }
        }

        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            error: {
              code: "AUTH",
              message: `Authentication failed: HTTP ${response.status} from ${url}`,
              retryable: false,
            },
          };
        }

        if (response.status === 404) {
          return {
            ok: false,
            error: {
              code: "NOT_FOUND",
              message: `Resource not found: HTTP 404 from ${url}`,
              retryable: false,
            },
          };
        }

        if (response.status === 409) {
          return {
            ok: false,
            error: {
              code: "CONFLICT",
              message: `Conflict: HTTP 409 from ${url}`,
              retryable: true,
            },
          };
        }

        if (this.opts.retryableStatuses.includes(response.status) && attempt < this.opts.maxRetries) {
          const delay = getRetryDelay(response, attempt, this.opts);
          await sleep(delay);
          continue;
        }

        return {
          ok: false,
          error: {
            code: "UNKNOWN",
            message: `HTTP ${response.status} from ${url}`,
            retryable: false,
          },
        };
      } catch (e) {
        lastError = e;
        const isTimeout = e instanceof Error && e.name === "AbortError";
        const errorCode: AdapterError["code"] = isTimeout ? "NETWORK" : "NETWORK";

        if (attempt < this.opts.maxRetries) {
          const delay = getRetryDelay(null, attempt, this.opts);
          await sleep(delay);
          continue;
        }

        return {
          ok: false,
          error: {
            code: errorCode,
            message: `Network error after ${attempt + 1} attempts: ${String(e)}`,
            retryable: false,
            cause: e,
          },
        };
      }
    }

    return {
      ok: false,
      error: {
        code: "NETWORK",
        message: `Request failed after ${this.opts.maxRetries} retries: ${String(lastError)}`,
        retryable: false,
        cause: lastError,
      },
    };
  }
}
