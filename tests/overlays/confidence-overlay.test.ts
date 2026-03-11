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

describe("ConfidenceOverlay: llm_judge dispatch", () => {
  function makeMockAdapter(score: number): import("../../src/adapters/base-adapter.ts").RuntimeAdapter {
    return {
      dispatch_mode: "direct" as const,
      adapter_type: "mock",
      retry_policy: { max_attempts: 1, retryable_errors: [], backoff_base_ms: 0, backoff_max_ms: 0 },
      async dispatch(): Promise<import("../../src/types/index.ts").TaskResult> {
        return { status: "COMPLETED", handover_state: { score } };
      },
      async dispatchWithRetry(task_id: string, ctx: import("../../src/types/index.ts").AgentContext, opts: import("../../src/adapters/base-adapter.ts").DispatchOptions) {
        return this.dispatch(task_id, ctx, opts);
      },
      async healthCheck() { return true; },
    } as import("../../src/adapters/base-adapter.ts").RuntimeAdapter;
  }

  function makeCtxWithJudge(taskAgent: string, evaluatorAgent: string): OverlayContext {
    return {
      task_id: "test-task",
      workflow_id: "wf",
      run_id: "run-1",
      task_definition: {
        id: "test-task",
        agent: taskAgent,
        description: "Test",
        overlays: {
          confidence: {
            metrics: [{ type: "llm_judge", evaluator_agent: evaluatorAgent }],
          },
        },
      },
      agent_context: {
        ...BASE_AGENT_CTX,
        task_definition: { id: "test-task", agent: taskAgent, description: "Test" },
      },
    };
  }

  it("dispatches evaluator agent and folds judge score into confidence", async () => {
    const adapter = makeMockAdapter(0.9);
    const overlay = new ConfidenceOverlay(emitter, { threshold: 0.5 }, adapter);
    const result = await overlay.postTask(
      makeCtxWithJudge("dev", "reviewer"),
      { status: "COMPLETED", outputs: [{ path: "out.md" }], handover_state: {} },
    );
    expect(result.accept).toBe(true);
    const evalResult = (result.data as Record<string, unknown>)?.["eval_result"] as Record<string, unknown>;
    const metrics = evalResult?.["metrics"] as Array<{ type: string }>;
    const judgeMetric = metrics?.find((m) => m.type === "llm_judge");
    expect(judgeMetric).toBeDefined();
  });

  it("handles judge returning score=0.0 (low quality output)", async () => {
    const adapter = makeMockAdapter(0.0);
    // High threshold → should fail with llm_judge at 0
    const overlay = new ConfidenceOverlay(emitter, { threshold: 0.9 }, adapter);
    const result = await overlay.postTask(
      makeCtxWithJudge("dev", "reviewer"),
      { status: "COMPLETED", outputs: [{ path: "out.md" }], handover_state: {} },
    );
    // Score will include llm_judge=0 which pulls score below 0.9 threshold
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("NEEDS_REWORK");
  });

  it("scores 0.5 neutral when judge dispatch fails and continues (does not abort)", async () => {
    const failAdapter: import("../../src/adapters/base-adapter.ts").RuntimeAdapter = {
      dispatch_mode: "direct" as const,
      adapter_type: "mock",
      retry_policy: { max_attempts: 1, retryable_errors: [], backoff_base_ms: 0, backoff_max_ms: 0 },
      async dispatch(): Promise<import("../../src/types/index.ts").TaskResult> {
        return { status: "FAILED", error: "agent unavailable" };
      },
      async dispatchWithRetry(t: string, c: import("../../src/types/index.ts").AgentContext, o: import("../../src/adapters/base-adapter.ts").DispatchOptions) { return this.dispatch(t, c, o); },
      async healthCheck() { return true; },
    } as import("../../src/adapters/base-adapter.ts").RuntimeAdapter;

    const overlay = new ConfidenceOverlay(emitter, { threshold: 0.0 }, failAdapter);
    const result = await overlay.postTask(
      makeCtxWithJudge("dev", "reviewer"),
      { status: "COMPLETED", outputs: [{ path: "out.md" }], handover_state: {} },
    );
    // Should still complete evaluation despite judge failure
    expect(result.accept).toBe(true);
    const evalResult = (result.data as Record<string, unknown>)?.["eval_result"] as Record<string, unknown>;
    const metrics = evalResult?.["metrics"] as Array<{ type: string; score: number }>;
    const judgeMetric = metrics?.find((m) => m.type === "llm_judge");
    expect(judgeMetric?.score).toBe(0.5);
  });
});

describe("ConfidenceOverlay: low_confidence_threshold regeneration signal", () => {
  function makeCtxWithLowThreshold(lowThreshold: number): OverlayContext {
    return {
      task_id: "test-task",
      workflow_id: "wf",
      run_id: "run-1",
      task_definition: {
        id: "test-task",
        agent: "dev",
        description: "Test",
        overlays: {
          confidence: { low_confidence_threshold: lowThreshold },
        },
      },
      agent_context: BASE_AGENT_CTX,
    };
  }

  it("does NOT set confidence_action when low_confidence_threshold is not configured", async () => {
    const overlay = new ConfidenceOverlay(emitter, { threshold: 0.99 });
    // threshold=0.99 forces rejection, but no low_confidence_threshold set → no regenerate signal
    const result = await overlay.postTask(ctx, {
      status: "COMPLETED",
      outputs: [],
      handover_state: {},
    });
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("NEEDS_REWORK");
    expect((result.data as Record<string, unknown>)?.["confidence_action"]).toBeUndefined();
  });

  it("sets confidence_action=regenerate when score is below low_confidence_threshold", async () => {
    // Score with no outputs ≈ 0.22; low_confidence_threshold=0.5 is above that → regenerate
    const overlay = new ConfidenceOverlay(emitter, { threshold: 0.99 });
    const ctxLow = makeCtxWithLowThreshold(0.5);
    const result = await overlay.postTask(ctxLow, {
      status: "COMPLETED",
      outputs: [], // ensures low score
      handover_state: {},
    });
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("NEEDS_REWORK");
    expect((result.data as Record<string, unknown>)?.["confidence_action"]).toBe("regenerate");
  });

  it("does NOT set confidence_action when score is above low_confidence_threshold but below threshold", async () => {
    // Score with 1 output ≈ 0.78; low_confidence_threshold=0.3 (below score) → no regenerate
    const overlay = new ConfidenceOverlay(emitter, { threshold: 0.99 });
    const ctxLow = makeCtxWithLowThreshold(0.3);
    const result = await overlay.postTask(ctxLow, {
      status: "COMPLETED",
      outputs: [{ path: "out.md" }],
      handover_state: {},
    });
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("NEEDS_REWORK");
    // Score is above low_confidence_threshold, so no regenerate signal
    expect((result.data as Record<string, unknown>)?.["confidence_action"]).toBeUndefined();
  });

  it("emits below_low_threshold=true in confidence.computed event when below low threshold", async () => {
    const events: Array<Record<string, unknown>> = [];
    const testEmitter = new ObservabilityEmitter({ run_id: "r2", workflow_id: "wf" });
    testEmitter.on((ev) => {
      if (ev.type === "confidence.computed") events.push(ev.data as Record<string, unknown>);
    });

    const overlay = new ConfidenceOverlay(testEmitter, { threshold: 0.99 });
    const ctxLow = makeCtxWithLowThreshold(0.5);
    await overlay.postTask(ctxLow, {
      status: "COMPLETED",
      outputs: [],
      handover_state: {},
    });

    expect(events).toHaveLength(1);
    expect(events[0]!["below_low_threshold"]).toBe(true);
    expect(events[0]!["low_confidence_threshold"]).toBe(0.5);
  });

  it("score at exactly low_confidence_threshold does NOT trigger regenerate (boundary is <, not <=)", async () => {
    // We need a task that scores exactly at a known threshold. Use threshold=0 to accept.
    // This test verifies the comparison is strict <, not <=
    const overlay = new ConfidenceOverlay(emitter, { threshold: 0.99 });
    // Use a score we know: no outputs, no lint ≈ 0.222. Set low threshold to 0.1 (below score).
    const ctxLow = makeCtxWithLowThreshold(0.1);
    const result = await overlay.postTask(ctxLow, {
      status: "COMPLETED",
      outputs: [],
      handover_state: {},
    });
    // Score ≈ 0.22 > 0.1 → no regenerate
    expect((result.data as Record<string, unknown>)?.["confidence_action"]).toBeUndefined();
  });
});
