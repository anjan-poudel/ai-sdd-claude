/**
 * Jira adapter tests — mock adapter behavior, multi-hop transitions, fixture-based parsing.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { MockTaskTrackingAdapter } from "../../../../src/collaboration/impl/mock-task-tracking-adapter.ts";

const FIXTURES_DIR = join(import.meta.dir, "../../../fixtures/jira");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));
}

describe("MockTaskTrackingAdapter (Jira-style)", () => {
  it("creates an epic and returns a ref", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const result = await adapter.createEpic("PROJ", "Feature Epic", "Epic description", ["ai-sdd"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider).toBe("mock");
    expect(result.value.key).toMatch(/^MOCK-\d+$/);
  });

  it("creates a task and links to epic", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const epicResult = await adapter.createEpic("PROJ", "Feature Epic", "Description");
    if (!epicResult.ok) return;

    const taskResult = await adapter.createTask("PROJ", epicResult.value, "Child Task", "Task description");
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    expect(taskResult.value.key).toMatch(/^MOCK-\d+$/);

    // Verify parent key is set.
    const getResult = await adapter.getTask(taskResult.value);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.parent_key).toBe(epicResult.value.key);
  });

  it("updates a task's fields", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("PROJ", null, "Original Title", "Description");
    if (!createResult.ok) return;

    const updateResult = await adapter.updateTask(createResult.value, { summary: "Updated Title" });
    expect(updateResult.ok).toBe(true);

    const getResult = await adapter.getTask(createResult.value);
    if (!getResult.ok) return;
    expect(getResult.value.summary).toBe("Updated Title");
  });

  it("transitions task through the state machine", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("PROJ", null, "Task", "Desc");
    if (!createResult.ok) return;

    const transitionResult = await adapter.transitionTask(createResult.value, "In Progress");
    expect(transitionResult.ok).toBe(true);

    const getResult = await adapter.getTask(createResult.value);
    if (!getResult.ok) return;
    expect(getResult.value.status).toBe("In Progress");
  });

  it("returns VALIDATION error for impossible transition", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("PROJ", null, "Task", "Desc");
    if (!createResult.ok) return;

    // "Backlog" → "Nonexistent Status" has no path.
    const result = await adapter.transitionTask(createResult.value, "Nonexistent Status");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
  });

  it("multi-hop transition: Backlog → Done via In Progress", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("PROJ", null, "Task", "Desc");
    if (!createResult.ok) return;

    // Backlog → Done requires path: Backlog→In Progress→Done.
    const result = await adapter.transitionTask(createResult.value, "Done");
    expect(result.ok).toBe(true);

    const getResult = await adapter.getTask(createResult.value);
    if (!getResult.ok) return;
    expect(getResult.value.status).toBe("Done");
  });

  it("adds labels to a task", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("PROJ", null, "Task", "Desc");
    if (!createResult.ok) return;

    await adapter.addLabel(createResult.value, "ai-sdd");
    await adapter.addLabel(createResult.value, "feature");

    const getResult = await adapter.getTask(createResult.value);
    if (!getResult.ok) return;
    expect(getResult.value.labels).toContain("ai-sdd");
    expect(getResult.value.labels).toContain("feature");
  });

  it("does not add duplicate labels", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("PROJ", null, "Task", "Desc", { labels: ["ai-sdd"] });
    if (!createResult.ok) return;

    await adapter.addLabel(createResult.value, "ai-sdd");

    const getResult = await adapter.getTask(createResult.value);
    if (!getResult.ok) return;
    expect(getResult.value.labels.filter(l => l === "ai-sdd")).toHaveLength(1);
  });

  it("lists tasks with status filter", async () => {
    const adapter = new MockTaskTrackingAdapter();
    await adapter.createTask("PROJ", null, "Task 1", "Desc");
    const task2 = await adapter.createTask("PROJ", null, "Task 2", "Desc");
    if (!task2.ok) return;
    await adapter.transitionTask(task2.value, "In Progress");

    const result = await adapter.listTasks("PROJ", { status: "In Progress" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const firstTask = result.value[0];
    expect(firstTask).toBeDefined();
    if (!firstTask) return;
    expect(firstTask.summary).toBe("Task 2");
  });

  it("returns NOT_FOUND for unknown task", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const result = await adapter.getTask({ provider: "mock", key: "MOCK-999", id: "MOCK-999", url: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("Jira fixtures (Dev Standard #4)", () => {
  it("validates create-issue-response fixture structure", () => {
    const fixture = loadFixture("create-issue-response.json") as {
      id: string;
      key: string;
      self: string;
    };
    expect(fixture.id).toBeTruthy();
    expect(fixture.key).toMatch(/^[A-Z]+-\d+$/);
    expect(fixture.self).toContain("/rest/api/3/issue/");
  });

  it("validates transitions-response fixture structure", () => {
    const fixture = loadFixture("transitions-response.json") as {
      transitions: Array<{ id: string; name: string; to: { name: string } }>;
    };
    expect(Array.isArray(fixture.transitions)).toBe(true);
    expect(fixture.transitions.length).toBeGreaterThan(0);
    for (const t of fixture.transitions) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.to.name).toBeTruthy();
    }
  });
});
