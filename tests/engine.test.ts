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
import { rmSync, mkdirSync } from "fs";
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
