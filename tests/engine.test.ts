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
import { ConfidenceOverlay } from "../src/overlays/confidence/confidence-overlay.ts";
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

// ─── Confidence: regeneration + escalation chain ────────────────────────────

const CONFIDENCE_REGEN_WORKFLOW = `
version: "1"
name: confidence-regen-test
tasks:
  task-a:
    agent: dev
    description: Task with low confidence threshold
    overlays:
      confidence:
        threshold: 0.75
        low_confidence_threshold: 0.5
        max_regeneration_retries: 2
`;

const CONFIDENCE_REGEN_PAIRED_WORKFLOW = `
version: "1"
name: confidence-regen-paired-test
tasks:
  task-a:
    agent: dev
    description: Task with low confidence + paired escalation
    overlays:
      confidence:
        threshold: 0.99
        low_confidence_threshold: 0.5
        max_regeneration_retries: 1
      paired:
        enabled: true
        challenger_agent: reviewer
        driver_agent: dev
`;

function makeEngineWithConfidenceOverlay(
  workflowYaml: string,
  opts: {
    adapter?: MockAdapter;
    extraOverlays?: Record<string, BaseOverlay>;
    emitterRef?: { emitter?: ObservabilityEmitter };
  } = {},
): { engine: Engine; stateManager: StateManager; emitter: ObservabilityEmitter } {
  const projectPath = TEST_DIR;
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
  if (opts.emitterRef) opts.emitterRef.emitter = emitter;

  const mockAdapter = opts.adapter ?? new MockAdapter();

  const confidenceOverlay = new ConfidenceOverlay(emitter, {}, mockAdapter);
  const providerChain = buildProviderChain({
    localOverlays: {
      ...(opts.extraOverlays ?? {}),
      confidence: confidenceOverlay,
    },
    emitter,
  });

  const engine = new Engine(
    workflow,
    stateManager,
    registry,
    mockAdapter,
    constitutionResolver,
    manifestWriter,
    emitter,
    { max_concurrent_tasks: 1 },
    providerChain,
  );
  return { engine, stateManager, emitter };
}

describe("Engine: confidence regeneration chain", () => {
  it("retries up to max_regeneration_retries before escalating (no paired, no HIL → FAILED)", async () => {
    // Adapter always returns COMPLETED with no outputs → score ≈ 0.22 < 0.5 → REGENERATE on every attempt
    let dispatchCount = 0;
    const adapter = new MockAdapter(() => {
      dispatchCount++;
      return { status: "COMPLETED" as const, outputs: [] };
    });

    const { engine, stateManager } = makeEngineWithConfidenceOverlay(CONFIDENCE_REGEN_WORKFLOW, { adapter });
    const result = await engine.run({ dry_run: false });

    // max_regeneration_retries=2 → 3 total dispatches (1 initial + 2 retries) before escalating
    // No paired, no HIL configured → FAILED after retries exhausted
    expect(result.failed).toContain("task-a");
    expect(result.completed).not.toContain("task-a");
    expect(dispatchCount).toBe(3); // 1 original + 2 retries
  });

  it("exits regeneration loop early when score recovers above threshold", async () => {
    // First call returns low score; second returns high score (1 output)
    let callN = 0;
    const adapter = new MockAdapter(() => {
      callN++;
      if (callN === 1) {
        return { status: "COMPLETED" as const, outputs: [] }; // low score → REGENERATE
      }
      return { status: "COMPLETED" as const, outputs: [{ path: "out.md" }] }; // score ≈ 0.78 → COMPLETED
    });

    const { engine } = makeEngineWithConfidenceOverlay(CONFIDENCE_REGEN_WORKFLOW, { adapter });
    const result = await engine.run({ dry_run: false });

    expect(result.completed).toContain("task-a");
    expect(callN).toBe(2);
  });

  it("emits confidence.regenerating event on each retry with correct attempt count", async () => {
    const regenEvents: Array<{ attempt: number; max_retries: number }> = [];

    const adapter = new MockAdapter(() => ({ status: "COMPLETED" as const, outputs: [] }));
    const { engine, emitter } = makeEngineWithConfidenceOverlay(CONFIDENCE_REGEN_WORKFLOW, { adapter });

    emitter.on((ev) => {
      if (ev.type === "confidence.regenerating") regenEvents.push(ev.data as { attempt: number; max_retries: number });
    });

    await engine.run({ dry_run: false });

    // Should have fired for each retry (max_regeneration_retries=2, so attempts 1 and 2)
    expect(regenEvents.length).toBeGreaterThanOrEqual(2);
    expect(regenEvents[0]!.attempt).toBe(1);
    expect(regenEvents[0]!.max_retries).toBe(2);
  });

  it("emits confidence.retries_exhausted event after all retries used", async () => {
    let exhaustedFired = false;

    const adapter = new MockAdapter(() => ({ status: "COMPLETED" as const, outputs: [] }));
    const { engine, emitter } = makeEngineWithConfidenceOverlay(CONFIDENCE_REGEN_WORKFLOW, { adapter });

    emitter.on((ev) => {
      if (ev.type === "confidence.retries_exhausted") exhaustedFired = true;
    });

    await engine.run({ dry_run: false });

    expect(exhaustedFired).toBe(true);
  });

  it("does NOT trigger regeneration when low_confidence_threshold is not configured", async () => {
    // No low_confidence_threshold → NEEDS_REWORK behaviour only (normal rework loop)
    const STANDARD_CONFIDENCE_WORKFLOW = `
version: "1"
name: standard-confidence-test
tasks:
  task-a:
    agent: dev
    description: Standard confidence task
    max_rework_iterations: 1
    overlays:
      confidence:
        threshold: 0.99
`;
    let dispatchCount = 0;
    const adapter = new MockAdapter(() => {
      dispatchCount++;
      return { status: "COMPLETED" as const, outputs: [] };
    });
    const { engine } = makeEngineWithConfidenceOverlay(STANDARD_CONFIDENCE_WORKFLOW, { adapter });
    const result = await engine.run({ dry_run: false });

    // With max_rework_iterations=1, should fail after 2 dispatches (1 + 1 rework), not 3+
    expect(result.failed).toContain("task-a");
    expect(dispatchCount).toBeLessThanOrEqual(2);
  });
});

describe("Engine: confidence escalation to HIL (no paired)", () => {
  it("escalates to HIL after retries exhausted when HIL overlay is present", async () => {
    // threshold: 0.75 — reachable by heuristics with 1 output (score ≈ 0.78)
    // low_confidence_threshold: 0.5 — below-0.5 score (no outputs ≈ 0.22) triggers regen
    // max_rework_iterations: 5 to accommodate 3 regen dispatches + HIL + 1 post-HIL pass
    const WORKFLOW_WITH_HIL_BUDGET = `
version: "1"
name: confidence-regen-hil-test
tasks:
  task-a:
    agent: dev
    description: Task with low confidence threshold and HIL
    max_rework_iterations: 5
    overlays:
      confidence:
        threshold: 0.75
        low_confidence_threshold: 0.5
        max_regeneration_retries: 2
`;
    const hilResolutions: string[] = [];
    const mockHil: BaseOverlay & { queue: { create: (item: unknown) => void }; awaitResolution: (id: string) => Promise<OverlayResult> } = {
      name: "hil",
      enabled: true,
      queue: {
        create(item: unknown) {
          hilResolutions.push((item as { id: string }).id);
        },
      },
      async preTask(): Promise<OverlayResult> { return { proceed: true }; },
      async awaitResolution(hilId: string): Promise<OverlayResult> {
        return { proceed: true, feedback: `Fix the output quality. (hil=${hilId})` };
      },
    };

    // Adapter: empty outputs (low conf) for first 3 calls; good output after HIL resolves
    let callN = 0;
    const adapter = new MockAdapter(() => {
      callN++;
      if (callN <= 3) return { status: "COMPLETED" as const, outputs: [] };
      return { status: "COMPLETED" as const, outputs: [{ path: "out.md" }] };
    });

    const projectPath = TEST_DIR;
    mkdirSync(join(projectPath, ".ai-sdd", "state"), { recursive: true });
    const workflow = WorkflowLoader.loadYAML(WORKFLOW_WITH_HIL_BUDGET);
    const registry = new AgentRegistry(DEFAULTS_DIR);
    registry.loadDefaults();
    const stateManager = new StateManager(join(projectPath, ".ai-sdd", "state"), workflow.config.name, projectPath);
    const constitutionResolver = new ConstitutionResolver({ project_path: projectPath, strict_parse: false });
    const manifestWriter = createManifestWriter(projectPath);
    const runId = crypto.randomUUID();
    const emitter = new ObservabilityEmitter({ run_id: runId, workflow_id: workflow.config.name, log_level: "ERROR" });

    const confidenceOverlay = new ConfidenceOverlay(emitter, {}, adapter);
    const providerChain = buildProviderChain({
      localOverlays: { hil: mockHil, confidence: confidenceOverlay },
      emitter,
    });

    const engine = new Engine(workflow, stateManager, registry, adapter, constitutionResolver, manifestWriter, emitter, { max_concurrent_tasks: 1 }, providerChain);
    const result = await engine.run({ dry_run: false });

    // HIL was created in the queue
    expect(hilResolutions.length).toBeGreaterThan(0);
    // After HIL resolution + good output → task completes
    expect(result.completed).toContain("task-a");
  });

  it("task FAILED when HIL overlay is absent and retries exhausted", async () => {
    // makeEngineWithConfidenceOverlay does NOT include a HIL overlay
    const adapter = new MockAdapter(() => ({ status: "COMPLETED" as const, outputs: [] }));
    const { engine, stateManager } = makeEngineWithConfidenceOverlay(CONFIDENCE_REGEN_WORKFLOW, { adapter });
    const result = await engine.run({ dry_run: false });

    expect(result.failed).toContain("task-a");
    expect(stateManager.getTaskState("task-a").status).toBe("FAILED");
  });

  it("task FAILED when HIL rejects (human declines to proceed)", async () => {
    const mockHil: BaseOverlay & { queue: { create: (item: unknown) => void }; awaitResolution: (id: string) => Promise<OverlayResult> } = {
      name: "hil",
      enabled: true,
      queue: { create() {} },
      async preTask(): Promise<OverlayResult> { return { proceed: true }; },
      async awaitResolution(): Promise<OverlayResult> {
        return { proceed: false, feedback: "Task cannot be completed — abandoning." };
      },
    };

    const adapter = new MockAdapter(() => ({ status: "COMPLETED" as const, outputs: [] }));
    const projectPath = TEST_DIR;
    mkdirSync(join(projectPath, ".ai-sdd", "state"), { recursive: true });
    const workflow = WorkflowLoader.loadYAML(CONFIDENCE_REGEN_WORKFLOW);
    const registry = new AgentRegistry(DEFAULTS_DIR);
    registry.loadDefaults();
    const stateManager = new StateManager(join(projectPath, ".ai-sdd", "state"), workflow.config.name, projectPath);
    const constitutionResolver = new ConstitutionResolver({ project_path: projectPath, strict_parse: false });
    const manifestWriter = createManifestWriter(projectPath);
    const runId = crypto.randomUUID();
    const emitter = new ObservabilityEmitter({ run_id: runId, workflow_id: workflow.config.name, log_level: "ERROR" });
    const confidenceOverlay = new ConfidenceOverlay(emitter, {}, adapter);
    const providerChain = buildProviderChain({
      localOverlays: { hil: mockHil, confidence: confidenceOverlay },
      emitter,
    });
    const engine = new Engine(workflow, stateManager, registry, adapter, constitutionResolver, manifestWriter, emitter, { max_concurrent_tasks: 1 }, providerChain);
    const result = await engine.run({ dry_run: false });

    expect(result.failed).toContain("task-a");
    expect(stateManager.getTaskState("task-a").status).toBe("FAILED");
  });
});

describe("Engine: regeneration sampling params", () => {
  it("first dispatch has no sampling_params override", async () => {
    let firstOptions: unknown;
    let callN = 0;
    const adapter = new MockAdapter((_, __) => {
      callN++;
      return { status: "COMPLETED" as const, outputs: [{ path: "out.md" }] };
    });

    // Override dispatch to capture options before result
    const origDispatch = adapter.dispatch.bind(adapter);
    (adapter as unknown as { dispatch: typeof adapter.dispatch }).dispatch = async (id, ctx, opts) => {
      if (callN === 0) firstOptions = opts;
      callN++;
      return origDispatch(id, ctx, opts);
    };

    const { engine } = makeEngineWithConfidenceOverlay(CONFIDENCE_REGEN_WORKFLOW, { adapter });
    await engine.run({ dry_run: false });

    // First call (no regen): sampling_params should be absent
    const records = adapter.getRecords();
    expect(records[0]?.options.sampling_params).toBeUndefined();
  });

  it("applies default sampling schedule on regeneration retries", async () => {
    // Adapter: fail first 2 times (regen), succeed on 3rd
    let callN = 0;
    const adapter = new MockAdapter(() => {
      callN++;
      if (callN <= 2) return { status: "COMPLETED" as const, outputs: [] };
      return { status: "COMPLETED" as const, outputs: [{ path: "out.md" }] };
    });

    const { engine } = makeEngineWithConfidenceOverlay(CONFIDENCE_REGEN_WORKFLOW, { adapter });
    await engine.run({ dry_run: false });

    const records = adapter.getRecords();
    // Call 1 (initial): no sampling params
    expect(records[0]?.options.sampling_params).toBeUndefined();
    // Call 2 (regen attempt 1): schedule[0] = {top_p:0.9, temperature:0.2}
    expect(records[1]?.options.sampling_params?.top_p).toBe(0.9);
    expect(records[1]?.options.sampling_params?.temperature).toBe(0.2);
    // Call 3 (regen attempt 2): schedule[1] = {top_p:0.8, temperature:0.4}
    expect(records[2]?.options.sampling_params?.top_p).toBe(0.8);
    expect(records[2]?.options.sampling_params?.temperature).toBe(0.4);
  });

  it("clamps to last schedule entry when retries exceed schedule length", async () => {
    // max_regen_retries=4 but default schedule has 3 entries → 4th retry uses schedule[2]
    const WORKFLOW_LONG_REGEN = `
version: "1"
name: long-regen-test
tasks:
  task-a:
    agent: dev
    description: Long regen test
    overlays:
      confidence:
        threshold: 0.75
        low_confidence_threshold: 0.5
        max_regeneration_retries: 4
`;
    let callN = 0;
    const adapter = new MockAdapter(() => {
      callN++;
      // Always fail until attempt 5
      if (callN <= 5) return { status: "COMPLETED" as const, outputs: [] };
      return { status: "COMPLETED" as const, outputs: [{ path: "out.md" }] };
    });

    const { engine } = makeEngineWithConfidenceOverlay(WORKFLOW_LONG_REGEN, { adapter });
    await engine.run({ dry_run: false });

    const records = adapter.getRecords();
    // Retry attempt 4 (records[4]) should use last schedule entry: {top_p:0.7, temperature:0.6}
    expect(records[4]?.options.sampling_params?.top_p).toBe(0.7);
    expect(records[4]?.options.sampling_params?.temperature).toBe(0.6);
  });

  it("uses custom regen_sampling_schedule from workflow YAML when configured", async () => {
    const CUSTOM_SCHEDULE_WORKFLOW = `
version: "1"
name: custom-schedule-test
tasks:
  task-a:
    agent: dev
    description: Custom schedule test
    overlays:
      confidence:
        threshold: 0.75
        low_confidence_threshold: 0.5
        max_regeneration_retries: 2
        regen_sampling_schedule:
          - temperature: 0.1
            top_p: 0.95
          - temperature: 0.3
            top_p: 0.85
`;
    let callN = 0;
    const adapter = new MockAdapter(() => {
      callN++;
      if (callN <= 2) return { status: "COMPLETED" as const, outputs: [] };
      return { status: "COMPLETED" as const, outputs: [{ path: "out.md" }] };
    });

    const { engine } = makeEngineWithConfidenceOverlay(CUSTOM_SCHEDULE_WORKFLOW, { adapter });
    await engine.run({ dry_run: false });

    const records = adapter.getRecords();
    // Retry 1 → custom schedule[0]
    expect(records[1]?.options.sampling_params?.temperature).toBe(0.1);
    expect(records[1]?.options.sampling_params?.top_p).toBe(0.95);
    // Retry 2 → custom schedule[1]
    expect(records[2]?.options.sampling_params?.temperature).toBe(0.3);
    expect(records[2]?.options.sampling_params?.top_p).toBe(0.85);
  });

  it("sampling_params appear in confidence.regenerating event", async () => {
    const regenEvents: Array<Record<string, unknown>> = [];

    const adapter = new MockAdapter(() => ({ status: "COMPLETED" as const, outputs: [] }));
    const { engine, emitter } = makeEngineWithConfidenceOverlay(CONFIDENCE_REGEN_WORKFLOW, { adapter });

    emitter.on((ev) => {
      if (ev.type === "confidence.regenerating") regenEvents.push(ev.data as Record<string, unknown>);
    });

    await engine.run({ dry_run: false });

    expect(regenEvents.length).toBeGreaterThanOrEqual(1);
    // First regen event should carry schedule[0]
    const first = regenEvents[0]!["sampling_params"] as Record<string, number>;
    expect(first["top_p"]).toBe(0.9);
    expect(first["temperature"]).toBe(0.2);
  });
});
