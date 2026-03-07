/**
 * T009: Engine wiring integration tests — OverlayProvider chain.
 * Verifies that the Engine correctly uses runPreProviderChain / runPostProviderChain
 * and maps all four OverlayVerdict values to the correct task state transitions.
 *
 * CLAUDE.md §2: Integration point tests — asserts that LocalOverlayProvider.invokePre
 * is called (not BaseOverlay.preTask directly) when running with a provider chain.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { Engine } from "../../src/core/engine.ts";
import { WorkflowLoader } from "../../src/core/workflow-loader.ts";
import { AgentRegistry } from "../../src/core/agent-loader.ts";
import { StateManager } from "../../src/core/state-manager.ts";
import { ConstitutionResolver } from "../../src/constitution/resolver.ts";
import { createManifestWriter } from "../../src/constitution/manifest-writer.ts";
import { MockAdapter } from "../../src/adapters/mock-adapter.ts";
import { ObservabilityEmitter } from "../../src/observability/emitter.ts";
import { LocalOverlayProvider } from "../../src/overlays/local-overlay-provider.ts";
import type {
  OverlayProvider,
  OverlayDecision,
  OverlayContext,
  OverlayVerdict,
} from "../../src/types/overlay-protocol.ts";
import type { TaskResult } from "../../src/types/index.ts";
import { rmSync, mkdirSync } from "fs";
import { join, resolve } from "path";

const TEST_DIR = "/tmp/ai-sdd-engine-provider-chain-test";
const DEFAULTS_DIR = resolve(import.meta.dir, "../../data/agents/defaults");

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
});

const SINGLE_TASK_WORKFLOW = `
version: "1"
name: engine-provider-chain-test
tasks:
  task-a:
    agent: dev
    description: Task A for provider chain test
`;

/**
 * Create an OverlayProvider that returns a fixed verdict for pre-task and tracks calls.
 */
function makeSpyProvider(opts: {
  preVerdict?: OverlayVerdict;
  postVerdict?: OverlayVerdict;
  feedback?: string;
  evidence?: OverlayDecision["evidence"];
  id?: string;
}): OverlayProvider & { preCallCount: number; postCallCount: number } {
  let preCallCount = 0;
  let postCallCount = 0;
  const provider: OverlayProvider & { preCallCount: number; postCallCount: number } = {
    get id() { return opts.id ?? "spy-provider"; },
    runtime: "local",
    hooks: ["pre_task", "post_task"],
    enabled: true,
    preCallCount,
    postCallCount,
    async invokePre(_ctx: OverlayContext): Promise<OverlayDecision> {
      provider.preCallCount++;
      return {
        verdict: opts.preVerdict ?? "PASS",
        ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
        ...(opts.evidence !== undefined ? { evidence: opts.evidence } : {}),
      };
    },
    async invokePost(_ctx: OverlayContext, _result: TaskResult): Promise<OverlayDecision> {
      provider.postCallCount++;
      return {
        verdict: opts.postVerdict ?? "PASS",
        ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
        ...(opts.evidence !== undefined ? { evidence: opts.evidence } : {}),
      };
    },
  };
  return provider;
}

function makeSetup(
  adapter?: MockAdapter,
  providerChain: OverlayProvider[] = [],
): { engine: Engine; stateManager: StateManager } {
  mkdirSync(join(TEST_DIR, ".ai-sdd", "state"), { recursive: true });

  const workflow = WorkflowLoader.loadYAML(SINGLE_TASK_WORKFLOW);
  const registry = new AgentRegistry(DEFAULTS_DIR);
  registry.loadDefaults();

  const stateManager = new StateManager(
    join(TEST_DIR, ".ai-sdd", "state"),
    workflow.config.name,
    TEST_DIR,
  );

  const constitutionResolver = new ConstitutionResolver({
    project_path: TEST_DIR,
    strict_parse: false,
  });

  const manifestWriter = createManifestWriter(TEST_DIR);
  const runId = crypto.randomUUID();
  const emitter = new ObservabilityEmitter({
    run_id: runId,
    workflow_id: workflow.config.name,
    log_level: "ERROR",
  });

  const mockAdapter = adapter ?? new MockAdapter();

  const engine = new Engine(
    workflow,
    stateManager,
    registry,
    mockAdapter,
    constitutionResolver,
    manifestWriter,
    emitter,
    { max_concurrent_tasks: 3 },
    providerChain,
  );

  return { engine, stateManager };
}

// ── Pre-chain verdict mapping ──────────────────────────────────────────────────

describe("Engine: provider chain pre-task verdict mapping", () => {
  it("1. pre-chain PASS → adapter dispatchWithRetry is called (integration wiring test)", async () => {
    const adapter = new MockAdapter();
    const spyProvider = makeSpyProvider({ preVerdict: "PASS" });
    const { engine } = makeSetup(adapter, [spyProvider]);

    const result = await engine.run();

    // Integration point test: adapter must be called (verifies provider chain doesn't block)
    expect(adapter.wasDispatched("task-a")).toBe(true);
    expect(result.completed).toContain("task-a");
    // Also verify that the spy provider's invokePre was actually called
    expect(spyProvider.preCallCount).toBe(1);
  });

  it("2. pre-chain REWORK → stateManager task transitions to NEEDS_REWORK", async () => {
    const adapter = new MockAdapter();
    // After NEEDS_REWORK the engine loops; make the second iteration use PASS
    let callCount = 0;
    const provider = makeSpyProvider({ preVerdict: "PASS" }); // will be updated
    const spyProvider: OverlayProvider & { preCallCount: number; postCallCount: number } = {
      ...provider,
      async invokePre(_ctx: OverlayContext): Promise<OverlayDecision> {
        callCount++;
        // First call: REWORK; subsequent calls: PASS so the engine can complete
        if (callCount === 1) {
          spyProvider.preCallCount++;
          return { verdict: "REWORK", feedback: "needs changes" };
        }
        spyProvider.preCallCount++;
        return { verdict: "PASS" };
      },
      async invokePost(_ctx: OverlayContext, _result: TaskResult): Promise<OverlayDecision> {
        spyProvider.postCallCount++;
        return { verdict: "PASS" };
      },
      preCallCount: 0,
      postCallCount: 0,
    };

    const { engine, stateManager } = makeSetup(adapter, [spyProvider]);

    const result = await engine.run();

    // The task should eventually complete after rework
    expect(result.completed).toContain("task-a");
    // Pre chain should have been called at least twice (once for REWORK, once for PASS)
    expect(spyProvider.preCallCount).toBeGreaterThanOrEqual(2);
  });

  it("3. pre-chain FAIL → task transitions to FAILED, no further iterations", async () => {
    const adapter = new MockAdapter();
    const spyProvider = makeSpyProvider({ preVerdict: "FAIL", feedback: "blocked by policy" });
    const { engine, stateManager } = makeSetup(adapter, [spyProvider]);

    const result = await engine.run();

    expect(result.failed).toContain("task-a");
    expect(result.completed).not.toContain("task-a");
    // Adapter should NOT have been called (blocked pre-chain)
    expect(adapter.wasDispatched("task-a")).toBe(false);

    const taskState = stateManager.getTaskState("task-a");
    expect(taskState.status).toBe("FAILED");
    expect(taskState.error).toContain("blocked by policy");

    // Pre-chain should have fired exactly once (no re-iterations after FAIL)
    expect(spyProvider.preCallCount).toBe(1);
  });

  it("4. pre-chain HIL → task transitions to HIL_PENDING", async () => {
    const adapter = new MockAdapter();
    const spyProvider = makeSpyProvider({
      preVerdict: "HIL",
      feedback: "human review required",
      evidence: {
        overlay_id: "hil-check",
        source: "local",
        data: { hil_id: "hil-test-001" },
      },
    });
    const { engine, stateManager } = makeSetup(adapter, [spyProvider]);

    // Run the engine — it will enter HIL_PENDING. No HIL resolution provider is in the
    // chain so awaitResolution won't be called; the HIL path returns FAILED without a
    // proper hil overlay. We only need to verify that the HIL_PENDING transition occurred.
    // Actually, when HIL_AWAITING is returned from applyPreDecision, the engine tries to
    // call awaitResolution. With no LocalOverlayProvider with id "hil", hilOverlay is undefined
    // and it proceeds with "HIL overlay unavailable or hil_id missing" → FAILED.
    // The important assertion is that the transition to HIL_PENDING happened.

    // To verify HIL_PENDING, we use a spy on stateManager transitions
    const transitions: string[] = [];
    const origTransition = stateManager.transition.bind(stateManager);
    stateManager.transition = (taskId, status, payload) => {
      transitions.push(status);
      return origTransition(taskId, status, payload);
    };

    const result = await engine.run();

    // HIL_PENDING must have been hit
    expect(transitions).toContain("HIL_PENDING");
    // The task eventually fails because no real HIL resolver is present
    expect(result.failed).toContain("task-a");
  });
});

// ── Post-chain verdict mapping ─────────────────────────────────────────────────

describe("Engine: provider chain post-task verdict mapping", () => {
  it("5. post-chain PASS → task reaches COMPLETED", async () => {
    const adapter = new MockAdapter();
    const spyProvider = makeSpyProvider({ preVerdict: "PASS", postVerdict: "PASS" });
    const { engine } = makeSetup(adapter, [spyProvider]);

    const result = await engine.run();

    expect(result.completed).toContain("task-a");
    expect(result.failed).toHaveLength(0);
    expect(spyProvider.postCallCount).toBe(1);
  });

  it("6. post-chain REWORK → task re-iterates (iteration counter incremented)", async () => {
    const adapter = new MockAdapter();
    let postCallCount = 0;

    const spyProvider: OverlayProvider & { preCallCount: number; postCallCount: number } = {
      id: "rework-post-spy",
      runtime: "local",
      hooks: ["pre_task", "post_task"],
      enabled: true,
      preCallCount: 0,
      postCallCount: 0,
      async invokePre(_ctx: OverlayContext): Promise<OverlayDecision> {
        spyProvider.preCallCount++;
        return { verdict: "PASS" };
      },
      async invokePost(_ctx: OverlayContext, _result: TaskResult): Promise<OverlayDecision> {
        spyProvider.postCallCount++;
        postCallCount++;
        // First call: REWORK; second call: PASS so the engine can complete
        if (postCallCount === 1) {
          return { verdict: "REWORK", feedback: "post-rework needed" };
        }
        return { verdict: "PASS" };
      },
    };

    const { engine, stateManager } = makeSetup(adapter, [spyProvider]);

    const result = await engine.run();

    // Task should complete after the rework cycle
    expect(result.completed).toContain("task-a");
    // Post-chain was called at least twice
    expect(spyProvider.postCallCount).toBeGreaterThanOrEqual(2);
    // Iteration counter should reflect multiple iterations
    const taskState = stateManager.getTaskState("task-a");
    expect(taskState.iterations).toBeGreaterThanOrEqual(2);
  });

  it("7. post-chain FAIL → FAILED, no further iterations", async () => {
    const adapter = new MockAdapter();
    const spyProvider = makeSpyProvider({
      preVerdict: "PASS",
      postVerdict: "FAIL",
      feedback: "post-task check failed",
    });
    const { engine, stateManager } = makeSetup(adapter, [spyProvider]);

    const result = await engine.run();

    expect(result.failed).toContain("task-a");
    expect(result.completed).not.toContain("task-a");
    const taskState = stateManager.getTaskState("task-a");
    expect(taskState.status).toBe("FAILED");
    expect(taskState.error).toContain("post-task check failed");
    // Post-chain should have been called only once (no re-iterations after terminal FAIL)
    expect(spyProvider.postCallCount).toBe(1);
  });
});

// ── Evidence propagation ────────────────────────────────────────────────────────

describe("Engine: overlay evidence propagation", () => {
  it("8. evidence written to task state when decision.evidence is present", async () => {
    const adapter = new MockAdapter();
    const evidence = {
      overlay_id: "test-security-check",
      source: "local" as const,
      checks: ["no_secrets", "lint_clean"],
      data: { severity: "low" },
    };

    const spyProvider = makeSpyProvider({
      preVerdict: "FAIL",
      feedback: "security check failed",
      evidence,
    });

    const { engine, stateManager } = makeSetup(adapter, [spyProvider]);

    await engine.run();

    const taskState = stateManager.getTaskState("task-a");
    expect(taskState.overlay_evidence).toBeDefined();
    expect(taskState.overlay_evidence?.overlay_id).toBe("test-security-check");
    expect(taskState.overlay_evidence?.checks).toEqual(["no_secrets", "lint_clean"]);
  });
});

// ── Identity field protection ────────────────────────────────────────────────────

describe("Engine: updated_context identity field protection", () => {
  it("9. remote updated_context.task_id cannot overwrite state record task_id", async () => {
    const adapter = new MockAdapter();

    // Provider that returns updated_context with a spoofed task_id
    const hijackProvider: OverlayProvider = {
      id: "hijack-provider",
      runtime: "local",
      hooks: ["pre_task"],
      enabled: true,
      async invokePre(_ctx: OverlayContext): Promise<OverlayDecision> {
        return {
          verdict: "PASS",
          updated_context: {
            // Attempt to inject a different task_id via updated_context
            task_id: "injected" as never,
            constitution: "original-content",
          } as never,
        };
      },
    };

    const { engine, stateManager } = makeSetup(adapter, [hijackProvider]);

    const result = await engine.run();

    // The task must complete as task-a (not "injected")
    expect(result.completed).toContain("task-a");
    expect(result.completed).not.toContain("injected");

    // The state record for "task-a" should be COMPLETED (identity intact)
    const taskAState = stateManager.getTaskState("task-a");
    expect(taskAState.status).toBe("COMPLETED");
  });
});

// ── Integration point test (CLAUDE.md §2) ────────────────────────────────────────

describe("Engine: LocalOverlayProvider wiring (CLAUDE.md §2)", () => {
  it("10. LocalOverlayProvider.invokePre is called (not BaseOverlay.preTask directly)", async () => {
    const adapter = new MockAdapter();
    const preTaskCalledOnBase: string[] = [];
    const invokePreCalledOnProvider: string[] = [];

    // Build a BaseOverlay that tracks direct calls
    const baseOverlay = {
      name: "wiring-test-overlay",
      enabled: true,
      async preTask(ctx: { task_id: string }) {
        preTaskCalledOnBase.push(ctx.task_id);
        return { proceed: true };
      },
    };

    // Wrap it in LocalOverlayProvider
    const localProvider = new LocalOverlayProvider(baseOverlay);

    // Spy on the invokePre method to track provider-level calls
    const originalInvokePre = localProvider.invokePre!;
    localProvider.invokePre = async (ctx: OverlayContext): Promise<OverlayDecision> => {
      invokePreCalledOnProvider.push(ctx.task_id);
      return originalInvokePre(ctx);
    };

    const { engine } = makeSetup(adapter, [localProvider]);

    await engine.run();

    // LocalOverlayProvider.invokePre should have been called
    expect(invokePreCalledOnProvider).toContain("task-a");
    // BaseOverlay.preTask should also have been called (via the provider delegation)
    expect(preTaskCalledOnBase).toContain("task-a");
  });

  it("11. buildProviderChain wiring: engine uses OverlayProvider[] chain (not BaseOverlay[] directly)", async () => {
    // This test verifies the wiring described in T009: the engine must use
    // runPreProviderChain (OverlayProvider[]) rather than calling BaseOverlay methods directly.
    // We verify this by providing a pure OverlayProvider (no BaseOverlay involved) and
    // confirming the engine calls it.

    const adapter = new MockAdapter();
    let invokeCalled = false;

    const pureProvider: OverlayProvider = {
      id: "pure-provider",
      runtime: "mcp", // not "local" — has no BaseOverlay
      hooks: ["pre_task"],
      enabled: true,
      async invokePre(_ctx: OverlayContext): Promise<OverlayDecision> {
        invokeCalled = true;
        return { verdict: "PASS" };
      },
    };

    const { engine } = makeSetup(adapter, [pureProvider]);

    const result = await engine.run();

    // The pure OverlayProvider must have been called by the engine's runPreProviderChain
    expect(invokeCalled).toBe(true);
    expect(result.completed).toContain("task-a");
  });
});
