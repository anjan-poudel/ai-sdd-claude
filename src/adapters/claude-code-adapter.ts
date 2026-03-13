/**
 * ClaudeCodeAdapter — uses Bun.spawn(['claude', ...]) to delegate tasks.
 * Requires `claude` CLI on PATH.
 */

import { mkdirSync, createWriteStream } from "fs";
import { join, resolve } from "path";
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
    this.timeout_ms = options.timeout_ms ?? 600_000; // 10 minutes
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
      // Open a per-task log file so users can tail agent output live (ISSUE-007).
      // Location: .ai-sdd/sessions/default/logs/<task-id>.log (relative to cwd).
      const logsDir = resolve(process.cwd(), ".ai-sdd", "sessions", "default", "logs");
      try { mkdirSync(logsDir, { recursive: true }); } catch { /* ignore */ }
      const logPath = join(logsDir, `${task_id}.log`);
      const logStream = createWriteStream(logPath, { flags: "a" });
      logStream.write(`\n--- ${new Date().toISOString()} task=${task_id} ---\n`);

      const spawnEnv = { ...process.env };
      delete spawnEnv["CLAUDECODE"];
      process.stdout.write(`[ai-sdd]   spawning claude agent for '${task_id}' (log: ${logPath})\n`);
      const proc = Bun.spawn(["claude", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: spawnEnv,
      });

      // ISSUE-001: Liveness monitor — warn if no stdout/stderr for N minutes.
      // Configurable via AI_SDD_LIVENESS_INTERVAL_MS (default: 5 minutes).
      // This catches hung agents early without killing them.
      const livenessIntervalMs = parseInt(
        process.env.AI_SDD_LIVENESS_INTERVAL_MS ?? "300000", // 5 minutes
        10,
      );
      const failOnTimeout = process.env.FAIL_ON_TASK_TIMEOUT === "true";

      let lastActivityAt = Date.now();
      let stdoutChunks = "";
      let stderrChunks = "";
      let livenessWarnCount = 0;

      // Drain stdout incrementally — tee to log file + accumulate for parsing.
      const drainStdout = (async () => {
        if (!proc.stdout) return;
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            stdoutChunks += chunk;
            lastActivityAt = Date.now();
            try { logStream.write(chunk); } catch { /* non-fatal */ }
          }
        } finally {
          reader.releaseLock();
        }
      })();

      // Drain stderr incrementally — tee to log file + accumulate.
      const drainStderr = (async () => {
        if (!proc.stderr) return;
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            stderrChunks += chunk;
            lastActivityAt = Date.now();
            try { logStream.write(`[stderr] ${chunk}`); } catch { /* non-fatal */ }
          }
        } finally {
          reader.releaseLock();
        }
      })();

      // Liveness ticker — logs a warning if no output for livenessIntervalMs.
      let livenessTimer: ReturnType<typeof setInterval> | undefined;
      const livenessPromise = new Promise<void>((resolve) => {
        livenessTimer = setInterval(() => {
          const silentMs = Date.now() - lastActivityAt;
          if (silentMs >= livenessIntervalMs) {
            livenessWarnCount++;
            console.warn(
              `[ai-sdd] Task '${task_id}' has produced no output for ` +
              `${Math.round(silentMs / 60000)} min (warning #${livenessWarnCount}). ` +
              `Tail logs: tail -f ${logPath}`,
            );
          }
        }, livenessIntervalMs);
        // Resolve when process exits — the interval will be cleared then.
        void proc.exited.then(() => resolve());
      });
      void livenessPromise; // suppress unused-promise lint

      // Overall timeout — hard limit for the whole task.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => {
            reject(new TimeoutError(`Task '${task_id}' timed out after ${this.timeout_ms}ms`, this.timeout_ms));
          },
          this.timeout_ms,
        ),
      );

      const completion = (async () => {
        await Promise.all([drainStdout, drainStderr]);
        const exitCode = await proc.exited;
        clearInterval(livenessTimer);
        process.stdout.write(`[ai-sdd]   agent exited (task: ${task_id}, code: ${exitCode})\n`);
        try {
          logStream.write(`\n--- exit=${exitCode} ---\n`);
          logStream.end();
        } catch { /* non-fatal */ }
        return { stdout: stdoutChunks, stderr: stderrChunks, exitCode };
      })();

      let stdout: string, stderr: string, exitCode: number;
      try {
        ({ stdout, stderr, exitCode } = await Promise.race([completion, timeout]));
      } catch (err) {
        clearInterval(livenessTimer);
        if (err instanceof TimeoutError && !failOnTimeout) {
          console.warn(
            `[ai-sdd] Task '${task_id}' exceeded hard timeout — awaiting process completion ` +
            `(set FAIL_ON_TASK_TIMEOUT=true to abort immediately).`,
          );
          ({ stdout, stderr, exitCode } = await completion);
          console.warn(`[ai-sdd] Task '${task_id}' completed after timeout. Consider increasing timeout_ms.`);
        } else {
          throw err;
        }
      }

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

  override async healthCheck(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
      const exitCode = await proc.exited;
      return exitCode === 0;
    } catch {
      return false;
    }
  }
}
