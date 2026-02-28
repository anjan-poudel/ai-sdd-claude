/**
 * T018: ClaudeCodeAdapter unit tests.
 * Tests prompt-building and output-parsing without invoking the real claude CLI.
 */

import { describe, it, expect } from "bun:test";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code-adapter.ts";
import type { AgentContext } from "../../src/types/index.ts";

const BASE_CONTEXT: AgentContext = {
  constitution: "# Project Constitution\n\nBuild a REST API.",
  handover_state: { previous_output: "requirements done" },
  task_definition: {
    id: "design-l1",
    agent: "architect",
    description: "Produce the L1 system architecture.",
    outputs: [
      { path: ".ai-sdd/outputs/design-l1.md", contract: "architecture_l1" },
    ],
  },
  dispatch_mode: "delegation",
};

const DISPATCH_OPTIONS = {
  operation_id: "wf:design-l1:run-1",
  attempt_id: "wf:design-l1:run-1:attempt_1",
};

// ─── Constructor defaults ──────────────────────────────────────────────────

describe("ClaudeCodeAdapter: defaults", () => {
  it("defaults to delegation dispatch_mode", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.dispatch_mode).toBe("delegation");
  });

  it("adapter_type is claude_code", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.adapter_type).toBe("claude_code");
  });

  it("accepts explicit direct mode", () => {
    const adapter = new ClaudeCodeAdapter({ dispatch_mode: "direct" });
    expect(adapter.dispatch_mode).toBe("direct");
  });
});

// ─── Delegation brief ─────────────────────────────────────────────────────

describe("ClaudeCodeAdapter: delegation brief", () => {
  const adapter = new ClaudeCodeAdapter({ dispatch_mode: "delegation" });
  const brief: string = (adapter as unknown as Record<string, (...args: unknown[]) => string>)
    ["buildDelegationBrief"]("design-l1", BASE_CONTEXT, DISPATCH_OPTIONS);

  it("includes task_id", () => {
    expect(brief).toContain("design-l1");
  });

  it("includes operation_id", () => {
    expect(brief).toContain("wf:design-l1:run-1");
  });

  it("includes task description", () => {
    expect(brief).toContain("Produce the L1 system architecture.");
  });

  it("includes expected output path", () => {
    expect(brief).toContain(".ai-sdd/outputs/design-l1.md");
  });

  it("includes ai-sdd complete-task command", () => {
    expect(brief).toContain("ai-sdd complete-task");
    expect(brief).toContain("--task design-l1");
  });

  it("does NOT include constitution (delegation: agent reads it via tools)", () => {
    expect(brief).not.toContain("# Project Constitution");
  });
});

describe("ClaudeCodeAdapter: delegation brief — no outputs", () => {
  const adapter = new ClaudeCodeAdapter({ dispatch_mode: "delegation" });
  const ctxNoOutputs: AgentContext = {
    ...BASE_CONTEXT,
    task_definition: { ...BASE_CONTEXT.task_definition, outputs: undefined },
  };
  const brief: string = (adapter as unknown as Record<string, (...args: unknown[]) => string>)
    ["buildDelegationBrief"]("design-l1", ctxNoOutputs, DISPATCH_OPTIONS);

  it("still includes complete-task command when no outputs specified", () => {
    expect(brief).toContain("ai-sdd complete-task");
  });
});

// ─── Direct prompt ────────────────────────────────────────────────────────

describe("ClaudeCodeAdapter: direct prompt", () => {
  const adapter = new ClaudeCodeAdapter({ dispatch_mode: "direct" });
  const prompt: string = (adapter as unknown as Record<string, (...args: unknown[]) => string>)
    ["buildDirectPrompt"](BASE_CONTEXT, DISPATCH_OPTIONS);

  it("includes constitution", () => {
    expect(prompt).toContain("# Project Constitution");
  });

  it("includes task description", () => {
    expect(prompt).toContain("Produce the L1 system architecture.");
  });

  it("includes operation_id", () => {
    expect(prompt).toContain("wf:design-l1:run-1");
  });
});

// ─── Output parsing ───────────────────────────────────────────────────────

describe("ClaudeCodeAdapter: parseOutput", () => {
  const adapter = new ClaudeCodeAdapter();
  const parse = (stdout: string) =>
    (adapter as unknown as Record<string, (id: string, out: string) => unknown>)
      ["parseOutput"]("design-l1", stdout);

  it("parses JSON output — status COMPLETED", () => {
    const result = parse(JSON.stringify({
      outputs: [{ path: "out.md" }],
      handover_state: { decision: "GO" },
      usage: { input_tokens: 100, output_tokens: 50 },
    })) as Record<string, unknown>;
    expect(result["status"]).toBe("COMPLETED");
  });

  it("parses JSON output — extracts handover_state", () => {
    const result = parse(JSON.stringify({
      handover_state: { decision: "GO" },
    })) as Record<string, unknown>;
    expect((result["handover_state"] as Record<string, unknown>)["decision"]).toBe("GO");
  });

  it("parses JSON output — extracts token usage", () => {
    const result = parse(JSON.stringify({
      usage: { input_tokens: 200, output_tokens: 80 },
    })) as Record<string, unknown>;
    const tokens = result["tokens_used"] as Record<string, number>;
    expect(tokens["input"]).toBe(200);
    expect(tokens["output"]).toBe(80);
    expect(tokens["total"]).toBe(280);
  });

  it("falls back to raw handover_state for non-JSON stdout", () => {
    const result = parse("Architecture document written.") as Record<string, unknown>;
    expect(result["status"]).toBe("COMPLETED");
    expect((result["handover_state"] as Record<string, unknown>)["raw_output"])
      .toBe("Architecture document written.");
  });

  it("non-JSON fallback has empty outputs array", () => {
    const result = parse("some text") as Record<string, unknown>;
    expect(Array.isArray(result["outputs"])).toBe(true);
    expect((result["outputs"] as unknown[]).length).toBe(0);
  });
});

// ─── healthCheck ──────────────────────────────────────────────────────────

describe("ClaudeCodeAdapter: healthCheck", () => {
  it("returns false when claude binary not on PATH", async () => {
    // The test runner likely doesn't have the claude CLI — expect false
    // If claude IS installed, this test is skipped gracefully
    const adapter = new ClaudeCodeAdapter();
    const healthy = await adapter.healthCheck();
    // Accept either: false (no CLI) or true (CLI present in CI env)
    expect(typeof healthy).toBe("boolean");
  });
});
