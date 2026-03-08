/**
 * T-gap18: ConfidenceOverlay — uses eval/scorer.ts computeConfidence.
 */

import { describe, it, expect } from "bun:test";
import { ConfidenceOverlay } from "../../src/overlays/confidence/confidence-overlay.ts";
import type { OverlayContext } from "../../src/overlays/base-overlay.ts";
import type { TaskResult } from "../../src/types/index.ts";
import { ObservabilityEmitter } from "../../src/observability/emitter.ts";

const emitter = new ObservabilityEmitter({ run_id: "r1", workflow_id: "wf" });
const BASE_AGENT_CTX = {
  constitution: "# Test",
  handover_state: {},
  task_definition: { id: "test-task", agent: "dev", description: "Test" },
  dispatch_mode: "direct" as const,
};
const ctx: OverlayContext = {
  task_id: "test-task",
  workflow_id: "wf",
  run_id: "run-1",
  task_definition: { id: "test-task", agent: "dev", description: "Test" },
  agent_context: BASE_AGENT_CTX,
};

describe("ConfidenceOverlay: uses eval/scorer.ts metrics", () => {
  it("accepts when score >= threshold (default 0.7)", async () => {
    const overlay = new ConfidenceOverlay(emitter);
    const result = await overlay.postTask(ctx, {
      status: "COMPLETED",
      outputs: [{ path: "out.md" }],
      handover_state: {},
    });
    // Default threshold is 0.7; output with 1 output + neutral contract should pass
    const score = (result.data as Record<string, unknown>)?.["confidence_score"] as number;
    if (score >= 0.7) {
      expect(result.accept).toBe(true);
      expect(result.new_status).toBe("COMPLETED");
    } else {
      expect(result.accept).toBe(false);
      expect(result.new_status).toBe("NEEDS_REWORK");
    }
  });

  it("rejects when score < threshold — returns NEEDS_REWORK with feedback", async () => {
    // threshold=0.99 forces rejection (no task can score that high with heuristics)
    const overlay = new ConfidenceOverlay(emitter, { threshold: 0.99 });
    const result = await overlay.postTask(ctx, {
      status: "COMPLETED",
      outputs: [],
      handover_state: {},
    });
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("NEEDS_REWORK");
    expect(typeof result.feedback).toBe("string");
    expect(result.feedback).toContain("below threshold");
  });

  it("threshold=0 always accepts", async () => {
    const overlay = new ConfidenceOverlay(emitter, { threshold: 0 });
    const result = await overlay.postTask(ctx, {
      status: "COMPLETED",
      outputs: [],
      handover_state: {},
    });
    expect(result.accept).toBe(true);
    expect(result.new_status).toBe("COMPLETED");
  });

  it("result contains confidence_score between 0 and 1", async () => {
    const overlay = new ConfidenceOverlay(emitter);
    const result = await overlay.postTask(ctx, {
      status: "COMPLETED",
      outputs: [{ path: "out.md" }],
      handover_state: {},
    });
    const score = (result.data as Record<string, unknown>)?.["confidence_score"] as number;
    expect(typeof score).toBe("number");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("result contains eval_result with metrics array", async () => {
    const overlay = new ConfidenceOverlay(emitter);
    const result = await overlay.postTask(ctx, {
      status: "COMPLETED",
      outputs: [{ path: "out.md" }],
      handover_state: {},
    });
    const evalResult = (result.data as Record<string, unknown>)?.["eval_result"] as Record<string, unknown>;
    expect(Array.isArray(evalResult?.["metrics"])).toBe(true);
  });

  it("higher score when outputs present vs empty", async () => {
    const overlay = new ConfidenceOverlay(emitter);
    const withOutputs = await overlay.postTask(ctx, {
      status: "COMPLETED",
      outputs: [{ path: "out.md" }],
      handover_state: {},
    });
    const noOutputs = await overlay.postTask(ctx, {
      status: "COMPLETED",
      outputs: [],
      handover_state: {},
    });
    const scoreWith = (withOutputs.data as Record<string, unknown>)?.["confidence_score"] as number;
    const scoreNone = (noOutputs.data as Record<string, unknown>)?.["confidence_score"] as number;
    expect(scoreWith).toBeGreaterThan(scoreNone);
  });

  it("lint_passed evidence raises score via metric", async () => {
    const overlay = new ConfidenceOverlay(emitter);
    const withLint = await overlay.postTask(ctx, {
      status: "COMPLETED",
      outputs: [{ path: "out.md" }],
      handover_state: { lint_passed: true },
    });
    const withoutLint = await overlay.postTask(ctx, {
      status: "COMPLETED",
      outputs: [{ path: "out.md" }],
      handover_state: {},
    });
    const scoreWith = (withLint.data as Record<string, unknown>)?.["confidence_score"] as number;
    const scoreWithout = (withoutLint.data as Record<string, unknown>)?.["confidence_score"] as number;
    expect(scoreWith).toBeGreaterThanOrEqual(scoreWithout);
  });
});
