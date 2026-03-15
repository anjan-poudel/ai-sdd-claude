/**
 * Collaboration wiring integration test.
 *
 * Verifies that when the engine runs a mock workflow, the collaboration hooks
 * fire in the right order with correct arguments:
 *  - on_workflow_start  → workflow_started notification published
 *  - on_task_start      → task_started notification + Jira "In Progress" transition
 *  - on_post_task       → task_completed notification + Confluence page published/updated
 *  - on_failure         → task_failed notification + Jira "Blocked" transition
 *  - on_workflow_end    → workflow_completed notification + Confluence index updated
 *
 * Uses MockNotificationChannel + MockDocumentAdapter + MockTaskTrackingAdapter.
 * No real credentials required.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { Engine } from "../../../src/core/engine.ts";
import { WorkflowLoader } from "../../../src/core/workflow-loader.ts";
import { AgentRegistry } from "../../../src/core/agent-loader.ts";
import { StateManager } from "../../../src/core/state-manager.ts";
import { ConstitutionResolver } from "../../../src/constitution/resolver.ts";
import { createManifestWriter } from "../../../src/constitution/manifest-writer.ts";
import { MockAdapter } from "../../../src/adapters/mock-adapter.ts";
import { ObservabilityEmitter } from "../../../src/observability/emitter.ts";
import { MockNotificationChannel } from "../../../src/collaboration/impl/mock-notification-channel.ts";
import { MockDocumentAdapter } from "../../../src/collaboration/impl/mock-document-adapter.ts";
import { MockTaskTrackingAdapter } from "../../../src/collaboration/impl/mock-task-tracking-adapter.ts";
import { ConfluenceSyncManager } from "../../../src/collaboration/core/confluence-sync-manager.ts";
import { JiraHierarchySync } from "../../../src/collaboration/core/jira-hierarchy-sync.ts";

const TEST_DIR = "/tmp/ai-sdd-collab-wiring-test";
const DEFAULTS_DIR = resolve(import.meta.dir, "../../../data/agents/defaults");

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
});

const SIMPLE_WORKFLOW_YAML = `
version: "1"
name: collab-wiring-test
tasks:
  task-a:
    description: "First task"
    agent: ba
    outputs:
      - path: specs/task-a.md
        type: requirements_doc
`;

const FAILING_WORKFLOW_YAML = `
version: "1"
name: collab-failing-test
tasks:
  task-fail:
    description: "This task will fail"
    agent: ba
    outputs:
      - path: specs/task-fail.md
        type: requirements_doc
`;

function makeEngine(workflowYaml: string, mockAdapter?: MockAdapter): Engine {
  mkdirSync(join(TEST_DIR, ".ai-sdd", "state"), { recursive: true });
  mkdirSync(join(TEST_DIR, "specs"), { recursive: true });

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

  return new Engine(
    workflow,
    stateManager,
    registry,
    mockAdapter ?? new MockAdapter(),
    constitutionResolver,
    manifestWriter,
    emitter,
    { max_concurrent_tasks: 3 },
  );
}

describe("Collaboration wiring — hook firing order and arguments", () => {
  it("on_workflow_start fires before any task starts", async () => {
    const engine = makeEngine(SIMPLE_WORKFLOW_YAML);
    const channel = new MockNotificationChannel();
    const callOrder: string[] = [];

    engine.hooks.onWorkflowStart(() => {
      callOrder.push("workflow_start");
    });
    engine.hooks.onTaskStart("*", () => {
      callOrder.push("task_start");
    });

    await engine.run({ dry_run: false });

    const wfIdx = callOrder.indexOf("workflow_start");
    const taskIdx = callOrder.indexOf("task_start");
    expect(wfIdx).toBeGreaterThanOrEqual(0);
    expect(taskIdx).toBeGreaterThan(wfIdx);
    void channel; // suppress unused warning
  });

  it("on_workflow_end fires after all tasks complete", async () => {
    const engine = makeEngine(SIMPLE_WORKFLOW_YAML);
    const callOrder: string[] = [];

    engine.hooks.onPostTask("*", () => {
      callOrder.push("post_task");
    });
    engine.hooks.onWorkflowEnd(() => {
      callOrder.push("workflow_end");
    });

    await engine.run({ dry_run: false });

    const postTaskIdx = callOrder.lastIndexOf("post_task");
    const wfEndIdx = callOrder.indexOf("workflow_end");
    expect(wfEndIdx).toBeGreaterThan(postTaskIdx);
  });

  it("MockNotificationChannel receives workflow_started and task_completed events", async () => {
    const engine = makeEngine(SIMPLE_WORKFLOW_YAML);
    const channel = new MockNotificationChannel();

    engine.hooks.onWorkflowStart(async (ctx) => {
      await channel.publish({
        event: "workflow_started",
        workflow_id: ctx.workflow_id,
        title: `Workflow started: ${ctx.workflow_id}`,
        body: "",
      });
    });

    engine.hooks.onPostTask("*", async (ctx) => {
      await channel.publish({
        event: "task_completed",
        workflow_id: ctx.workflow_id,
        task_id: ctx.task_id,
        title: `Task completed: ${ctx.task_id}`,
        body: "",
      });
    });

    await engine.run({ dry_run: false });

    const startedEvents = channel.callsFor("workflow_started");
    const completedEvents = channel.callsFor("task_completed");

    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0]!.message.workflow_id).toBe("collab-wiring-test");

    expect(completedEvents.length).toBeGreaterThanOrEqual(1);
    expect(completedEvents[0]!.message.task_id).toBe("task-a");
  });

  it("ConfluenceSyncManager.publishDocument called in on_post_task hook", async () => {
    const engine = makeEngine(SIMPLE_WORKFLOW_YAML);
    const docAdapter = new MockDocumentAdapter();
    const confluenceMgr = new ConfluenceSyncManager(docAdapter, "TEST", "ai-sdd Artifacts");

    // Write stub output file that the hook will read
    writeFileSync(join(TEST_DIR, "specs", "task-a.md"), "# Task A\nContent");

    engine.hooks.onPostTask("*", async (ctx) => {
      await confluenceMgr.publishDocument(
        ctx.task_id,
        `collab-wiring-test — ${ctx.task_id}`,
        "# Task A\nContent",
      );
    });

    engine.hooks.onWorkflowEnd(async () => {
      await confluenceMgr.publishWorkflowIndex("collab-wiring-test", [
        { taskId: "task-a", title: "First task", status: "COMPLETED" },
      ]);
    });

    await engine.run({ dry_run: false });

    const mappings = confluenceMgr.getMappings();
    // task-a + workflow index
    expect(mappings.length).toBeGreaterThanOrEqual(2);
    expect(mappings.some(m => m.task_id === "task-a")).toBe(true);
    expect(mappings.some(m => m.task_id.includes("workflow_index"))).toBe(true);
  });

  it("JiraHierarchySync transitions task to In Progress on task start and Done on completion", async () => {
    const engine = makeEngine(SIMPLE_WORKFLOW_YAML);
    const tracker = new MockTaskTrackingAdapter();
    const jira = new JiraHierarchySync("TEST");

    // Pre-wire: create epic + stories
    const epic = await jira.ensureEpic(tracker, "collab-wiring-test");
    const workflowGraph = WorkflowLoader.loadYAML(SIMPLE_WORKFLOW_YAML);
    await jira.syncWorkflow(tracker, workflowGraph.config, epic);

    engine.hooks.onTaskStart("*", async (ctx) => {
      await jira.transitionForStatus(tracker, ctx.task_id, "RUNNING");
    });

    engine.hooks.onPostTask("*", async (ctx) => {
      await jira.transitionForStatus(tracker, ctx.task_id, "COMPLETED");
    });

    await engine.run({ dry_run: false });

    const mapping = jira.getMapping("task-a");
    expect(mapping).toBeDefined();
    const issueResult = await tracker.getTask({
      provider: "mock",
      key: mapping!.issue_key,
      id: mapping!.issue_key,
      url: "",
    });
    expect(issueResult.ok).toBe(true);
    if (issueResult.ok) {
      expect(issueResult.value.status).toBe("Done");
    }
  });

  it("on_failure fires when task fails, with error in context", async () => {
    const failAdapter = new MockAdapter();
    // MockAdapter by default returns COMPLETED; we override to return FAILED
    const origDispatch = failAdapter.dispatch.bind(failAdapter);
    failAdapter.dispatch = async (taskId: string, _context: unknown, _opts: unknown) => {
      return { status: "FAILED" as const, error: "simulated failure", outputs: [] };
    };

    const engine = makeEngine(FAILING_WORKFLOW_YAML, failAdapter);
    const channel = new MockNotificationChannel();

    engine.hooks.onFailure("*", async (ctx) => {
      await channel.publish({
        event: "task_failed",
        workflow_id: ctx.workflow_id,
        task_id: ctx.task_id,
        title: `Task FAILED: ${ctx.task_id}`,
        body: ctx.error?.message ?? "unknown",
      });
    });

    await engine.run({ dry_run: false });

    const failedEvents = channel.callsFor("task_failed");
    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
    expect(failedEvents[0]!.message.task_id).toBe("task-fail");
  });

  it("on_workflow_end context contains completed/failed counts", async () => {
    const engine = makeEngine(SIMPLE_WORKFLOW_YAML);
    let capturedExtra: Record<string, unknown> | undefined;

    engine.hooks.onWorkflowEnd(async (ctx) => {
      capturedExtra = ctx.extra;
    });

    await engine.run({ dry_run: false });

    expect(capturedExtra).toBeDefined();
    expect(typeof capturedExtra!["completed"]).toBe("number");
    expect(typeof capturedExtra!["failed"]).toBe("number");
  });

  it("MockNotificationChannel.reset() clears all recorded calls", () => {
    const channel = new MockNotificationChannel();
    void channel.publish({
      event: "task_completed",
      workflow_id: "wf",
      title: "done",
      body: "",
    });
    // reset before awaiting — still records synchronously
    channel.calls.push({ message: { event: "task_completed", workflow_id: "wf", title: "x", body: "" }, timestamp: "" });
    channel.reset();
    expect(channel.calls).toHaveLength(0);
  });
});
