/**
 * Traceability overlay — LLM-judge post-task gate that verifies task outputs
 * stay within the scope of locked requirements.
 *
 * Runs on design + implement phases. Reads the requirements lock file and
 * dispatches an LLM judge to evaluate scope compliance.
 *
 * Chain position: after Paired/Review, before Confidence.
 */

import type { BaseOverlay, OverlayContext, PostTaskOverlayResult } from "../base-overlay.ts";
import type { TaskResult } from "../../types/index.ts";
import type { RuntimeAdapter, DispatchOptions } from "../../adapters/base-adapter.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";
import { readFileSync, existsSync } from "fs";

const TRACEABILITY_PHASES = ["design", "implement"];
const DEFAULT_LOCK_PATH = "specs/define-requirements.lock.yaml";

export interface TraceabilityJudgeResult {
  in_scope: boolean;
  findings: string[];
}

export class TraceabilityOverlay implements BaseOverlay {
  readonly name = "traceability";
  readonly enabled: boolean;
  private readonly lockFilePath: string;
  private readonly evaluatorAgent: string;

  constructor(
    private readonly emitter: ObservabilityEmitter,
    options: { enabled?: boolean; lockFilePath?: string; evaluator_agent?: string } = {},
    private readonly adapter?: RuntimeAdapter,
  ) {
    this.enabled = options.enabled ?? false;
    this.lockFilePath = options.lockFilePath ?? DEFAULT_LOCK_PATH;
    this.evaluatorAgent = options.evaluator_agent ?? "reviewer";
  }

  async postTask(
    ctx: OverlayContext,
    result: TaskResult,
  ): Promise<PostTaskOverlayResult> {
    // Phase filter: only design + implement
    const phase = (ctx.task_definition as { phase?: string }).phase;
    if (!phase || !TRACEABILITY_PHASES.includes(phase)) {
      return { accept: true, new_status: "COMPLETED" };
    }

    // Read requirements lock file
    const lockContent = this.readLockFile();
    if (!lockContent) {
      this.emitter.emit("traceability.skipped", {
        task_id: ctx.task_id,
        reason: "no lock file",
      });
      return { accept: true, new_status: "COMPLETED" };
    }

    // No adapter → skip silently (same pattern as ConfidenceOverlay)
    if (!this.adapter) {
      this.emitter.emit("traceability.skipped", {
        task_id: ctx.task_id,
        reason: "no adapter available",
      });
      return { accept: true, new_status: "COMPLETED" };
    }

    // Dispatch LLM judge
    try {
      const judgeResult = await this.runLLMJudge(ctx, result, lockContent);

      this.emitter.emit("traceability.evaluated", {
        task_id: ctx.task_id,
        in_scope: judgeResult.in_scope,
        findings: judgeResult.findings,
        evaluator_agent: this.evaluatorAgent,
      });

      if (!judgeResult.in_scope) {
        return {
          accept: false,
          new_status: "NEEDS_REWORK",
          feedback:
            `Traceability check failed: task output introduces elements not traceable to locked requirements. ` +
            `Findings: ${judgeResult.findings.join("; ")}`,
          data: { traceability: judgeResult },
        };
      }

      return {
        accept: true,
        new_status: "COMPLETED",
        data: { traceability: judgeResult },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.emitter.emit("traceability.failed", {
        task_id: ctx.task_id,
        error: errorMessage,
      });
      // Don't block on judge errors — return accept: true
      return { accept: true, new_status: "COMPLETED" };
    }
  }

  private readLockFile(): string | null {
    if (!existsSync(this.lockFilePath)) {
      return null;
    }
    try {
      return readFileSync(this.lockFilePath, "utf-8");
    } catch {
      return null;
    }
  }

  private async runLLMJudge(
    ctx: OverlayContext,
    result: TaskResult,
    lockContent: string,
  ): Promise<TraceabilityJudgeResult> {
    const judgeInstruction = [
      `You are a traceability evaluator. Given:`,
      `1. Requirements lock (the approved requirements for this project)`,
      `2. Task output (the artifact produced by this task)`,
      ``,
      `Determine whether the task output stays within the scope of the locked requirements.`,
      `- "in_scope": true if output addresses ONLY topics covered by the requirements`,
      `- "in_scope": false if output introduces features, components, or decisions not traceable to any requirement`,
      ``,
      `Requirements lock:`,
      lockContent,
      ``,
      `Task: ${ctx.task_id} — ${ctx.task_definition.description}`,
      `Task outputs:`,
      JSON.stringify(result.outputs ?? [], null, 2),
      ``,
      `Respond with ONLY a JSON object: { "in_scope": true/false, "findings": ["..."] }`,
    ].join("\n");

    const judgeContext = {
      ...ctx.agent_context,
      constitution: judgeInstruction,
      task_definition: {
        ...ctx.task_definition,
        agent: this.evaluatorAgent,
        description: `Evaluate traceability of task '${ctx.task_id}' output against requirements lock`,
      },
    };

    const options: DispatchOptions = {
      operation_id: `${ctx.workflow_id}:${ctx.task_id}:traceability:${this.evaluatorAgent}`,
      attempt_id: `${ctx.workflow_id}:${ctx.task_id}:traceability:${this.evaluatorAgent}:${Date.now()}`,
    };

    const judgeResult = await this.adapter!.dispatch(this.evaluatorAgent, judgeContext, options);

    if (judgeResult.status === "FAILED") {
      throw new Error(`Traceability judge '${this.evaluatorAgent}' returned FAILED: ${judgeResult.error ?? "unknown"}`);
    }

    // Parse result from handover_state
    const inScope = judgeResult.handover_state?.["in_scope"];
    const findings = judgeResult.handover_state?.["findings"];

    if (typeof inScope === "boolean") {
      return {
        in_scope: inScope,
        findings: Array.isArray(findings) ? findings.map(String) : [],
      };
    }

    // Fallback: try to parse JSON from error field
    const errorText = judgeResult.error ?? "";
    try {
      const parsed = JSON.parse(errorText);
      if (typeof parsed.in_scope === "boolean") {
        return {
          in_scope: parsed.in_scope,
          findings: Array.isArray(parsed.findings) ? parsed.findings.map(String) : [],
        };
      }
    } catch { /* ignore */ }

    throw new Error(`Traceability judge '${this.evaluatorAgent}' did not return a parseable result`);
  }
}
