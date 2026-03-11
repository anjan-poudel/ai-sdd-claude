/**
 * OpenAI adapter — Chat Completions, direct dispatch mode.
 * Requires `openai` optional peer dep.
 *
 * When the task declares outputs, the adapter asks the model to return a JSON
 * envelope containing file content for each declared path.  It then writes
 * those files atomically (tmp+rename) so the engine can record them in state.
 * When no outputs are declared the raw response goes into handover_state.
 */

import { writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import type { AgentContext, TaskResult, TokenUsage, TaskOutput } from "../types/index.ts";
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

/** JSON envelope the model returns when outputs are declared. */
interface FileEnvelope {
  files: Array<{ path: string; content: string }>;
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

    const declaredOutputs = context.task_definition.outputs ?? [];
    const hasOutputs = declaredOutputs.length > 0;

    const systemPrompt = buildSystemPrompt({
      agent_persona: context.task_definition.description,
      agent_display_name: context.task_definition.agent,
      constitution: context.constitution,
      task_definition: context.task_definition,
    });

    // When outputs are declared, append structured-output instructions so the
    // model returns a parseable JSON envelope instead of free-form prose.
    const outputInstruction = hasOutputs
      ? [
        "",
        "## Required Response Format",
        "Return ONLY a JSON object with this exact structure — no prose, no markdown fences:",
        '{ "files": [{ "path": "<output_path>", "content": "<full_file_content>" }] }',
        "Include exactly these output files:",
        ...declaredOutputs.map((o) => `  - ${o.path}`),
      ].join("\n")
      : "";

    const model = this.options.model ?? "gpt-4o";

    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt + outputInstruction },
          {
            role: "user",
            content: `Complete task '${task_id}': ${context.task_definition.description}`,
          },
        ],
        user: options.operation_id, // idempotency hint
        // Apply sampling overrides when provided (e.g. regeneration retries)
        ...(options.sampling_params?.temperature !== undefined && { temperature: options.sampling_params.temperature }),
        ...(options.sampling_params?.top_p !== undefined && { top_p: options.sampling_params.top_p }),
      }) as {
        choices: Array<{ message: { content: string | null } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      const content = response.choices[0]?.message?.content ?? "";
      const usage = response.usage;

      const tokenUsage: TokenUsage | undefined = usage
        ? {
          input: usage.prompt_tokens,
          output: usage.completion_tokens,
          total: usage.total_tokens,
        }
        : undefined;

      // ── Structured output path ─────────────────────────────────────────────
      if (hasOutputs && context.project_path) {
        const written = this.writeOutputFiles(content, declaredOutputs, context.project_path);
        if (written !== null) {
          return {
            status: "COMPLETED",
            outputs: written,
            handover_state: {},
            ...(tokenUsage !== undefined && { tokens_used: tokenUsage }),
          };
        }
        // Fall through to raw-output if parsing failed
      }

      // ── Raw-output fallback ────────────────────────────────────────────────
      return {
        status: "COMPLETED",
        outputs: [],
        handover_state: { raw_output: content },
        ...(tokenUsage !== undefined && { tokens_used: tokenUsage }),
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

  /**
   * Parse the model's JSON envelope and write each file atomically.
   * Returns the list of written TaskOutputs, or null if parsing fails.
   */
  private writeOutputFiles(
    content: string,
    declared: TaskOutput[],
    projectPath: string,
  ): TaskOutput[] | null {
    // Strip optional markdown fences the model might wrap around JSON
    const stripped = content.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

    let envelope: FileEnvelope;
    try {
      envelope = JSON.parse(stripped) as FileEnvelope;
    } catch {
      return null; // Model returned non-JSON — caller falls back to raw_output
    }

    if (!Array.isArray(envelope.files)) return null;

    const written: TaskOutput[] = [];

    for (const declared_output of declared) {
      const file = envelope.files.find((f) => f.path === declared_output.path);
      if (!file) continue;

      const absPath = resolve(projectPath, file.path);
      const dir = dirname(absPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      // Atomic write: tmp + rename
      const tmpPath = `${absPath}.tmp`;
      writeFileSync(tmpPath, file.content, "utf-8");
      renameSync(tmpPath, absPath);

      written.push({
        path: declared_output.path,
        ...(declared_output.contract !== undefined && { contract: declared_output.contract }),
      });
    }

    return written.length > 0 ? written : null;
  }
}
