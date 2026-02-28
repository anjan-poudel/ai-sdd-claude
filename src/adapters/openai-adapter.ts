/**
 * OpenAI adapter — Chat Completions with function calling.
 * Requires `openai` optional peer dep.
 */

import type { AgentContext, TaskResult, TokenUsage } from "../types/index.ts";
import type { DispatchOptions } from "./base-adapter.ts";
import { RuntimeAdapter } from "./base-adapter.ts";
import { RateLimitError, ContextOverflowError, AuthError, ProviderError, wrapError } from "./errors.ts";
import { buildSystemPrompt } from "../core/context-manager.ts";

export interface OpenAIAdapterOptions {
  api_key?: string;
  model?: string;
  base_url?: string;
  timeout_ms?: number;
  organization?: string;
}

export class OpenAIAdapter extends RuntimeAdapter {
  readonly dispatch_mode = "direct" as const;
  readonly adapter_type = "openai";
  private readonly options: OpenAIAdapterOptions;
  private client: unknown = null;

  constructor(options: OpenAIAdapterOptions = {}) {
    super();
    this.options = {
      model: "gpt-4o",
      timeout_ms: 120_000,
      ...options,
    };
  }

  private async getClient(): Promise<unknown> {
    if (this.client) return this.client;

    try {
      const { default: OpenAI } = await import("openai");
      this.client = new OpenAI({
        apiKey: this.options.api_key ?? process.env["OPENAI_API_KEY"],
        baseURL: this.options.base_url,
        organization: this.options.organization,
        timeout: this.options.timeout_ms,
      });
      return this.client;
    } catch {
      throw new Error(
        "OpenAI package not installed. Run: bun add openai",
      );
    }
  }

  async dispatch(
    task_id: string,
    context: AgentContext,
    options: DispatchOptions,
  ): Promise<TaskResult> {
    const client = await this.getClient() as {
      chat: {
        completions: {
          create: (params: unknown) => Promise<unknown>;
        };
      };
    };

    const systemPrompt = buildSystemPrompt({
      agent_persona: context.task_definition.description,
      agent_display_name: context.task_definition.agent,
      constitution: context.constitution,
      task_definition: context.task_definition,
    });

    const model = this.options.model ?? "gpt-4o";

    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Complete task '${task_id}': ${context.task_definition.description}`,
          },
        ],
        user: options.operation_id, // idempotency key
      }) as {
        choices: Array<{ message: { content: string | null } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      const content = response.choices[0]?.message?.content ?? "";
      const usage = response.usage;

      const tokenUsage: TokenUsage | undefined = usage ? {
        input: usage.prompt_tokens,
        output: usage.completion_tokens,
        total: usage.total_tokens,
      } : undefined;

      return {
        status: "COMPLETED",
        outputs: [],
        handover_state: { raw_output: content },
        tokens_used: tokenUsage,
      };
    } catch (err) {
      const error = err as { status?: number; message?: string; code?: string };
      if (error.status === 429) {
        throw new RateLimitError(`Rate limited: ${error.message}`);
      }
      if (error.status === 401) {
        throw new AuthError(`Authentication failed: ${error.message}`);
      }
      if (error.code === "context_length_exceeded") {
        throw new ContextOverflowError(`Context too long: ${error.message}`);
      }
      if (error.status && error.status >= 500) {
        throw new ProviderError(`Provider error: ${error.message}`, error.status);
      }
      throw wrapError(err);
    }
  }
}
