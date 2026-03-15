/**
 * JiraHierarchySync unit tests.
 *
 * Verifies:
 *  - ensureEpic() creates an Epic and caches it
 *  - ensureEpic() returns cached ref on second call (idempotent)
 *  - syncWorkflow() creates Stories for top-level tasks
 *  - syncWorkflow() creates Subtasks for child tasks
 *  - syncWorkflow() skips already-mapped tasks (idempotent)
 *  - transitionForStatus() maps TaskStatus → Jira status name
 *  - transitionForStatus() no-ops for unmapped tasks
 *  - Mapping persistence: saveMappings / loadMappings round-trip (including epicRef)
 *  - DEFAULT_STATUS_MAP covers all TaskStatus values
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockTaskTrackingAdapter } from "../../../src/collaboration/impl/mock-task-tracking-adapter.ts";
import { JiraHierarchySync, DEFAULT_STATUS_MAP } from "../../../src/collaboration/core/jira-hierarchy-sync.ts";
import type { WorkflowConfig } from "../../../src/types/index.ts";

const TMP_DIR = join(tmpdir(), `jira-hierarchy-test-${process.pid}`);

function makeWorkflow(tasks: Record<string, unknown>): WorkflowConfig {
  return {
    version: "1",
    name: "test-workflow",
    tasks: tasks as WorkflowConfig["tasks"],
    // Minimal execution_plan stub
  } as WorkflowConfig;
}

describe("JiraHierarchySync", () => {
  let adapter: MockTaskTrackingAdapter;
  let sync: JiraHierarchySync;

  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    adapter = new MockTaskTrackingAdapter();
    sync = new JiraHierarchySync("TEST");
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  });

  describe("ensureEpic", () => {
    it("creates an Epic and returns an IssueRef", async () => {
      const epic = await sync.ensureEpic(adapter, "my-workflow");
      expect(epic.key).toMatch(/^MOCK-/);
      expect(sync.getEpicRef()?.key).toBe(epic.key);
    });

    it("returns cached ref on second call (idempotent)", async () => {
      const first = await sync.ensureEpic(adapter, "my-workflow");
      const second = await sync.ensureEpic(adapter, "my-workflow");
      expect(first.key).toBe(second.key);
    });

    it("throws if createEpic fails", async () => {
      adapter = new MockTaskTrackingAdapter({
        failOn: { method: "createEpic", error: { code: "AUTH", message: "Unauthorized", retryable: false } },
      });
      sync = new JiraHierarchySync("TEST");
      await expect(sync.ensureEpic(adapter, "wf")).rejects.toThrow("Failed to create Jira epic");
    });
  });

  describe("syncWorkflow", () => {
    it("creates Story for each top-level task", async () => {
      const workflow = makeWorkflow({
        "define-requirements": { description: "BA requirements" },
        "design-l1":           { description: "Architecture" },
      });
      const epic = await sync.ensureEpic(adapter, "test-workflow");
      const result = await sync.syncWorkflow(adapter, workflow, epic);

      expect(result.created).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(sync.getMappings()).toHaveLength(2);
    });

    it("creates Subtasks for child tasks (with group field)", async () => {
      const workflow = makeWorkflow({
        "plan-tasks": { description: "Planning group" },
        "impl-auth":  { description: "Implement auth", group: "plan-tasks" },
        "impl-api":   { description: "Implement API", group: "plan-tasks" },
      });
      const epic = await sync.ensureEpic(adapter, "test-workflow");
      const result = await sync.syncWorkflow(adapter, workflow, epic);

      expect(result.errors).toHaveLength(0);
      const mappings = sync.getMappings();
      const subtasks = mappings.filter(m => m.issue_type === "Subtask");
      expect(subtasks).toHaveLength(2);
      subtasks.forEach(s => expect(s.parent_key).toBeDefined());
    });

    it("skips already-mapped tasks (idempotent)", async () => {
      const workflow = makeWorkflow({
        "task-a": { description: "Task A" },
      });
      const epic = await sync.ensureEpic(adapter, "test-workflow");
      await sync.syncWorkflow(adapter, workflow, epic);
      const result2 = await sync.syncWorkflow(adapter, workflow, epic);

      expect(result2.created).toBe(0);
      expect(result2.skipped).toBe(1);
    });

    it("records errors without throwing", async () => {
      adapter = new MockTaskTrackingAdapter({
        failOn: { method: "createTask", error: { code: "NETWORK", message: "timeout", retryable: true } },
      });
      sync = new JiraHierarchySync("TEST");
      const epicResult = await adapter.createEpic("TEST", "epic", "");
      if (!epicResult.ok) throw new Error("createEpic failed unexpectedly");
      const workflow = makeWorkflow({ "task-a": { description: "Task A" } });
      // Use a fresh adapter that fails createTask
      const result = await sync.syncWorkflow(adapter, workflow, epicResult.value);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe("transitionForStatus", () => {
    it("transitions the mapped issue to the correct Jira status", async () => {
      const workflow = makeWorkflow({ "task-a": { description: "Task A" } });
      const epic = await sync.ensureEpic(adapter, "wf");
      await sync.syncWorkflow(adapter, workflow, epic);

      // task-a should be in "Backlog" initially; transition to "In Progress"
      await sync.transitionForStatus(adapter, "task-a", "RUNNING");
      const mapping = sync.getMapping("task-a")!;
      const taskResult = await adapter.getTask({ provider: "mock", key: mapping.issue_key, id: mapping.issue_key, url: "" });
      expect(taskResult.ok).toBe(true);
      if (taskResult.ok) expect(taskResult.value.status).toBe("In Progress");
    });

    it("no-ops for unmapped tasks (no throw)", async () => {
      await expect(
        sync.transitionForStatus(adapter, "nonexistent-task", "COMPLETED"),
      ).resolves.toBeUndefined();
    });

    it("no-ops for unknown status in statusMap", async () => {
      const workflow = makeWorkflow({ "task-a": {} });
      const epic = await sync.ensureEpic(adapter, "wf");
      await sync.syncWorkflow(adapter, workflow, epic);
      await expect(
        sync.transitionForStatus(adapter, "task-a", "UNKNOWN_STATUS" as AnyStatus),
      ).resolves.toBeUndefined();
    });
  });

  describe("DEFAULT_STATUS_MAP", () => {
    const ALL_STATUSES = [
      "PENDING", "RUNNING", "COMPLETED", "NEEDS_REWORK",
      "HIL_PENDING", "FAILED", "CANCELLED",
      "AWAITING_APPROVAL", "APPROVED", "DOING",
    ];

    it("covers all known TaskStatus values", () => {
      for (const status of ALL_STATUSES) {
        expect(DEFAULT_STATUS_MAP[status]).toBeDefined();
      }
    });

    it("maps COMPLETED to Done", () => expect(DEFAULT_STATUS_MAP["COMPLETED"]).toBe("Done"));
    it("maps RUNNING to In Progress", () => expect(DEFAULT_STATUS_MAP["RUNNING"]).toBe("In Progress"));
    it("maps FAILED to Blocked", () => expect(DEFAULT_STATUS_MAP["FAILED"]).toBe("Blocked"));
    it("maps HIL_PENDING to In Review", () => expect(DEFAULT_STATUS_MAP["HIL_PENDING"]).toBe("In Review"));
  });

  describe("mapping persistence", () => {
    it("saveMappings + loadMappings round-trip (including epicRef)", async () => {
      const mappingPath = join(TMP_DIR, "jira-mappings.json");
      const workflow = makeWorkflow({
        "task-a": { description: "Task A" },
      });
      const epic = await sync.ensureEpic(adapter, "my-workflow");
      await sync.syncWorkflow(adapter, workflow, epic);
      await sync.saveMappings(mappingPath);

      const sync2 = new JiraHierarchySync("TEST");
      await sync2.loadMappings(mappingPath);
      expect(sync2.getMappings()).toHaveLength(1);
      expect(sync2.getEpicRef()?.key).toBe(epic.key);
    });

    it("loadMappings no-ops on missing file", async () => {
      await expect(
        sync.loadMappings(join(TMP_DIR, "nonexistent.json")),
      ).resolves.toBeUndefined();
      expect(sync.getMappings()).toHaveLength(0);
    });

    it("throws on schema version mismatch", async () => {
      const badPath = join(TMP_DIR, "bad.json");
      writeFileSync(badPath, JSON.stringify({
        schema_version: "99",
        project_key: "TEST",
        saved_at: new Date().toISOString(),
        mappings: [],
      }));
      await expect(sync.loadMappings(badPath)).rejects.toThrow("schema version mismatch");
    });

    it("throws on invalid JSON", async () => {
      const badPath = join(TMP_DIR, "invalid.json");
      writeFileSync(badPath, "not-json");
      await expect(sync.loadMappings(badPath)).rejects.toThrow("not valid JSON");
    });

    it("atomic write: no .tmp file left behind", async () => {
      const mappingPath = join(TMP_DIR, "jira-mappings.json");
      await sync.saveMappings(mappingPath);
      expect(existsSync(mappingPath)).toBe(true);
      expect(existsSync(mappingPath + ".tmp")).toBe(false);
    });
  });
});

// Type alias to allow passing unknown status strings in tests without TS errors
type AnyStatus = Parameters<JiraHierarchySync["transitionForStatus"]>[2];
