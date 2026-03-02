/**
 * Evidence Policy Gate overlay — T0/T1/T2 post-task verification.
 */

import type { BaseOverlay, OverlayContext, PostTaskOverlayResult } from "../base-overlay.ts";
import type { TaskResult, RiskTier } from "../../types/index.ts";
import { ObservabilityEmitter } from "../../observability/emitter.ts";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export interface GateReport {
  task_id: string;
  risk_tier: RiskTier;
  verdict: "PASS" | "FAIL";
  failures: string[];
  confidence_score?: number;
  timestamp: string;
}

export class PolicyGateOverlay implements BaseOverlay {
  readonly name = "policy_gate";
  readonly enabled: boolean;

  constructor(
    private readonly outputsDir: string,
    private readonly emitter: ObservabilityEmitter,
    enabled = true,
  ) {
    this.enabled = enabled;
  }

  async postTask(
    ctx: OverlayContext,
    result: TaskResult,
  ): Promise<PostTaskOverlayResult> {
    const taskDef = ctx.task_definition;
    const riskTier: RiskTier = taskDef.overlays?.policy_gate?.risk_tier ?? "T0";

    const failures: string[] = [];

    // T0: acceptance evidence only
    if (riskTier === "T0" || riskTier === "T1" || riskTier === "T2") {
      if (!result.outputs || result.outputs.length === 0) {
        failures.push("No outputs produced");
      }
    }

    // T1: acceptance + verification evidence (tests_passed OR lint_passed required)
    if (riskTier === "T1" || riskTier === "T2") {
      const hasVerification = result.handover_state?.["tests_passed"] === true ||
        result.handover_state?.["lint_passed"] === true;
      if (!hasVerification) {
        failures.push(
          `${riskTier} risk tier requires verification evidence (tests_passed or lint_passed in handover_state)`,
        );
      }
    }

    // T2: also requires security evidence
    if (riskTier === "T2") {
      const hasSecurity = result.handover_state?.["security_clean"] === true;
      if (!hasSecurity) {
        failures.push("T2 risk tier requires security_clean evidence in handover_state");
      }
    }

    const verdict: "PASS" | "FAIL" = failures.length === 0 ? "PASS" : "FAIL";

    const report: GateReport = {
      task_id: ctx.task_id,
      risk_tier: riskTier,
      verdict,
      failures,
      timestamp: new Date().toISOString(),
    };

    this.writeReport(ctx.task_id, report);

    if (verdict === "PASS") {
      this.emitter.emit("gate.pass", {
        task_id: ctx.task_id,
        risk_tier: riskTier,
      });
      return { accept: true, new_status: "COMPLETED" };
    }

    this.emitter.emit("gate.fail", {
      task_id: ctx.task_id,
      risk_tier: riskTier,
      failures,
    });
    return {
      accept: false,
      new_status: "NEEDS_REWORK",
      feedback: `Gate failed (${riskTier}): ${failures.join("; ")}`,
    };
  }

  private writeReport(taskId: string, report: GateReport): void {
    if (!existsSync(this.outputsDir)) {
      mkdirSync(this.outputsDir, { recursive: true });
    }
    const path = join(this.outputsDir, `gate-report-${taskId}.json`);
    writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
  }
}
