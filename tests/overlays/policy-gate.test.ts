/**
 * T-gap10: PolicyGateOverlay — T0/T1/T2 evidence enforcement.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { PolicyGateOverlay } from "../../src/overlays/policy-gate/gate-overlay.ts";
import type { OverlayContext } from "../../src/overlays/base-overlay.ts";
import type { TaskResult } from "../../src/types/index.ts";
import { ObservabilityEmitter } from "../../src/observability/emitter.ts";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BASE_AGENT_CTX = {
  constitution: "# Test",
  handover_state: {},
  task_definition: { id: "test-task", agent: "dev", description: "Test" },
  dispatch_mode: "direct" as const,
};

function makeContext(riskTier: "T0" | "T1" | "T2"): OverlayContext {
  return {
    task_id: "test-task",
    workflow_id: "wf",
    run_id: "run-1",
    task_definition: {
      id: "test-task",
      agent: "dev",
      description: "Test",
      overlays: { policy_gate: { risk_tier: riskTier } },
    },
    agent_context: BASE_AGENT_CTX,
  };
}

function makeResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    status: "COMPLETED",
    outputs: [{ path: ".ai-sdd/outputs/out.md" }],
    handover_state: {},
    ...overrides,
  };
}

describe("PolicyGateOverlay: T0", () => {
  let outputsDir: string;
  let overlay: PolicyGateOverlay;

  beforeEach(() => {
    outputsDir = mkdtempSync(join(tmpdir(), "gate-test-"));
    overlay = new PolicyGateOverlay(outputsDir, new ObservabilityEmitter({ run_id: "r1", workflow_id: "wf" }));
  });

  it("PASS when outputs present", async () => {
    const result = await overlay.postTask(makeContext("T0"), makeResult());
    expect(result.accept).toBe(true);
  });

  it("FAIL when no outputs produced", async () => {
    const result = await overlay.postTask(makeContext("T0"), makeResult({ outputs: [] }));
    expect(result.accept).toBe(false);
    expect(result.feedback).toContain("No outputs produced");
  });
});

describe("PolicyGateOverlay: T1 evidence enforcement", () => {
  let outputsDir: string;
  let overlay: PolicyGateOverlay;

  beforeEach(() => {
    outputsDir = mkdtempSync(join(tmpdir(), "gate-test-"));
    overlay = new PolicyGateOverlay(outputsDir, new ObservabilityEmitter({ run_id: "r1", workflow_id: "wf" }));
  });

  it("FAIL when T1 task has no verification evidence", async () => {
    const result = await overlay.postTask(
      makeContext("T1"),
      makeResult({ handover_state: {} }),
    );
    expect(result.accept).toBe(false);
    expect(result.feedback).toContain("T1");
  });

  it("PASS when T1 task has tests_passed=true", async () => {
    const result = await overlay.postTask(
      makeContext("T1"),
      makeResult({ handover_state: { tests_passed: true } }),
    );
    expect(result.accept).toBe(true);
  });

  it("PASS when T1 task has lint_passed=true", async () => {
    const result = await overlay.postTask(
      makeContext("T1"),
      makeResult({ handover_state: { lint_passed: true } }),
    );
    expect(result.accept).toBe(true);
  });
});

describe("PolicyGateOverlay: T2 evidence enforcement", () => {
  let outputsDir: string;
  let overlay: PolicyGateOverlay;

  beforeEach(() => {
    outputsDir = mkdtempSync(join(tmpdir(), "gate-test-"));
    overlay = new PolicyGateOverlay(outputsDir, new ObservabilityEmitter({ run_id: "r1", workflow_id: "wf" }));
  });

  it("FAIL when T2 task missing security_clean evidence", async () => {
    const result = await overlay.postTask(
      makeContext("T2"),
      makeResult({ handover_state: { tests_passed: true } }), // has T1 evidence but not T2
    );
    expect(result.accept).toBe(false);
    expect(result.feedback).toContain("security_clean");
  });

  it("PASS when T2 task has all required evidence", async () => {
    const result = await overlay.postTask(
      makeContext("T2"),
      makeResult({ handover_state: { tests_passed: true, security_clean: true } }),
    );
    expect(result.accept).toBe(true);
  });

  it("FAIL when T2 task has security but no verification", async () => {
    const result = await overlay.postTask(
      makeContext("T2"),
      makeResult({ handover_state: { security_clean: true } }),
    );
    expect(result.accept).toBe(false);
    expect(result.feedback).toContain("T2");
  });
});
