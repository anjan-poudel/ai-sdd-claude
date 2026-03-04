/**
 * T-gap11: PairedOverlay — explicit fail when enabled (not silent pass-through).
 */

import { describe, it, expect } from "bun:test";
import { PairedOverlay } from "../../src/overlays/paired/paired-overlay.ts";
import type { OverlayContext } from "../../src/overlays/base-overlay.ts";
import type { TaskResult } from "../../src/types/index.ts";
import { ObservabilityEmitter } from "../../src/observability/emitter.ts";

const emitter = new ObservabilityEmitter({ run_id: "r1", workflow_id: "wf" });

function makeResult(): TaskResult {
  return {
    status: "COMPLETED",
    outputs: [{ path: ".ai-sdd/outputs/out.md" }],
    handover_state: {},
  };
}

const BASE_AGENT_CTX = {
  constitution: "# Test",
  handover_state: {},
  task_definition: { id: "test-task", agent: "dev", description: "Test" },
  dispatch_mode: "direct" as const,
};

function makeContext(pairedEnabled?: boolean): OverlayContext {
  return {
    task_id: "test-task",
    workflow_id: "wf",
    run_id: "run-1",
    task_definition: {
      id: "test-task",
      agent: "dev",
      description: "Test",
      ...(pairedEnabled !== undefined && {
        overlays: { paired: { enabled: pairedEnabled } },
      }),
    },
    agent_context: BASE_AGENT_CTX,
  };
}

describe("PairedOverlay: disabled (default)", () => {
  it("passes through when task has no paired config", async () => {
    const overlay = new PairedOverlay(emitter, { enabled: false });
    const result = await overlay.postTask(makeContext(), makeResult());
    expect(result.accept).toBe(true);
  });

  it("passes through when task explicitly disables paired", async () => {
    const overlay = new PairedOverlay(emitter, { enabled: false });
    const result = await overlay.postTask(makeContext(false), makeResult());
    expect(result.accept).toBe(true);
  });
});

describe("PairedOverlay: enabled on task", () => {
  it("returns NEEDS_REWORK with clear message when task enables paired", async () => {
    const overlay = new PairedOverlay(emitter, { enabled: true });
    const result = await overlay.postTask(makeContext(true), makeResult());
    expect(result.accept).toBe(false);
    expect(result.new_status).toBe("NEEDS_REWORK");
    expect(result.feedback).toContain("not yet implemented");
  });
});
