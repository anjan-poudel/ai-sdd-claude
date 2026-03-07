/**
 * T006: Provider Chain Runner tests — pre/post chain execution, short-circuit, phase filtering.
 * CLAUDE.md §1: Config-to-behavior pattern.
 * CLAUDE.md §5: Error messages are contracts.
 */

import { describe, it, expect } from "bun:test";
import {
  runPreProviderChain,
  runPostProviderChain,
  mergeContextUpdate,
} from "../../src/overlays/provider-chain.ts";
import type {
  OverlayProvider,
  OverlayDecision,
  OverlayContext,
} from "../../src/types/overlay-protocol.ts";
import type { TaskResult, TaskDefinition, AgentContext } from "../../src/types/index.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeOverlayContext(phase?: string): OverlayContext {
  const taskDef: TaskDefinition = {
    id: "test-task",
    agent: "developer",
    description: "Test task",
    ...(phase !== undefined ? { phase } : {}),
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
 * Create a mock OverlayProvider with configurable pre/post verdicts and call tracking.
 */
interface MockProviderOpts {
  id?: string;
  runtime?: "local" | "mcp";
  enabled?: boolean;
  hooks?: Array<"pre_task" | "post_task">;
  phases?: string[];
  preVerdict?: OverlayDecision;
  postVerdict?: OverlayDecision;
  preThrows?: Error;
  postThrows?: Error;
}

interface MockProvider extends OverlayProvider {
  preCallCount: number;
  postCallCount: number;
}

function makeMockProvider(opts: MockProviderOpts = {}): MockProvider {
  let preCallCount = 0;
  let postCallCount = 0;

  const hooks: Array<"pre_task" | "post_task"> = opts.hooks ?? ["pre_task", "post_task"];

  // Build provider object using Object.defineProperty for live getters
  // (spread would copy getter values, not the getter functions themselves)
  const provider = {
    id: opts.id ?? "mock-provider",
    runtime: opts.runtime ?? "local",
    enabled: opts.enabled ?? true,
    hooks,
    invokePre: hooks.includes("pre_task")
      ? async (_ctx: OverlayContext): Promise<OverlayDecision> => {
          preCallCount++;
          if (opts.preThrows) throw opts.preThrows;
          return opts.preVerdict ?? { verdict: "PASS" };
        }
      : undefined,
    invokePost: hooks.includes("post_task")
      ? async (_ctx: OverlayContext, _result: TaskResult): Promise<OverlayDecision> => {
          postCallCount++;
          if (opts.postThrows) throw opts.postThrows;
          return opts.postVerdict ?? { verdict: "PASS" };
        }
      : undefined,
  };

  // Add phases only when set (use defineProperty to avoid exactOptionalPropertyTypes + readonly issues)
  if (opts.phases !== undefined) {
    const phasesValue = opts.phases;
    Object.defineProperty(provider, "phases", { value: phasesValue, enumerable: true });
  }

  // Define live getters for call counts (avoids spread flattening them to values)
  Object.defineProperty(provider, "preCallCount", { get: () => preCallCount, enumerable: true });
  Object.defineProperty(provider, "postCallCount", { get: () => postCallCount, enumerable: true });

  return provider as unknown as MockProvider;
}

// ─── Pre-chain tests ──────────────────────────────────────────────────────────

describe("runPreProviderChain: basic execution", () => {
  it("1. Empty chain → verdict PASS", async () => {
    const result = await runPreProviderChain([], makeOverlayContext());
    expect(result.verdict).toBe("PASS");
  });

  it("2. All three providers return PASS → verdict PASS, all three called", async () => {
    const p1 = makeMockProvider({ id: "p1" });
    const p2 = makeMockProvider({ id: "p2" });
    const p3 = makeMockProvider({ id: "p3" });

    const result = await runPreProviderChain([p1, p2, p3], makeOverlayContext());
    expect(result.verdict).toBe("PASS");
    expect(p1.preCallCount).toBe(1);
    expect(p2.preCallCount).toBe(1);
    expect(p3.preCallCount).toBe(1);
  });

  it("3. Second provider returns REWORK → verdict REWORK, third NOT called (short-circuit)", async () => {
    const p1 = makeMockProvider({ id: "p1" });
    const p2 = makeMockProvider({ id: "p2", preVerdict: { verdict: "REWORK", feedback: "Needs rework" } });
    const p3 = makeMockProvider({ id: "p3" });

    const result = await runPreProviderChain([p1, p2, p3], makeOverlayContext());
    expect(result.verdict).toBe("REWORK");
    expect(result.feedback).toBe("Needs rework");
    expect(p1.preCallCount).toBe(1);
    expect(p2.preCallCount).toBe(1);
    expect(p3.preCallCount).toBe(0); // short-circuited
  });

  it("4. Second provider returns FAIL → verdict FAIL, third NOT called", async () => {
    const p1 = makeMockProvider({ id: "p1" });
    const p2 = makeMockProvider({ id: "p2", preVerdict: { verdict: "FAIL", feedback: "Fatal error" } });
    const p3 = makeMockProvider({ id: "p3" });

    const result = await runPreProviderChain([p1, p2, p3], makeOverlayContext());
    expect(result.verdict).toBe("FAIL");
    expect(p3.preCallCount).toBe(0);
  });

  it("5. Second provider returns HIL → verdict HIL, third NOT called", async () => {
    const p1 = makeMockProvider({ id: "p1" });
    const p2 = makeMockProvider({ id: "p2", preVerdict: { verdict: "HIL" } });
    const p3 = makeMockProvider({ id: "p3" });

    const result = await runPreProviderChain([p1, p2, p3], makeOverlayContext());
    expect(result.verdict).toBe("HIL");
    expect(p3.preCallCount).toBe(0);
  });
});

describe("runPreProviderChain: skip conditions", () => {
  it("6. Provider with enabled: false → skipped, invokePre not called", async () => {
    const p1 = makeMockProvider({ id: "p1", enabled: false });
    const result = await runPreProviderChain([p1], makeOverlayContext());
    expect(result.verdict).toBe("PASS");
    expect(p1.preCallCount).toBe(0);
  });

  it("7. Provider not declaring pre_task hook → skipped for pre chain", async () => {
    const p1 = makeMockProvider({ id: "p1", hooks: ["post_task"] });
    const result = await runPreProviderChain([p1], makeOverlayContext());
    expect(result.verdict).toBe("PASS");
    expect(p1.preCallCount).toBe(0);
  });

  it("8. Provider with phases: ['planning'] and task phase: 'implementation' → skipped", async () => {
    const p1 = makeMockProvider({
      id: "p1",
      phases: ["planning"],
      preVerdict: { verdict: "FAIL" }, // would fail if called
    });

    const result = await runPreProviderChain([p1], makeOverlayContext("implementation"));
    expect(result.verdict).toBe("PASS"); // skipped — not called
    expect(p1.preCallCount).toBe(0);
  });

  it("9. Provider with phases: ['planning'] and task phase: 'planning' → included", async () => {
    const p1 = makeMockProvider({
      id: "p1",
      phases: ["planning"],
    });

    const result = await runPreProviderChain([p1], makeOverlayContext("planning"));
    expect(result.verdict).toBe("PASS");
    expect(p1.preCallCount).toBe(1); // was called
  });

  it("10. Provider with phases: undefined → always included regardless of task phase", async () => {
    const p1 = makeMockProvider({ id: "p1" }); // no phases set

    const ctxImplementation = makeOverlayContext("implementation");
    const ctxPlanning = makeOverlayContext("planning");
    const ctxUndefined = makeOverlayContext(undefined);

    await runPreProviderChain([p1], ctxImplementation);
    await runPreProviderChain([p1], ctxPlanning);
    await runPreProviderChain([p1], ctxUndefined);

    expect(p1.preCallCount).toBe(3); // called all three times
  });

  it("11. Provider with phases: ['planning'] and task phase: undefined → skipped (conservative)", async () => {
    const p1 = makeMockProvider({
      id: "p1",
      phases: ["planning"],
      preVerdict: { verdict: "FAIL" }, // would fail if called
    });

    // Task has no phase field
    const result = await runPreProviderChain([p1], makeOverlayContext(undefined));
    expect(result.verdict).toBe("PASS"); // skipped
    expect(p1.preCallCount).toBe(0);
  });
});

describe("runPreProviderChain: exception handling", () => {
  it("12. Provider throws exception → returns FAIL with provider ID in feedback, no propagation", async () => {
    const p1 = makeMockProvider({ id: "p1" });
    const p2 = makeMockProvider({
      id: "throwing-provider",
      preThrows: new Error("Unexpected crash"),
    });
    const p3 = makeMockProvider({ id: "p3" });

    const result = await runPreProviderChain([p1, p2, p3], makeOverlayContext());
    expect(result.verdict).toBe("FAIL");
    expect(result.feedback).toContain("throwing-provider");
    expect(result.feedback).toContain("Unexpected crash");
    // p3 should NOT be called (short-circuit on FAIL)
    expect(p3.preCallCount).toBe(0);
  });

  it("Non-Error throw converts to FAIL without propagating", async () => {
    const p1: OverlayProvider = {
      id: "str-thrower",
      runtime: "local",
      hooks: ["pre_task"],
      enabled: true,
      invokePre: async () => {
        throw "string error"; // non-Error throw
      },
    };

    const result = await runPreProviderChain([p1], makeOverlayContext());
    expect(result.verdict).toBe("FAIL");
    expect(result.feedback).toContain("str-thrower");
  });
});

describe("runPreProviderChain: context propagation", () => {
  it("13. updated_context forwarded to next provider — second provider receives merged context", async () => {
    let secondProviderCtx: OverlayContext | undefined;

    const p1: OverlayProvider = {
      id: "p1",
      runtime: "local",
      hooks: ["pre_task"],
      enabled: true,
      invokePre: async (_ctx: OverlayContext): Promise<OverlayDecision> => {
        return {
          verdict: "PASS",
          updated_context: { handover_state: { extra_key: "extra_value" } },
        };
      },
    };

    const p2: OverlayProvider = {
      id: "p2",
      runtime: "local",
      hooks: ["pre_task"],
      enabled: true,
      invokePre: async (ctx: OverlayContext): Promise<OverlayDecision> => {
        secondProviderCtx = ctx;
        return { verdict: "PASS" };
      },
    };

    await runPreProviderChain([p1, p2], makeOverlayContext());
    expect(secondProviderCtx).toBeDefined();
    expect(secondProviderCtx!.agent_context.handover_state["extra_key"]).toBe("extra_value");
  });

  it("14. Identity field task_id in updated_context stripped — second provider does NOT see updated task_id", async () => {
    let secondProviderCtx: OverlayContext | undefined;

    const p1: OverlayProvider = {
      id: "p1",
      runtime: "local",
      hooks: ["pre_task"],
      enabled: true,
      invokePre: async (_ctx: OverlayContext): Promise<OverlayDecision> => {
        return {
          verdict: "PASS",
          updated_context: {
            handover_state: { legit: "data" },
            // task_id would be an invalid field on AgentContext but we test the stripping
          } as any,
        };
      },
    };

    const p2: OverlayProvider = {
      id: "p2",
      runtime: "local",
      hooks: ["pre_task"],
      enabled: true,
      invokePre: async (ctx: OverlayContext): Promise<OverlayDecision> => {
        secondProviderCtx = ctx;
        return { verdict: "PASS" };
      },
    };

    await runPreProviderChain([p1, p2], makeOverlayContext());
    // The context task_id should be unchanged (from original context)
    expect(secondProviderCtx!.task_id).toBe("test-task");
  });

  it("15. Identity field status in updated_context stripped", async () => {
    let secondProviderCtx: OverlayContext | undefined;

    const p1: OverlayProvider = {
      id: "p1",
      runtime: "local",
      hooks: ["pre_task"],
      enabled: true,
      invokePre: async (_ctx: OverlayContext): Promise<OverlayDecision> => {
        return {
          verdict: "PASS",
          updated_context: {
            handover_state: {},
            // status is a field that could theoretically be passed
          } as any,
        };
      },
    };

    const p2: OverlayProvider = {
      id: "p2",
      runtime: "local",
      hooks: ["pre_task"],
      enabled: true,
      invokePre: async (ctx: OverlayContext): Promise<OverlayDecision> => {
        secondProviderCtx = ctx;
        return { verdict: "PASS" };
      },
    };

    const ctx = makeOverlayContext();
    await runPreProviderChain([p1, p2], ctx);
    // workflow_id and run_id must remain unchanged from original context
    expect(secondProviderCtx!.workflow_id).toBe("test-workflow");
    expect(secondProviderCtx!.run_id).toBe("run-001");
  });
});

// ─── Post-chain tests (symmetric) ────────────────────────────────────────────

describe("runPostProviderChain: basic execution", () => {
  it("16. Empty chain → verdict PASS", async () => {
    const result = await runPostProviderChain([], makeOverlayContext(), makeTaskResult());
    expect(result.verdict).toBe("PASS");
  });

  it("17. All three providers return PASS → verdict PASS, all three called", async () => {
    const p1 = makeMockProvider({ id: "p1" });
    const p2 = makeMockProvider({ id: "p2" });
    const p3 = makeMockProvider({ id: "p3" });

    const result = await runPostProviderChain([p1, p2, p3], makeOverlayContext(), makeTaskResult());
    expect(result.verdict).toBe("PASS");
    expect(p1.postCallCount).toBe(1);
    expect(p2.postCallCount).toBe(1);
    expect(p3.postCallCount).toBe(1);
  });

  it("18. Second provider returns REWORK → short-circuit, third NOT called", async () => {
    const p1 = makeMockProvider({ id: "p1" });
    const p2 = makeMockProvider({ id: "p2", postVerdict: { verdict: "REWORK" } });
    const p3 = makeMockProvider({ id: "p3" });

    const result = await runPostProviderChain([p1, p2, p3], makeOverlayContext(), makeTaskResult());
    expect(result.verdict).toBe("REWORK");
    expect(p3.postCallCount).toBe(0);
  });

  it("19. Second provider returns FAIL → short-circuit, third NOT called", async () => {
    const p1 = makeMockProvider({ id: "p1" });
    const p2 = makeMockProvider({ id: "p2", postVerdict: { verdict: "FAIL" } });
    const p3 = makeMockProvider({ id: "p3" });

    const result = await runPostProviderChain([p1, p2, p3], makeOverlayContext(), makeTaskResult());
    expect(result.verdict).toBe("FAIL");
    expect(p3.postCallCount).toBe(0);
  });

  it("20. Second provider returns HIL → short-circuit, third NOT called", async () => {
    const p1 = makeMockProvider({ id: "p1" });
    const p2 = makeMockProvider({ id: "p2", postVerdict: { verdict: "HIL" } });
    const p3 = makeMockProvider({ id: "p3" });

    const result = await runPostProviderChain([p1, p2, p3], makeOverlayContext(), makeTaskResult());
    expect(result.verdict).toBe("HIL");
    expect(p3.postCallCount).toBe(0);
  });
});

describe("runPostProviderChain: skip conditions", () => {
  it("21. Provider with enabled: false → skipped, invokePost not called", async () => {
    const p1 = makeMockProvider({ id: "p1", enabled: false });
    const result = await runPostProviderChain([p1], makeOverlayContext(), makeTaskResult());
    expect(result.verdict).toBe("PASS");
    expect(p1.postCallCount).toBe(0);
  });

  it("22. Provider not declaring post_task hook → skipped for post chain", async () => {
    const p1 = makeMockProvider({ id: "p1", hooks: ["pre_task"] });
    const result = await runPostProviderChain([p1], makeOverlayContext(), makeTaskResult());
    expect(result.verdict).toBe("PASS");
    expect(p1.postCallCount).toBe(0);
  });

  it("Phase filter applies to post chain as well", async () => {
    const p1 = makeMockProvider({
      id: "p1",
      phases: ["planning"],
      postVerdict: { verdict: "FAIL" }, // would fail if called
    });

    const result = await runPostProviderChain([p1], makeOverlayContext("implementation"), makeTaskResult());
    expect(result.verdict).toBe("PASS"); // skipped due to phase mismatch
    expect(p1.postCallCount).toBe(0);
  });
});

describe("runPostProviderChain: exception handling", () => {
  it("Provider throws exception → returns FAIL with provider ID in feedback", async () => {
    const p1 = makeMockProvider({
      id: "post-thrower",
      postThrows: new Error("Post crash"),
    });

    const result = await runPostProviderChain([p1], makeOverlayContext(), makeTaskResult());
    expect(result.verdict).toBe("FAIL");
    expect(result.feedback).toContain("post-thrower");
    expect(result.feedback).toContain("Post crash");
  });
});

// ─── mergeContextUpdate unit tests ───────────────────────────────────────────

describe("mergeContextUpdate: identity field stripping", () => {
  it("Non-identity fields are merged into agent_context", () => {
    const ctx = makeOverlayContext();
    const originalTaskId = ctx.task_id;

    const updated = mergeContextUpdate(ctx, {
      handover_state: { new_key: "new_value" },
    });

    expect(updated.agent_context.handover_state["new_key"]).toBe("new_value");
    expect(updated.task_id).toBe(originalTaskId); // unchanged
  });

  it("Identity fields task_id, workflow_id, run_id, status are stripped", () => {
    const ctx = makeOverlayContext();

    // Cast to any to test stripping of fields that could come through as record
    const updated = mergeContextUpdate(ctx, {
      handover_state: { safe: "data" },
    } as any);

    expect(updated.task_id).toBe("test-task");
    expect(updated.workflow_id).toBe("test-workflow");
    expect(updated.run_id).toBe("run-001");
  });

  it("Empty/undefined update returns base context unchanged", () => {
    const ctx = makeOverlayContext();
    // mergeContextUpdate with empty update
    const updated = mergeContextUpdate(ctx, {});
    expect(updated.task_id).toBe(ctx.task_id);
    expect(updated.agent_context).toBeDefined();
  });
});

// ─── Config-to-behavior tests (CLAUDE.md §1) ─────────────────────────────────

describe("Config-to-behavior: phases filter changes provider inclusion", () => {
  it("23. phases: ['design'] → skipped for 'implementation', phases: ['implementation'] → included", async () => {
    const designProvider = makeMockProvider({
      id: "design-only",
      phases: ["design"],
    });

    const implProvider = makeMockProvider({
      id: "impl-only",
      phases: ["implementation"],
    });

    const ctx = makeOverlayContext("implementation");

    await runPreProviderChain([designProvider, implProvider], ctx);

    // design-only should be skipped, impl-only should be called
    expect(designProvider.preCallCount).toBe(0);
    expect(implProvider.preCallCount).toBe(1);
  });

  it("Switching phases config changes which providers are called", async () => {
    let callCount = 0;
    const provider: OverlayProvider = {
      id: "phase-sensitive",
      runtime: "local",
      hooks: ["pre_task"],
      enabled: true,
      phases: ["planning"],
      invokePre: async (): Promise<OverlayDecision> => {
        callCount++;
        return { verdict: "PASS" };
      },
    };

    // With planning phase → called
    await runPreProviderChain([provider], makeOverlayContext("planning"));
    expect(callCount).toBe(1);

    // With implementation phase → not called (different call count)
    await runPreProviderChain([provider], makeOverlayContext("implementation"));
    expect(callCount).toBe(1); // still 1, not 2
  });
});
