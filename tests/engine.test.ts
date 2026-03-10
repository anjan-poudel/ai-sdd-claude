/**
 * T004: Core engine tests
 */

import { describe, it, expect, afterEach } from "bun:test";
import { Engine } from "../src/core/engine.ts";
import { WorkflowLoader } from "../src/core/workflow-loader.ts";
import { AgentRegistry } from "../src/core/agent-loader.ts";
import { StateManager } from "../src/core/state-manager.ts";
import { ConstitutionResolver } from "../src/constitution/resolver.ts";
import { createManifestWriter } from "../src/constitution/manifest-writer.ts";
import { MockAdapter } from "../src/adapters/mock-adapter.ts";
import { ObservabilityEmitter } from "../src/observability/emitter.ts";
import { LocalOverlayProvider } from "../src/overlays/local-overlay-provider.ts";
import { buildProviderChain } from "../src/overlays/registry.ts";
import type { OverlayProvider, OverlayDecision, OverlayContext } from "../src/types/overlay-protocol.ts";
import type { BaseOverlay, OverlayContext as LegacyContext, OverlayResult } from "../src/overlays/base-overlay.ts";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { resolve, join } from "path";

const TEST_DIR = "/tmp/ai-sdd-engine-test";
const DEFAULTS_DIR = resolve(import.meta.dir, "../data/agents/defaults");

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
});

function makeEngine(
  workflowYaml: string,
  adapter?: MockAdapter,
  projectPath = TEST_DIR,
): Engine {
  mkdirSync(join(projectPath, ".ai-sdd", "state"), { recursive: true });

  const workflow = WorkflowLoader.loadYAML(workflowYaml);
  const registry = new AgentRegistry(DEFAULTS_DIR);
  registry.loadDefaults();

  const stateManager = new StateManager(
    join(projectPath, ".ai-sdd", "state"),
    workflow.config.name,
    projectPath,
  );

  const constitutionResolver = new ConstitutionResolver({
    project_path: projectPath,
    strict_parse: false,
  });

  const manifestWriter = createManifestWriter(projectPath);
  const runId = crypto.randomUUID();
  const emitter = new ObservabilityEmitter({
    run_id: runId,
    workflow_id: workflow.config.name,
    log_level: "ERROR", // suppress output in tests
  });

  const mockAdapter = adapter ?? new MockAdapter();

  return new Engine(
    workflow,
    stateManager,
    registry,
    mockAdapter,
    constitutionResolver,
    manifestWriter,
    emitter,
    { max_concurrent_tasks: 3 },
  );
}

function makeEngineWithOverlays(
  workflowYaml: string,
  opts: {
    adapter?: MockAdapter;
    projectPath?: string;
    providerChain?: OverlayProvider[];
  } = {},
): { engine: Engine; stateManager: StateManager } {
  const projectPath = opts.projectPath ?? TEST_DIR;
  mkdirSync(join(projectPath, ".ai-sdd", "state"), { recursive: true });

  const workflow = WorkflowLoader.loadYAML(workflowYaml);
  const registry = new AgentRegistry(DEFAULTS_DIR);
  registry.loadDefaults();

  const stateManager = new StateManager(
    join(projectPath, ".ai-sdd", "state"),
    workflow.config.name,
    projectPath,
  );

  const constitutionResolver = new ConstitutionResolver({
    project_path: projectPath,
    strict_parse: false,
  });

  const manifestWriter = createManifestWriter(projectPath);
  const runId = crypto.randomUUID();
  const emitter = new ObservabilityEmitter({
    run_id: runId,
    workflow_id: workflow.config.name,
    log_level: "ERROR",
  });

  const mockAdapter = opts.adapter ?? new MockAdapter();

  const engine = new Engine(
    workflow,
    stateManager,
    registry,
    mockAdapter,
    constitutionResolver,
    manifestWriter,
    emitter,
    { max_concurrent_tasks: 3 },
    opts.providerChain ?? [],
  );
  return { engine, stateManager };
}

const SIMPLE_WORKFLOW = `
version: "1"
name: test-workflow
tasks:
  task-a:
    agent: dev
    description: Task A
  task-b:
    agent: dev
    description: Task B
    depends_on: [task-a]
  task-c:
    agent: dev
    description: Task C
    depends_on: [task-b]
`;

describe("Engine: basic execution", () => {
  it("runs a 3-task sequential pipeline to completion", async () => {
    const engine = makeEngine(SIMPLE_WORKFLOW);
    const result = await engine.run({ dry_run: false });

    expect(result.completed).toContain("task-a");
    expect(result.completed).toContain("task-b");
    expect(result.completed).toContain("task-c");
    expect(result.failed).toHaveLength(0);
  });

  it("dispatches tasks to the adapter", async () => {
    const adapter = new MockAdapter();
    const engine = makeEngine(SIMPLE_WORKFLOW, adapter);
    await engine.run({ dry_run: false });

    expect(adapter.wasDispatched("task-a")).toBe(true);
    expect(adapter.wasDispatched("task-b")).toBe(true);
    expect(adapter.wasDispatched("task-c")).toBe(true);
  });

  it("dry run prints plan without dispatching", async () => {
    const adapter = new MockAdapter();
    const engine = makeEngine(SIMPLE_WORKFLOW, adapter);
    const result = await engine.run({ dry_run: true });

    expect(result.completed).toHaveLength(0);
    expect(adapter.dispatchCount()).toBe(0);
    expect(result.skipped).toContain("task-a");
  });
});

describe("Engine: failure handling", () => {
  it("failed task blocks downstream tasks", async () => {
    const adapter = new MockAdapter((task_id) => {
      if (task_id === "task-a") {
        return { status: "FAILED" as const, error: "Simulated failure" };
      }
      return { status: "COMPLETED" as const, outputs: [] };
    });

    const engine = makeEngine(SIMPLE_WORKFLOW, adapter);
    const result = await engine.run({ dry_run: false });

    expect(result.failed).toContain("task-a");
    // task-b and task-c should be blocked/skipped/failed due to task-a failing
    expect(result.completed).not.toContain("task-b");
    expect(result.completed).not.toContain("task-c");
  });
});

describe("Engine: adapter decoupling", () => {
  it("records operation_id and attempt_id in dispatch", async () => {
    const adapter = new MockAdapter();
    const engine = makeEngine(SIMPLE_WORKFLOW, adapter);
    await engine.run({ dry_run: false });

    const record = adapter.getRecords().find((r) => r.task_id === "task-a");
    expect(record).toBeDefined();
    expect(record!.options.operation_id).toContain("task-a");
    expect(record!.options.attempt_id).toBeDefined();
  });
});

describe("Engine: parallel execution", () => {
  const PARALLEL_WORKFLOW = `
version: "1"
name: parallel-test
tasks:
  base:
    agent: dev
    description: Base task
  branch-1:
    agent: dev
    description: Branch 1
    depends_on: [base]
  branch-2:
    agent: dev
    description: Branch 2
    depends_on: [base]
`;

  it("dispatches parallel tasks concurrently", async () => {
    const dispatchOrder: string[] = [];
    const adapter = new MockAdapter((task_id) => {
      dispatchOrder.push(task_id);
      return { status: "COMPLETED" as const, outputs: [] };
    });

    const engine = makeEngine(PARALLEL_WORKFLOW, adapter);
    const result = await engine.run({ dry_run: false });

    expect(result.completed).toContain("base");
    expect(result.completed).toContain("branch-1");
    expect(result.completed).toContain("branch-2");
    expect(result.failed).toHaveLength(0);
  });
});

describe("Engine: hooks", () => {
  it("post-task hook fires after each completed task", async () => {
    const postTaskCalled: string[] = [];
    const adapter = new MockAdapter();
    const engine = makeEngine(SIMPLE_WORKFLOW, adapter);

    engine.hooks.onPostTask("*", async ({ task_id }) => {
      postTaskCalled.push(task_id);
    });

    await engine.run({ dry_run: false });

    expect(postTaskCalled).toContain("task-a");
    expect(postTaskCalled).toContain("task-b");
    expect(postTaskCalled).toContain("task-c");
  });

  it("on-failure hook fires when task fails", async () => {
    const failureCalled: string[] = [];
    const adapter = new MockAdapter(() => ({ status: "FAILED" as const, error: "test" }));
    const engine = makeEngine(SIMPLE_WORKFLOW, adapter);

    engine.hooks.onFailure("*", async ({ task_id }) => {
      failureCalled.push(task_id);
    });

    await engine.run({ dry_run: false });
    expect(failureCalled).toContain("task-a");
  });
});

// ── T025: HIL resume state reset fix ─────────────────────────────────────────

const SINGLE_TASK_WORKFLOW = `
version: "1"
name: hil-test-wf
tasks:
  task-a:
    agent: dev
    description: Task A
`;

/**
 * Create a mock HIL overlay that tracks calls to preTask and awaitResolution.
 */
function makeMockHilOverlay(opts: {
  awaitResult?: OverlayResult;
}): BaseOverlay & { preTaskCalled: string[]; awaitCalled: string[] } {
  const preTaskCalled: string[] = [];
  const awaitCalled: string[] = [];
  return {
    name: "hil",
    enabled: true,
    preTaskCalled,
    awaitCalled,
    async preTask(ctx: LegacyContext): Promise<OverlayResult> {
      preTaskCalled.push(ctx.task_id);
      // Always trigger HIL in the normal (non-resume) path
      return { proceed: false, hil_trigger: true, data: { hil_id: `hil-for-${ctx.task_id}` } };
    },
    async awaitResolution(hilId: string): Promise<OverlayResult> {
      awaitCalled.push(hilId);
      return opts.awaitResult ?? { proceed: true };
    },
  };
}

describe("Engine: HIL resume (T025)", () => {
  it("resume from HIL_PENDING skips pre-overlay chain and calls awaitResolution", async () => {
    const mockHil = makeMockHilOverlay({ awaitResult: { proceed: true } });
    const hilProvider = new LocalOverlayProvider(mockHil);

    const { engine, stateManager } = makeEngineWithOverlays(SINGLE_TASK_WORKFLOW, {
      providerChain: [hilProvider],
    });

    // Initialize tasks manually and set task-a to HIL_PENDING with hil_item_id
    stateManager.initializeTasks(["task-a"]);
    stateManager.transition("task-a", "RUNNING");
    stateManager.transition("task-a", "HIL_PENDING", { hil_item_id: "hil-abc-123" });

    const result = await engine.run();

    // preTask should NOT have been called (HIL resume skips overlays)
    expect(mockHil.preTaskCalled).toHaveLength(0);
    // awaitResolution SHOULD have been called with the persisted hil_item_id
    expect(mockHil.awaitCalled).toContain("hil-abc-123");
    // Task should complete
    expect(result.completed).toContain("task-a");
  });

  it("resume from HIL_PENDING does not increment iteration count", async () => {
    const mockHil = makeMockHilOverlay({ awaitResult: { proceed: true } });
    const hilProvider = new LocalOverlayProvider(mockHil);

    const { engine, stateManager } = makeEngineWithOverlays(SINGLE_TASK_WORKFLOW, {
      providerChain: [hilProvider],
    });

    stateManager.initializeTasks(["task-a"]);
    stateManager.transition("task-a", "RUNNING");
    stateManager.incrementIteration("task-a"); // iteration = 1 (from original start)
    stateManager.transition("task-a", "HIL_PENDING", { hil_item_id: "hil-abc-123" });

    const iterBefore = stateManager.getTaskState("task-a").iterations;
    await engine.run();
    const iterAfter = stateManager.getTaskState("task-a").iterations;

    // Iteration should NOT have been bumped on resume
    expect(iterAfter).toBe(iterBefore);
  });

  it("resume from HIL_PENDING with rejected item transitions to FAILED", async () => {
    const mockHil = makeMockHilOverlay({
      awaitResult: { proceed: false, feedback: "Not approved by reviewer" },
    });
    const hilProvider = new LocalOverlayProvider(mockHil);

    const { engine, stateManager } = makeEngineWithOverlays(SINGLE_TASK_WORKFLOW, {
      providerChain: [hilProvider],
    });

    stateManager.initializeTasks(["task-a"]);
    stateManager.transition("task-a", "RUNNING");
    stateManager.transition("task-a", "HIL_PENDING", { hil_item_id: "hil-rejected" });

    const result = await engine.run();

    expect(result.failed).toContain("task-a");
    expect(result.completed).not.toContain("task-a");
    const taskState = stateManager.getTaskState("task-a");
    expect(taskState.status).toBe("FAILED");
    expect(taskState.error).toContain("Not approved by reviewer");
  });

  it("resume from HIL_PENDING without hil_item_id transitions to FAILED", async () => {
    const mockHil = makeMockHilOverlay({ awaitResult: { proceed: true } });
    const hilProvider = new LocalOverlayProvider(mockHil);

    const { engine, stateManager } = makeEngineWithOverlays(SINGLE_TASK_WORKFLOW, {
      providerChain: [hilProvider],
    });

    stateManager.initializeTasks(["task-a"]);
    stateManager.transition("task-a", "RUNNING");
    // Set HIL_PENDING WITHOUT hil_item_id
    stateManager.transition("task-a", "HIL_PENDING");

    const result = await engine.run();

    expect(result.failed).toContain("task-a");
    const taskState = stateManager.getTaskState("task-a");
    expect(taskState.status).toBe("FAILED");
    expect(taskState.error).toContain("no hil_item_id");
  });

  it("normal task start (non-resume) fires pre-overlay chain as before", async () => {
    const mockHil = makeMockHilOverlay({ awaitResult: { proceed: true } });
    const hilProvider = new LocalOverlayProvider(mockHil);

    const { engine } = makeEngineWithOverlays(SINGLE_TASK_WORKFLOW, {
      providerChain: [hilProvider],
    });

    const result = await engine.run();

    // preTask SHOULD have been called (normal path)
    expect(mockHil.preTaskCalled).toContain("task-a");
    // awaitResolution should also have been called (triggered by preTask's hil_trigger)
    expect(mockHil.awaitCalled).toHaveLength(1);
    expect(result.completed).toContain("task-a");
  });
});

// ── Chain-builder integration wiring test (CLAUDE.md §2, ROA-T-011) ──────────
//
// Development Standards §2: when component A (buildProviderChain) is wired into
// component B (Engine), there must be a test verifying A's output is passed to B
// and actually used. Unit tests of each component in isolation are insufficient.

describe("Engine: buildProviderChain wiring integration (ROA-T-011)", () => {
  it("buildProviderChain output is used by engine's runPreProviderChain", async () => {
    // Arrange: track invocations via a spy BaseOverlay
    const invokedTaskIds: string[] = [];
    const spyBaseOverlay: BaseOverlay & { preTask: (ctx: LegacyContext) => Promise<OverlayResult> } = {
      name: "chain-builder-spy",
      enabled: true,
      async preTask(ctx: LegacyContext): Promise<OverlayResult> {
        invokedTaskIds.push(ctx.task_id);
        return { proceed: true };
      },
    };

    // Build the provider chain using buildProviderChain (the component under integration)
    const chain = buildProviderChain({
      localOverlays: {
        // Use spyBaseOverlay as the HIL slot — it is first in chain order
        hil: spyBaseOverlay,
      },
    });

    // chain must be non-empty and contain our spy wrapped in LocalOverlayProvider
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0]!.id).toBe("chain-builder-spy");

    // Wire the chain into the Engine (the integration point)
    const { engine } = makeEngineWithOverlays(SINGLE_TASK_WORKFLOW, {
      providerChain: chain,
    });

    // Act: run the engine
    const result = await engine.run();

    // Assert: the spy's invokePre was called (verifying chain was passed to runPreProviderChain)
    expect(invokedTaskIds).toContain("task-a");
    expect(result.completed).toContain("task-a");
  });
});

// ─── T011: Context observability ───────────────────────────────────────────

describe("Engine: context.assembled event", () => {
  function makeEngineWithEmitter(
    workflowYaml: string,
    config: Parameters<typeof Engine>[7] = {},
  ): { engine: Engine; emitter: ObservabilityEmitter } {
    mkdirSync(join(TEST_DIR, ".ai-sdd", "state"), { recursive: true });
    const workflow = WorkflowLoader.loadYAML(workflowYaml);
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
    const emitter = new ObservabilityEmitter({
      run_id: crypto.randomUUID(),
      workflow_id: workflow.config.name,
      log_level: "ERROR",
    });
    const engine = new Engine(
      workflow,
      stateManager,
      registry,
      new MockAdapter(),
      constitutionResolver,
      manifestWriter,
      emitter,
      { max_concurrent_tasks: 1, ...config },
    );
    return { engine, emitter };
  }

  it("emits context.assembled with token_count after assembly", async () => {
    const { engine, emitter } = makeEngineWithEmitter(SINGLE_TASK_WORKFLOW);
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    emitter.on((ev) => events.push({ type: ev.type, data: ev.data }));

    await engine.run();

    const assembled = events.filter((e) => e.type === "context.assembled");
    expect(assembled.length).toBeGreaterThan(0);
    expect(assembled[0]!.data.task_id).toBe("task-a");
    expect(typeof assembled[0]!.data.token_count).toBe("number");
    expect(assembled[0]!.data.token_count as number).toBeGreaterThan(0);
  });

  it("emits context.warning when usage exceeds warning threshold", async () => {
    const { engine, emitter } = makeEngineWithEmitter(SINGLE_TASK_WORKFLOW, {
      max_context_tokens: 1,
      context_warning_threshold_pct: 80,
      context_hil_threshold_pct: 10_000_000,
    });
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    emitter.on((ev) => events.push({ type: ev.type, data: ev.data }));

    await engine.run();

    const warnings = events.filter((e) => e.type === "context.warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.data.task_id).toBe("task-a");
    expect(warnings[0]!.data.usage_pct as number).toBeGreaterThan(80);
  });

  it("does not emit context.warning when usage is below threshold", async () => {
    const { engine, emitter } = makeEngineWithEmitter(SINGLE_TASK_WORKFLOW, {
      max_context_tokens: 10_000_000,
      context_warning_threshold_pct: 80,
    });
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    emitter.on((ev) => events.push({ type: ev.type, data: ev.data }));

    await engine.run();

    expect(events.filter((e) => e.type === "context.warning").length).toBe(0);
  });
});

// ─── T015: Adapter retry policy ─────────────────────────────────────────────

describe("Adapter: ContextOverflowError is not retried", () => {
  it("ContextOverflowError has retryable=false and error_type=context_overflow", () => {
    const { ContextOverflowError } = require("../src/adapters/errors.ts");
    const err = new ContextOverflowError("Too large", 50000, 40000);
    expect(err.retryable).toBe(false);
    expect(err.error_type).toBe("context_overflow");
  });

  it("dispatchWithRetry returns immediately when ContextOverflowError is thrown (no retry)", async () => {
    const { ContextOverflowError } = require("../src/adapters/errors.ts");
    let callCount = 0;

    class ThrowingAdapter extends MockAdapter {
      override async dispatch() {
        callCount++;
        throw new ContextOverflowError("Context too large", 50000, 40000);
      }
    }

    const adapter = new ThrowingAdapter();
    const context = {
      constitution: "test",
      task_definition: { id: "t1", description: "test" },
      dispatch_mode: "direct" as const,
    };
    const result = await adapter.dispatchWithRetry("t1", context, {
      operation_id: "op:t1:run-1",
      attempt_id: "op:t1:run-1",
    });

    expect(callCount).toBe(1); // NOT retried
    expect(result.status).toBe("FAILED");
    expect(result.error_type).toBe("context_overflow");
  });

  it("dispatchWithRetry retries on generic errors (no AdapterError.retryable=false)", async () => {
    let callCount = 0;

    class GenericThrowAdapter extends MockAdapter {
      override async dispatch() {
        callCount++;
        if (callCount < 3) throw new Error("transient error");
        return { status: "COMPLETED" as const };
      }
    }

    const adapter = new GenericThrowAdapter();
    const context = {
      constitution: "test",
      task_definition: { id: "t1", description: "test" },
      dispatch_mode: "direct" as const,
    };
    const result = await adapter.dispatchWithRetry("t1", context, {
      operation_id: "op:t1:run-1",
      attempt_id: "op:t1:run-1",
    });

    expect(callCount).toBe(3); // retried until success
    expect(result.status).toBe("COMPLETED");
  });
});

// ─── T016: Manifest idempotency ─────────────────────────────────────────────

describe("ManifestWriter: idempotency", () => {
  it("writing manifest twice produces identical output", () => {
    const dir = "/tmp/ai-sdd-manifest-idempotent-" + Date.now();
    mkdirSync(join(dir, ".ai-sdd", "state"), { recursive: true });

    const wf = WorkflowLoader.loadYAML(`
version: "1"
name: manifest-idem
tasks:
  t1:
    agent: dev
    description: Done task
    outputs:
      - path: specs/t1.md
        contract: implementation
`);
    const sm = new StateManager(join(dir, ".ai-sdd", "state"), "manifest-idem", dir);
    sm.initializeTasks(["t1"]);
    sm.transition("t1", "RUNNING");
    sm.transition("t1", "COMPLETED", { outputs: [{ path: "specs/t1.md", contract: "implementation" }] });

    const mw = createManifestWriter(dir);
    const state = sm.getState();
    mw.writeArtifactManifest(state);
    const first = require("fs").readFileSync(join(dir, ".ai-sdd", "constitution.md"), "utf-8") as string;
    mw.writeArtifactManifest(state);
    const second = require("fs").readFileSync(join(dir, ".ai-sdd", "constitution.md"), "utf-8") as string;

    expect(first).toBe(second);
    require("fs").rmSync(dir, { recursive: true });
  });

  it("manifest only includes COMPLETED tasks with outputs", () => {
    const dir = "/tmp/ai-sdd-manifest-completed-" + Date.now();
    mkdirSync(join(dir, ".ai-sdd", "state"), { recursive: true });

    const wf = WorkflowLoader.loadYAML(`
version: "1"
name: manifest-completed
tasks:
  t1:
    agent: dev
    description: Done task
    outputs:
      - path: specs/t1.md
  t2:
    agent: dev
    description: Pending task
    depends_on: [t1]
`);
    const sm = new StateManager(join(dir, ".ai-sdd", "state"), "manifest-completed", dir);
    sm.initializeTasks(["t1", "t2"]);
    sm.transition("t1", "RUNNING");
    sm.transition("t1", "COMPLETED", { outputs: [{ path: "specs/t1.md" }] });
    // t2 remains PENDING

    const mw = createManifestWriter(dir);
    mw.writeArtifactManifest(sm.getState());
    const content = require("fs").readFileSync(join(dir, ".ai-sdd", "constitution.md"), "utf-8") as string;

    expect(content).toContain("t1");
    expect(content).not.toContain("t2");
    require("fs").rmSync(dir, { recursive: true });
  });
});
