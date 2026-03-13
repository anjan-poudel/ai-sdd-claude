/**
 * T002: LocalOverlayProvider tests — mapping + equivalence.
 * CLAUDE.md §1: Config-to-behavior pattern — each test changes input and asserts different output.
 */

import { describe, it, expect } from "bun:test";
import { LocalOverlayProvider } from "../../src/overlays/local-overlay-provider.ts";
import type { BaseOverlay, OverlayContext as LegacyContext, OverlayResult, PostTaskOverlayResult } from "../../src/overlays/base-overlay.ts";
import type { OverlayContext } from "../../src/types/overlay-protocol.ts";
import type { TaskResult, TaskDefinition, AgentContext } from "../../src/types/index.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeOverlayContext(): OverlayContext {
  const taskDef: TaskDefinition = {
    id: "test-task",
    agent: "developer",
    description: "Test task",
  };
  const agentCtx: AgentContext = {
    constitution: "test constitution",
    handover_state: {},
    task_definition: taskDef,
    dispatch_mode: "direct",
  };
  return {
    task_id: "test-task",
    workflow_id: "test-workflow",
    run_id: "run-001",
    task_definition: taskDef,
    agent_context: agentCtx,
  };
}

function makeTaskResult(): TaskResult {
  return {
    status: "COMPLETED",
    outputs: [],
    handover_state: {},
  };
}

/**
 * Create a mock BaseOverlay with configurable pre/post behavior.
 */
function makeMockOverlay(opts: {
  name?: string;
  enabled?: boolean;
  preResult?: OverlayResult;
  postResult?: PostTaskOverlayResult;
  hasPre?: boolean;
  hasPost?: boolean;
}): BaseOverlay {
  const name = opts.name ?? "mock-overlay";
  const enabled = opts.enabled ?? true;
  const hasPre = opts.hasPre ?? (opts.preResult !== undefined);
  const hasPost = opts.hasPost ?? (opts.postResult !== undefined);

  const overlay: BaseOverlay = { name, enabled };

  if (hasPre && opts.preResult !== undefined) {
    overlay.preTask = async (_ctx: LegacyContext): Promise<OverlayResult> => {
      return opts.preResult!;
    };
  }
  if (hasPost && opts.postResult !== undefined) {
    overlay.postTask = async (_ctx: LegacyContext, _result: TaskResult): Promise<PostTaskOverlayResult> => {
      return opts.postResult!;
    };
  }

  return overlay;
}

// ─── Pre-task mapping tests ────────────────────────────────────────────────────

describe("LocalOverlayProvider: pre-task mapping", () => {
  it("1. proceed: true → verdict PASS", async () => {
    const overlay = makeMockOverlay({ preResult: { proceed: true } });
    const provider = new LocalOverlayProvider(overlay);
    const ctx = makeOverlayContext();
    const decision = await provider.invokePre!(ctx);
    expect(decision.verdict).toBe("PASS");
  });

  it("2. proceed: false (no hil_trigger) → verdict REWORK with feedback forwarded", async () => {
    const overlay = makeMockOverlay({
      preResult: { proceed: false, feedback: "Fix the code style." },
    });
    const provider = new LocalOverlayProvider(overlay);
    const ctx = makeOverlayContext();
    const decision = await provider.invokePre!(ctx);
    expect(decision.verdict).toBe("REWORK");
    expect(decision.feedback).toBe("Fix the code style.");
  });

  it("3. proceed: false, hil_trigger: true → verdict HIL; evidence.data.hil_id matches", async () => {
    const overlay = makeMockOverlay({
      preResult: {
        proceed: false,
        hil_trigger: true,
        feedback: "Needs human review.",
        data: { hil_id: "hil-42" },
      },
    });
    const provider = new LocalOverlayProvider(overlay);
    const ctx = makeOverlayContext();
    const decision = await provider.invokePre!(ctx);
    expect(decision.verdict).toBe("HIL");
    expect(decision.feedback).toBe("Needs human review.");
    expect(decision.evidence?.data?.["hil_id"]).toBe("hil-42");
  });

  it("proceed: true — updated_context is forwarded if present", async () => {
    const overlay = makeMockOverlay({
      preResult: {
        proceed: true,
        updated_context: { handover_state: { extra: "data" } },
      },
    });
    const provider = new LocalOverlayProvider(overlay);
    const ctx = makeOverlayContext();
    const decision = await provider.invokePre!(ctx);
    expect(decision.verdict).toBe("PASS");
    expect(decision.updated_context?.handover_state?.["extra"]).toBe("data");
  });
});

// ─── Post-task mapping tests ───────────────────────────────────────────────────

describe("LocalOverlayProvider: post-task mapping", () => {
  it("4. accept: true → verdict PASS", async () => {
    const overlay = makeMockOverlay({ postResult: { accept: true } });
    const provider = new LocalOverlayProvider(overlay);
    const ctx = makeOverlayContext();
    const decision = await provider.invokePost!(ctx, makeTaskResult());
    expect(decision.verdict).toBe("PASS");
  });

  it("5. accept: false, new_status: NEEDS_REWORK → verdict REWORK", async () => {
    const overlay = makeMockOverlay({
      postResult: { accept: false, new_status: "NEEDS_REWORK", feedback: "Rework needed." },
    });
    const provider = new LocalOverlayProvider(overlay);
    const ctx = makeOverlayContext();
    const decision = await provider.invokePost!(ctx, makeTaskResult());
    expect(decision.verdict).toBe("REWORK");
    expect(decision.feedback).toBe("Rework needed.");
  });

  it("6. accept: false, new_status: undefined → verdict REWORK", async () => {
    const overlay = makeMockOverlay({
      postResult: { accept: false },
    });
    const provider = new LocalOverlayProvider(overlay);
    const ctx = makeOverlayContext();
    const decision = await provider.invokePost!(ctx, makeTaskResult());
    expect(decision.verdict).toBe("REWORK");
  });

  it("7. accept: false, new_status: FAILED → verdict FAIL", async () => {
    const overlay = makeMockOverlay({
      postResult: { accept: false, new_status: "FAILED", feedback: "Critical failure." },
    });
    const provider = new LocalOverlayProvider(overlay);
    const ctx = makeOverlayContext();
    const decision = await provider.invokePost!(ctx, makeTaskResult());
    expect(decision.verdict).toBe("FAIL");
    expect(decision.feedback).toBe("Critical failure.");
  });

  it("7b. accept: false with data.hil_suggested=true → verdict HIL", async () => {
    const overlay = makeMockOverlay({
      postResult: {
        accept: false,
        new_status: "NEEDS_REWORK",
        feedback: "Human review required.",
        data: { hil_suggested: true },
      },
    });
    const provider = new LocalOverlayProvider(overlay);
    const ctx = makeOverlayContext();
    const decision = await provider.invokePost!(ctx, makeTaskResult());
    expect(decision.verdict).toBe("HIL");
    expect(decision.feedback).toBe("Human review required.");
    expect(decision.evidence?.data?.["hil_suggested"]).toBe(true);
  });

  it("8. accept: false, new_status: COMPLETED → throws TypeError naming overlay", async () => {
    const overlay = makeMockOverlay({
      name: "bad-overlay",
      postResult: { accept: false, new_status: "COMPLETED" },
    });
    const provider = new LocalOverlayProvider(overlay);
    const ctx = makeOverlayContext();
    await expect(provider.invokePost!(ctx, makeTaskResult())).rejects.toThrow(TypeError);
    await expect(provider.invokePost!(ctx, makeTaskResult())).rejects.toThrow("bad-overlay");
    await expect(provider.invokePost!(ctx, makeTaskResult())).rejects.toThrow("COMPLETED");
  });
});

// ─── Constructor behavior ──────────────────────────────────────────────────────

describe("LocalOverlayProvider: constructor behavior", () => {
  it("9. overlay with no preTask and no postTask → constructor throws TypeError naming overlay", () => {
    const overlay: BaseOverlay = { name: "empty-overlay", enabled: true };
    // no preTask or postTask defined
    expect(() => new LocalOverlayProvider(overlay)).toThrow(TypeError);
    expect(() => new LocalOverlayProvider(overlay)).toThrow("empty-overlay");
  });

  it("10. inner property === wrapped overlay instance", () => {
    const overlay = makeMockOverlay({ preResult: { proceed: true } });
    const provider = new LocalOverlayProvider(overlay);
    expect(provider.inner).toBe(overlay);
  });

  it("11a. enabled getter reflects overlay.enabled === true", () => {
    const overlay = makeMockOverlay({ enabled: true, preResult: { proceed: true } });
    const provider = new LocalOverlayProvider(overlay);
    expect(provider.enabled).toBe(true);
  });

  it("11b. enabled getter reflects overlay.enabled === false", () => {
    const overlay = makeMockOverlay({ enabled: false, preResult: { proceed: true } });
    const provider = new LocalOverlayProvider(overlay);
    expect(provider.enabled).toBe(false);
  });

  it("11c. enabled getter is live — reflects changes to inner.enabled", () => {
    const overlay = makeMockOverlay({ enabled: true, preResult: { proceed: true } });
    const provider = new LocalOverlayProvider(overlay);
    expect(provider.enabled).toBe(true);
    // Mutate the underlying overlay's enabled flag (cast to mutable for test)
    (overlay as unknown as Record<string, unknown>)["enabled"] = false;
    expect(provider.enabled).toBe(false);
  });

  it("12. runtime is always 'local'", () => {
    const overlay = makeMockOverlay({ preResult: { proceed: true } });
    const provider = new LocalOverlayProvider(overlay);
    expect(provider.runtime).toBe("local");
  });

  it("hooks includes pre_task when overlay has preTask", () => {
    const overlay = makeMockOverlay({ preResult: { proceed: true } });
    const provider = new LocalOverlayProvider(overlay);
    expect(provider.hooks).toContain("pre_task");
  });

  it("hooks includes post_task when overlay has postTask", () => {
    const overlay = makeMockOverlay({ postResult: { accept: true } });
    const provider = new LocalOverlayProvider(overlay);
    expect(provider.hooks).toContain("post_task");
  });

  it("hooks includes both pre_task and post_task when overlay implements both", () => {
    const overlay = makeMockOverlay({
      preResult: { proceed: true },
      postResult: { accept: true },
    });
    const provider = new LocalOverlayProvider(overlay);
    expect(provider.hooks).toContain("pre_task");
    expect(provider.hooks).toContain("post_task");
    expect(provider.hooks).toHaveLength(2);
  });
});

// ─── Equivalence test ──────────────────────────────────────────────────────────

describe("LocalOverlayProvider: equivalence — same BaseOverlay direct vs wrapped", () => {
  it("13. pre proceed:true → PASS in both direct and wrapped cases", async () => {
    const directOverlay = makeMockOverlay({ preResult: { proceed: true } });
    const wrappedOverlay = makeMockOverlay({ preResult: { proceed: true } });
    const provider = new LocalOverlayProvider(wrappedOverlay);

    const legacyCtx: LegacyContext = {
      task_id: "test-task",
      workflow_id: "test-workflow",
      run_id: "run-001",
      task_definition: makeOverlayContext().task_definition,
      agent_context: makeOverlayContext().agent_context,
    };

    const directResult = await directOverlay.preTask!(legacyCtx);
    const wrappedDecision = await provider.invokePre!(makeOverlayContext());

    // Direct result is a proceed, wrapped result should be PASS
    expect(directResult.proceed).toBe(true);
    expect(wrappedDecision.verdict).toBe("PASS");
  });

  it("pre proceed:false → REWORK in wrapped case", async () => {
    const wrappedOverlay = makeMockOverlay({
      preResult: { proceed: false, feedback: "Needs rework" },
    });
    const provider = new LocalOverlayProvider(wrappedOverlay);
    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.verdict).toBe("REWORK");
    expect(decision.feedback).toBe("Needs rework");
  });

  it("post accept:true → PASS in wrapped case", async () => {
    const wrappedOverlay = makeMockOverlay({ postResult: { accept: true } });
    const provider = new LocalOverlayProvider(wrappedOverlay);
    const decision = await provider.invokePost!(makeOverlayContext(), makeTaskResult());
    expect(decision.verdict).toBe("PASS");
  });

  it("post accept:false → REWORK in wrapped case", async () => {
    const wrappedOverlay = makeMockOverlay({
      postResult: { accept: false, new_status: "NEEDS_REWORK" },
    });
    const provider = new LocalOverlayProvider(wrappedOverlay);
    const decision = await provider.invokePost!(makeOverlayContext(), makeTaskResult());
    expect(decision.verdict).toBe("REWORK");
  });

  it("id equals the wrapped overlay name", () => {
    const overlay = makeMockOverlay({ name: "my-named-overlay", preResult: { proceed: true } });
    const provider = new LocalOverlayProvider(overlay);
    expect(provider.id).toBe("my-named-overlay");
  });
});

// ─── Evidence propagation ──────────────────────────────────────────────────────

describe("LocalOverlayProvider: evidence propagation", () => {
  it("evidence.source is always 'local'", async () => {
    const overlay = makeMockOverlay({
      preResult: { proceed: false, data: { key: "val" } },
    });
    const provider = new LocalOverlayProvider(overlay);
    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.evidence?.source).toBe("local");
  });

  it("evidence.overlay_id matches overlay name", async () => {
    const overlay = makeMockOverlay({
      name: "policy-gate",
      preResult: { proceed: false },
    });
    const provider = new LocalOverlayProvider(overlay);
    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.evidence?.overlay_id).toBe("policy-gate");
  });

  it("post-task FAIL evidence includes overlay_id and source", async () => {
    const overlay = makeMockOverlay({
      name: "confidence",
      postResult: { accept: false, new_status: "FAILED" },
    });
    const provider = new LocalOverlayProvider(overlay);
    const decision = await provider.invokePost!(makeOverlayContext(), makeTaskResult());
    expect(decision.evidence?.overlay_id).toBe("confidence");
    expect(decision.evidence?.source).toBe("local");
  });
});
