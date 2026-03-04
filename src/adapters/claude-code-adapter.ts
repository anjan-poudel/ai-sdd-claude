/**
 * ClaudeCodeAdapter — uses Bun.spawn(['claude', ...]) to delegate tasks.
 * Requires `claude` CLI on PATH.
 */

import type { AgentContext, TaskResult } from "../types/index.ts";
import type { DispatchOptions } from "./base-adapter.ts";
import { RuntimeAdapter } from "./base-adapter.ts";
import { ToolError, TimeoutError, wrapError } from "./errors.ts";

export interface ClaudeCodeAdapterOptions {
  dispatch_mode?: "direct" | "delegation";
  timeout_ms?: number;
  max_tokens?: number;
  model?: string;
}

export class ClaudeCodeAdapter extends RuntimeAdapter {
  readonly dispatch_mode: "direct" | "delegation";
  readonly adapter_type = "claude_code";
  private readonly timeout_ms: number;
  private readonly model: string | undefined;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    super();
    this.dispatch_mode = options.dispatch_mode ?? "delegation";
    this.timeout_ms = options.timeout_ms ?? 300_000; // 5 minutes
    this.model = options.model;
  }

  async dispatch(
    task_id: string,
    context: AgentContext,
    options: DispatchOptions,
  ): Promise<TaskResult> {
    // Build the prompt/task brief for claude CLI
    const taskBrief = this.dispatch_mode === "delegation"
      ? this.buildDelegationBrief(task_id, context, options)
      : this.buildDirectPrompt(context, options);

    const args = [
      "--print",  // Non-interactive output
      "--output-format", "json",
    ];

    if (this.model) {
      args.push("--model", this.model);
    }

    args.push(taskBrief);

    try {
      const proc = Bun.spawn(["claude", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      // Race between process completion and timeout
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new TimeoutError(`Task '${task_id}' timed out after ${this.timeout_ms}ms`, this.timeout_ms)),
          this.timeout_ms,
        ),
      );

      const completion = (async () => {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { stdout, stderr, exitCode };
      })();

      const { stdout, stderr, exitCode } = await Promise.race([completion, timeout]);

      if (exitCode !== 0) {
        throw new ToolError(
          `claude CLI exited with code ${exitCode}: ${stderr || stdout}`,
          "claude",
        );
      }

      return this.parseOutput(task_id, stdout);
    } catch (err) {
      if (err instanceof TimeoutError || err instanceof ToolError) throw err;
      throw wrapError(err);
    }
  }

  private buildDelegationBrief(
    task_id: string,
    context: AgentContext,
    options: DispatchOptions,
  ): string {
    const { task_definition, handover_state } = context;
    return [
      `Task ID: ${task_id}`,
      `Operation ID: ${options.operation_id}`,
      ``,
      `Description: ${task_definition.description}`,
      ``,
      task_definition.outputs && task_definition.outputs.length > 0
        ? `Expected outputs:\n${task_definition.outputs.map((o) => `  - ${o.path}`).join("\n")}`
        : "",
      ``,
      `When complete, run: ai-sdd complete-task --task ${task_id} --output-path <path> --content-file <tmp>`,
    ].filter(Boolean).join("\n");
  }

  private buildDirectPrompt(
    context: AgentContext,
    options: DispatchOptions,
  ): string {
    return [
      context.constitution,
      ``,
      `## Task`,
      context.task_definition.description,
      ``,
      `Operation ID: ${options.operation_id}`,
    ].join("\n");
  }

  private parseOutput(_task_id: string, stdout: string): TaskResult {
    // claude --print --output-format json returns:
    // { result: string, is_error: boolean,
    //   total_input_tokens: number, total_output_tokens: number,
    //   total_cost_usd: number, session_id: string, ... }
    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;

      if (parsed["is_error"] === true) {
        return {
          status: "FAILED",
          error: String(parsed["result"] ?? "claude CLI reported an error"),
          error_type: "tool_error",
        };
      }

      const content = String(parsed["result"] ?? "");
      const inputTokens = Number(parsed["total_input_tokens"] ?? 0);
      const outputTokens = Number(parsed["total_output_tokens"] ?? 0);

      return {
        status: "COMPLETED",
        outputs: [],
        handover_state: { raw_output: content },
        ...(inputTokens > 0 || outputTokens > 0
          ? {
            tokens_used: {
              input: inputTokens,
              output: outputTokens,
              total: inputTokens + outputTokens,
            },
          }
          : {}),
      };
    } catch {
      // Non-JSON output — treat as completed with raw text handover
      return {
        status: "COMPLETED",
        outputs: [],
        handover_state: { raw_output: stdout.trim() },
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
      const exitCode = await proc.exited;
      return exitCode === 0;
    } catch {
      return false;
    }
  }
}
