/**
 * T009: ReviewOverlay — agentic review loop with GO/NO_GO decisions.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ReviewOverlay } from "../../src/overlays/review/review-overlay.ts";
import { ReviewLogWriter } from "../../src/overlays/review/review-log.ts";
import type { OverlayContext } from "../../src/overlays/base-overlay.ts";
import type { TaskResult, AgentContext } from "../../src/types/index.ts";
import type { RuntimeAdapter, DispatchOptions } from "../../src/adapters/base-adapter.ts";
import { ObservabilityEmitter } from "../../src/observability/emitter.ts";

const emitter = new ObservabilityEmitter({ run_id: "r1", workflow_id: "wf" });

const BASE_AGENT_CTX: AgentContext = {
  constitution: "# Standards\nAll code must be documented.",
  handover_state: {},
  task_definition: { id: "impl", agent: "dev", description: "Implement feature" },
  dispatch_mode: "direct" as const,
};

function makeResult(overrides?: Partial<TaskResult>): TaskResult {
  return {
    status: "COMPLETED",
    outputs: [{ path: ".ai-sdd/outputs/impl.md" }],
    handover_state: {},
    ...overrides,
  };
}

function makeContext(reviewConfig?: {
  enabled?: boolean;
  reviewer_agent?: string;
  coder_agent?: string;
  max_iterations?: number;
}, projectPath = "/tmp"): OverlayContext {
  return {
    task_id: "impl",
    workflow_id: "wf",
    run_id: "run-1",
    task_definition: {
      id: "impl",
      agent: "dev",
      description: "Implement the feature",
      ...(reviewConfig !== undefined && { overlays: { review: reviewConfig } }),
    },
    agent_context: { ...BASE_AGENT_CTX, project_path: projectPath },
  };
}

function makeReviewerAdapter(decisions: Array<{ decision: "GO" | "NO_GO"; feedback?: string }>): RuntimeAdapter {
  let callIndex = 0;
  return {
    dispatch_mode: "direct" as const,
    adapter_type: "mock",
    retry_policy: { max_attempts: 1, retryable_errors: [], backoff_base_ms: 0, backoff_max_ms: 0 },
    async dispatch(_taskId: string, _ctx: AgentContext, _opts: DispatchOptions): Promise<TaskResult> {
      const d = decisions[Math.min(callIndex, decisions.length - 1)]!;
      callIndex++;
      return {
        status: "COMPLETED",
        handover_state: { decision: d.decision, feedback: d.feedback ?? "" },
      };
    },
    async dispatchWithRetry(task_id: string, ctx: AgentContext, opts: DispatchOptions): Promise<TaskResult> {
      return this.dispatch(task_id, ctx, opts);
    },
    async healthCheck(): Promise<boolean> { return true; },
  } as unknown as RuntimeAdapter;
}

describe("ReviewOverlay: disabled (default)", () => {
  it("passes through when review not configured", async () => {
    const overlay = new ReviewOverlay(emitter, { enabled: false });
    const result = await overlay.postTask(makeContext(), makeResult());
    expect(result.accept).toBe(true);
    expect(result.new_status).toBe("COMPLETED");
  });

  it("passes through when task explicitly disables review", async () => {
    const overlay = new ReviewOverlay(emitter, { enabled: false });
    const result = await overlay.postTask(makeContext({ enabled: false }), makeResult());
    expect(result.accept).toBe(true);
  });
});

describe("ReviewOverlay: no adapter injected", () => {
  it("returns FAILED with clear error when adapter is missing", async () => {
    const overlay = new ReviewOverlay(emitter, { enabled: true });
    const result = await overlay.postTask(makeContext({ enabled: true, reviewer_agent: "reviewer" }), makeResult());
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("FAILED");
    expect(result.feedback).toContain("RuntimeAdapter");
  });
});

describe("ReviewOverlay: GO path (reviewer approves)", () => {
  let tmpDir: string;
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "review-test-"));
    events.length = 0;
  });

  it("returns COMPLETED and writes GO to review log", async () => {
    const adapter = makeReviewerAdapter([{ decision: "GO", feedback: "All criteria met." }]);
    const overlay = new ReviewOverlay(emitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, reviewer_agent: "reviewer", coder_agent: "dev", max_iterations: 3 }, tmpDir);
    const result = await overlay.postTask(ctx, makeResult());
    expect(result.accept).toBe(true);
    expect(result.new_status).toBe("COMPLETED");
    expect(result.data?.["review_decision"]).toBe("GO");
    expect(result.data?.["review_iteration"]).toBe(1);

    // Verify log file written
    const logWriter = new ReviewLogWriter(tmpDir, "impl");
    const log = logWriter.read();
    expect(log.iterations).toHaveLength(1);
    expect(log.iterations[0]!.decision).toBe("GO");
    expect(log.final_decision).toBe("GO");
  });

  it("emits review.decision event with GO", async () => {
    const trackEmitter = new ObservabilityEmitter({ run_id: "r1", workflow_id: "wf" });
    trackEmitter.on((e) => { events.push({ type: e.type, data: e.data }); });

    const adapter = makeReviewerAdapter([{ decision: "GO" }]);
    const overlay = new ReviewOverlay(trackEmitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, reviewer_agent: "reviewer" }, tmpDir);
    await overlay.postTask(ctx, makeResult());

    const decision = events.find((e) => e.type === "review.decision");
    expect(decision).toBeDefined();
    expect(decision?.data["decision"]).toBe("GO");
    expect(decision?.data["reviewer_agent"]).toBe("reviewer");
  });
});

describe("ReviewOverlay: NO_GO path (reviewer rejects)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "review-test-"));
  });

  it("returns NEEDS_REWORK with reviewer feedback on NO_GO", async () => {
    const adapter = makeReviewerAdapter([{ decision: "NO_GO", feedback: "Missing error handling on auth flow" }]);
    const overlay = new ReviewOverlay(emitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, reviewer_agent: "reviewer", max_iterations: 3 }, tmpDir);
    const result = await overlay.postTask(ctx, makeResult());
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("NEEDS_REWORK");
    expect(result.feedback).toContain("Missing error handling");
    expect(result.data?.["review_decision"]).toBe("NO_GO");
  });

  it("appends NO_GO to review log without finalizing", async () => {
    const adapter = makeReviewerAdapter([{ decision: "NO_GO", feedback: "needs improvement" }]);
    const overlay = new ReviewOverlay(emitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, reviewer_agent: "reviewer", max_iterations: 3 }, tmpDir);
    await overlay.postTask(ctx, makeResult());

    const logWriter = new ReviewLogWriter(tmpDir, "impl");
    const log = logWriter.read();
    expect(log.iterations).toHaveLength(1);
    expect(log.iterations[0]!.decision).toBe("NO_GO");
    // Not yet finalized
    expect(log.final_decision).toBeUndefined();
  });
});

describe("ReviewOverlay: max_iterations reached → HIL escalation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "review-test-"));
  });

  it("returns NEEDS_REWORK with hil_suggested on max_iterations", async () => {
    const adapter = makeReviewerAdapter([{ decision: "NO_GO", feedback: "Insufficient" }]);
    const overlay = new ReviewOverlay(emitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, reviewer_agent: "reviewer", max_iterations: 1 }, tmpDir);
    const result = await overlay.postTask(ctx, makeResult());
    expect(result.accept).toBe(false);
    expect(result.feedback).toContain("max_iterations (1)");
    expect(result.feedback).toContain("Human review (HIL)");
    expect(result.data?.["hil_suggested"]).toBe(true);
    expect((result.data?.["review_log"] as { task_id: string })?.task_id).toBe("impl");
  });

  it("finalizes review log as NO_GO on max_iterations", async () => {
    const adapter = makeReviewerAdapter([{ decision: "NO_GO" }]);
    const overlay = new ReviewOverlay(emitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, reviewer_agent: "reviewer", max_iterations: 1 }, tmpDir);
    await overlay.postTask(ctx, makeResult());

    const logWriter = new ReviewLogWriter(tmpDir, "impl");
    const log = logWriter.read();
    expect(log.final_decision).toBe("NO_GO");
    expect(log.completed_at).toBeDefined();
  });
});

describe("ReviewOverlay: reviewer prompt includes constitution", () => {
  let tmpDir: string;
  let capturedPrompt = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "review-test-"));
    capturedPrompt = "";
  });

  it("reviewer receives constitution quality guidelines in prompt", async () => {
    const captureAdapter: RuntimeAdapter = {
      dispatch_mode: "direct" as const,
      adapter_type: "mock",
      retry_policy: { max_attempts: 1, retryable_errors: [], backoff_base_ms: 0, backoff_max_ms: 0 },
      async dispatch(_taskId: string, ctx: AgentContext): Promise<TaskResult> {
        capturedPrompt = ctx.constitution;
        return { status: "COMPLETED", handover_state: { decision: "GO", feedback: "" } };
      },
      async dispatchWithRetry(t: string, c: AgentContext, o: DispatchOptions) { return this.dispatch(t, c, o); },
      async healthCheck() { return true; },
    } as unknown as RuntimeAdapter;

    const overlay = new ReviewOverlay(emitter, { enabled: true }, captureAdapter, tmpDir);
    const ctx = makeContext({ enabled: true, reviewer_agent: "reviewer" }, tmpDir);
    await overlay.postTask(ctx, makeResult());

    // Constitution content should appear in reviewer prompt
    expect(capturedPrompt).toContain("# Standards");
    expect(capturedPrompt).toContain("QUALITY GUIDELINES");
  });
});

describe("ReviewLog: append-only behavior", () => {
  it("persists multiple iterations correctly", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "review-log-test-"));
    const logWriter = new ReviewLogWriter(tmpDir, "task1");

    logWriter.append({
      task_id: "task1",
      reviewer_agent: "reviewer",
      coder_agent: "dev",
      iteration: 1,
      decision: "NO_GO",
      feedback: "needs work",
      timestamp: new Date().toISOString(),
    });

    logWriter.append({
      task_id: "task1",
      reviewer_agent: "reviewer",
      coder_agent: "dev",
      iteration: 2,
      decision: "GO",
      feedback: "looks good",
      timestamp: new Date().toISOString(),
    });

    logWriter.finalize("GO");

    const log = logWriter.read();
    expect(log.iterations).toHaveLength(2);
    expect(log.iterations[0]!.decision).toBe("NO_GO");
    expect(log.iterations[1]!.decision).toBe("GO");
    expect(log.final_decision).toBe("GO");
    expect(log.completed_at).toBeDefined();
  });
});

describe("WorkflowLoader: validateOverlayConstraints for review overlay", () => {
  it("rejects review overlay when reviewer equals coder", async () => {
    const { WorkflowLoader } = await import("../../src/core/workflow-loader.ts");
    expect(() =>
      WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  impl:
    agent: dev-agent
    description: Implement
    overlays:
      review:
        enabled: true
        reviewer_agent: dev-agent
`),
    ).toThrow(/Reviewer independence required/);
  });

  it("accepts review overlay when reviewer differs from coder", async () => {
    const { WorkflowLoader } = await import("../../src/core/workflow-loader.ts");
    expect(() =>
      WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  impl:
    agent: dev-agent
    description: Implement
    overlays:
      review:
        enabled: true
        reviewer_agent: reviewer-agent
`),
    ).not.toThrow();
  });
});
