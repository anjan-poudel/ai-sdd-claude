/**
 * PairedOverlay — driver/challenger loop tests.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PairedOverlay } from "../../src/overlays/paired/paired-overlay.ts";
import type { OverlayContext } from "../../src/overlays/base-overlay.ts";
import type { TaskResult } from "../../src/types/index.ts";
import type { RuntimeAdapter, DispatchOptions } from "../../src/adapters/base-adapter.ts";
import type { AgentContext } from "../../src/types/index.ts";
import { ObservabilityEmitter } from "../../src/observability/emitter.ts";

const emitter = new ObservabilityEmitter({ run_id: "r1", workflow_id: "wf" });

function makeResult(overrides?: Partial<TaskResult>): TaskResult {
  return {
    status: "COMPLETED",
    outputs: [{ path: ".ai-sdd/outputs/out.md" }],
    handover_state: {},
    ...overrides,
  };
}

const BASE_AGENT_CTX: AgentContext = {
  constitution: "# Test",
  handover_state: {},
  task_definition: { id: "test-task", agent: "dev", description: "Test" },
  dispatch_mode: "direct" as const,
};

function makeContext(pairedConfig?: {
  enabled?: boolean;
  challenger_agent?: string;
  driver_agent?: string;
  max_iterations?: number;
  role_switch?: "session" | "subtask" | "checkpoint";
}): OverlayContext {
  return {
    task_id: "test-task",
    workflow_id: "wf",
    run_id: "run-1",
    task_definition: {
      id: "test-task",
      agent: "dev",
      description: "Test task",
      ...(pairedConfig !== undefined && { overlays: { paired: pairedConfig } }),
    },
    agent_context: { ...BASE_AGENT_CTX, project_path: "/tmp" },
  };
}

/** Build a mock adapter that returns a configurable challenger decision. */
function makeMockAdapter(
  decisions: Array<{ approved: boolean; feedback?: string }>,
): RuntimeAdapter {
  let callIndex = 0;
  return {
    dispatch_mode: "direct" as const,
    adapter_type: "mock",
    retry_policy: { max_attempts: 1, retryable_errors: [], backoff_base_ms: 0, backoff_max_ms: 0 },
    async dispatch(_taskId: string, _ctx: AgentContext, _opts: DispatchOptions): Promise<TaskResult> {
      const d = decisions[callIndex % decisions.length]!;
      callIndex++;
      return {
        status: "COMPLETED",
        handover_state: { approved: d.approved, feedback: d.feedback ?? "" },
      };
    },
    async dispatchWithRetry(task_id: string, ctx: AgentContext, opts: DispatchOptions): Promise<TaskResult> {
      return this.dispatch(task_id, ctx, opts);
    },
    async healthCheck(): Promise<boolean> { return true; },
  } as unknown as RuntimeAdapter;
}

describe("PairedOverlay: disabled (default)", () => {
  it("passes through when task has no paired config", async () => {
    const overlay = new PairedOverlay(emitter, { enabled: false });
    const result = await overlay.postTask(makeContext(), makeResult());
    expect(result.accept).toBe(true);
  });

  it("passes through when task explicitly disables paired", async () => {
    const overlay = new PairedOverlay(emitter, { enabled: false });
    const result = await overlay.postTask(makeContext({ enabled: false }), makeResult());
    expect(result.accept).toBe(true);
  });
});

describe("PairedOverlay: no adapter injected", () => {
  it("returns FAILED with clear error message when adapter is missing", async () => {
    const overlay = new PairedOverlay(emitter, { enabled: true });
    const ctx = makeContext({ enabled: true, challenger_agent: "reviewer" });
    const result = await overlay.postTask(ctx, makeResult());
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("FAILED");
    expect(result.feedback).toContain("RuntimeAdapter");
  });
});

describe("PairedOverlay: challenger approves on first round", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "paired-test-"));
  });

  it("returns COMPLETED when challenger immediately approves", async () => {
    const adapter = makeMockAdapter([{ approved: true }]);
    const overlay = new PairedOverlay(emitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, challenger_agent: "reviewer", driver_agent: "dev", max_iterations: 3 });
    const result = await overlay.postTask(ctx, makeResult());
    expect(result.accept).toBe(true);
    expect(result.new_status).toBe("COMPLETED");
    expect(result.data?.["challenger_approved"]).toBe(true);
    expect(result.data?.["paired_iterations"]).toBe(1);
  });
});

describe("PairedOverlay: challenger rejects then approves", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "paired-test-"));
  });

  it("returns NEEDS_REWORK on first rejection with feedback", async () => {
    const adapter = makeMockAdapter([
      { approved: false, feedback: "Missing sections" },
    ]);
    const overlay = new PairedOverlay(emitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, challenger_agent: "reviewer", max_iterations: 3 });
    const result = await overlay.postTask(ctx, makeResult());
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("NEEDS_REWORK");
    expect(result.feedback).toContain("Missing sections");
    expect(result.feedback).toContain("reviewer");
    expect(result.data?.["paired_iterations"]).toBe(1);
  });
});

describe("PairedOverlay: max_iterations reached", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "paired-test-"));
  });

  it("returns NEEDS_REWORK with hil_suggested when max_iterations reached", async () => {
    const adapter = makeMockAdapter([{ approved: false, feedback: "Still insufficient" }]);
    const overlay = new PairedOverlay(emitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, challenger_agent: "reviewer", max_iterations: 1 });
    const result = await overlay.postTask(ctx, makeResult());
    // With max_iterations=1 and rejection on iteration 1 → max reached
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("NEEDS_REWORK");
    expect(result.feedback).toContain("max_iterations (1)");
    expect(result.data?.["hil_suggested"]).toBe(true);
  });
});

describe("PairedOverlay: role_switch=subtask", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "paired-test-"));
  });

  it("accepts without error when role_switch is subtask and approved", async () => {
    const adapter = makeMockAdapter([{ approved: true }]);
    const overlay = new PairedOverlay(emitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, challenger_agent: "reviewer", driver_agent: "dev", role_switch: "subtask", max_iterations: 3 });
    const result = await overlay.postTask(ctx, makeResult());
    expect(result.accept).toBe(true);
    expect(result.new_status).toBe("COMPLETED");
  });
});

describe("PairedOverlay: emits events", () => {
  let tmpDir: string;
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "paired-test-"));
    events.length = 0;
  });

  it("emits challenger_dispatched and challenger_decision events", async () => {
    const trackingEmitter = new ObservabilityEmitter({ run_id: "r1", workflow_id: "wf" });
    trackingEmitter.on((event) => { events.push({ type: event.type, data: event.data }); });

    const adapter = makeMockAdapter([{ approved: true }]);
    const overlay = new PairedOverlay(trackingEmitter, { enabled: true }, adapter, tmpDir);
    const ctx = makeContext({ enabled: true, challenger_agent: "reviewer", max_iterations: 3 });
    await overlay.postTask(ctx, makeResult());

    const dispatched = events.find((e) => e.type === "paired.challenger_dispatched");
    const decision = events.find((e) => e.type === "paired.challenger_decision");
    expect(dispatched).toBeDefined();
    expect(dispatched?.data["challenger_agent"]).toBe("reviewer");
    expect(decision).toBeDefined();
    expect(decision?.data["approved"]).toBe(true);
  });
});
