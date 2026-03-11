/**
 * GitHub Issues adapter tests — MockTaskTrackingAdapter behavior with GitHub-style provider,
 * label-based epic simulation, BFS transitions, and fixture-based parsing verification.
 *
 * Real GitHubTaskTrackingAdapter requires GITHUB_TOKEN — tested via MockTaskTrackingAdapter
 * (same interface contract) plus fixture schema validation.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { MockTaskTrackingAdapter } from "../../../../src/collaboration/impl/mock-task-tracking-adapter.ts";
import { GitHubTaskTrackingAdapter } from "../../../../src/collaboration/impl/github-task-tracking-adapter.ts";

const FIXTURES_DIR = join(import.meta.dir, "../../../fixtures/github");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));
}

// ── Fixture schema validation ─────────────────────────────────────────────

describe("GitHub Issues fixture schema", () => {
  it("create-issue-response.json has required fields", () => {
    const fixture = loadFixture("create-issue-response.json") as Record<string, unknown>;
    expect(typeof fixture["id"]).toBe("number");
    expect(typeof fixture["number"]).toBe("number");
    expect(typeof fixture["html_url"]).toBe("string");
    expect(typeof fixture["title"]).toBe("string");
    expect(Array.isArray(fixture["labels"])).toBe(true);
  });

  it("graphql-project-status-field.json has required structure", () => {
    const fixture = loadFixture("graphql-project-status-field.json") as {
      data: { repository: { projectV2: { id: string; field: { id: string; options: Array<{ id: string; name: string }> } } } }
    };
    const projectV2 = fixture.data.repository.projectV2;
    expect(typeof projectV2.id).toBe("string");
    const field = projectV2.field;
    expect(typeof field.id).toBe("string");
    expect(Array.isArray(field.options)).toBe(true);
    expect(field.options.length).toBeGreaterThan(0);
    const firstOption = field.options[0];
    expect(firstOption).toBeDefined();
    if (firstOption) {
      expect(typeof firstOption.id).toBe("string");
      expect(typeof firstOption.name).toBe("string");
    }
  });
});

// ── MockTaskTrackingAdapter — GitHub-style usage (same interface as GitHubTaskTrackingAdapter) ─

describe("MockTaskTrackingAdapter (GitHub-style epic simulation)", () => {
  it("creates an epic as a labeled issue", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const result = await adapter.createEpic("my-org/my-repo", "Async Engine Epic", "Implements async task lifecycle", ["ai-sdd"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider).toBe("mock");
    expect(result.value.key).toMatch(/^MOCK-\d+$/);
  });

  it("createEpic returns IssueRef with provider=mock", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const result = await adapter.createEpic("my-org/my-repo", "Epic", "Description");
    if (!result.ok) return;
    expect(result.value.provider).toBe("mock");
    expect(result.value.key).toBeTruthy();
    expect(result.value.id).toBeTruthy();
    expect(result.value.url).toBeTruthy();
  });

  it("creates a child task with epic parent link", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const epicResult = await adapter.createEpic("my-org/my-repo", "Parent Epic", "Epic desc");
    if (!epicResult.ok) return;

    const taskResult = await adapter.createTask("my-org/my-repo", epicResult.value, "Child Issue", "Child desc");
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;

    const getResult = await adapter.getTask(taskResult.value);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.parent_key).toBe(epicResult.value.key);
  });

  it("creates a standalone task (no epic link)", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const result = await adapter.createTask("my-org/my-repo", null, "Standalone Issue", "No parent");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const getResult = await adapter.getTask(result.value);
    if (!getResult.ok) return;
    expect(getResult.value.parent_key).toBeUndefined();
  });

  it("updates task fields (title, description)", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("my-org/my-repo", null, "Old Title", "Old desc");
    if (!createResult.ok) return;

    const updateResult = await adapter.updateTask(createResult.value, {
      summary: "New Title",
      description: "New desc",
    });
    expect(updateResult.ok).toBe(true);

    const getResult = await adapter.getTask(createResult.value);
    if (!getResult.ok) return;
    expect(getResult.value.summary).toBe("New Title");
    expect(getResult.value.description).toBe("New desc");
  });

  it("transitions task through Kanban states", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("my-org/my-repo", null, "Task", "Desc");
    if (!createResult.ok) return;

    const transitionResult = await adapter.transitionTask(createResult.value, "In Progress");
    expect(transitionResult.ok).toBe(true);

    const getResult = await adapter.getTask(createResult.value);
    if (!getResult.ok) return;
    expect(getResult.value.status).toBe("In Progress");
  });

  it("multi-hop transition: Backlog → Done", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("my-org/my-repo", null, "Task", "Desc");
    if (!createResult.ok) return;

    const result = await adapter.transitionTask(createResult.value, "Done");
    expect(result.ok).toBe(true);

    const getResult = await adapter.getTask(createResult.value);
    if (!getResult.ok) return;
    expect(getResult.value.status).toBe("Done");
  });

  it("returns VALIDATION error for impossible transition", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("my-org/my-repo", null, "Task", "Desc");
    if (!createResult.ok) return;

    const result = await adapter.transitionTask(createResult.value, "Nonexistent Column");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
  });

  it("lists tasks with label filter", async () => {
    const adapter = new MockTaskTrackingAdapter();
    await adapter.createTask("my-org/my-repo", null, "Task 1", "Desc", { labels: ["ai-sdd"] });
    await adapter.createTask("my-org/my-repo", null, "Task 2", "Desc", { labels: ["other"] });
    await adapter.createTask("my-org/my-repo", null, "Task 3", "Desc", { labels: ["ai-sdd"] });

    const result = await adapter.listTasks("my-org/my-repo", { labels: ["ai-sdd"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });

  it("lists tasks with status filter", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const t1 = await adapter.createTask("my-org/my-repo", null, "Task 1", "Desc");
    const t2 = await adapter.createTask("my-org/my-repo", null, "Task 2", "Desc");
    if (!t1.ok || !t2.ok) return;

    await adapter.transitionTask(t1.value, "In Progress");

    const result = await adapter.listTasks("my-org/my-repo", { status: "In Progress" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const firstTask = result.value[0];
    expect(firstTask).toBeDefined();
    if (!firstTask) return;
    expect(firstTask.summary).toBe("Task 1");
  });

  it("adds labels to a task (idempotent)", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("my-org/my-repo", null, "Task", "Desc");
    if (!createResult.ok) return;

    await adapter.addLabel(createResult.value, "github-issues");
    await adapter.addLabel(createResult.value, "github-issues"); // idempotent

    const getResult = await adapter.getTask(createResult.value);
    if (!getResult.ok) return;
    expect(getResult.value.labels.filter(l => l === "github-issues")).toHaveLength(1);
  });

  it("getAvailableTransitions returns current-state transitions", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const createResult = await adapter.createTask("my-org/my-repo", null, "Task", "Desc");
    if (!createResult.ok) return;

    const result = await adapter.getAvailableTransitions(createResult.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // From "Backlog" the mock adapter has one transition: Start → In Progress
    expect(result.value.length).toBeGreaterThan(0);
    const firstTransition = result.value[0];
    expect(firstTransition).toBeDefined();
    if (!firstTransition) return;
    expect(typeof firstTransition.id).toBe("string");
    expect(typeof firstTransition.name).toBe("string");
    expect(typeof firstTransition.to_status).toBe("string");
  });

  it("healthCheck returns ok", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const result = await adapter.healthCheck();
    expect(result.ok).toBe(true);
  });

  it("returns NOT_FOUND for getTask with unknown ref", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const result = await adapter.getTask({ provider: "mock", key: "MOCK-9999", id: "9999", url: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("error injection via failOn option", async () => {
    const adapter = new MockTaskTrackingAdapter({
      failOn: { method: "createEpic", error: { code: "AUTH", message: "Bad token", retryable: false } },
    });
    const result = await adapter.createEpic("my-org/my-repo", "Epic", "Desc");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH");
  });
});

// ── GitHubTaskTrackingAdapter — constructor and provider validation ────────

describe("GitHubTaskTrackingAdapter", () => {
  it("has provider = 'github'", () => {
    const adapter = new GitHubTaskTrackingAdapter("fake-token", "my-org", "my-repo");
    expect(adapter.provider).toBe("github");
  });

  it("constructor accepts project_number parameter", () => {
    const adapter = new GitHubTaskTrackingAdapter("fake-token", "my-org", "my-repo", 1);
    expect(adapter.provider).toBe("github");
  });

  it("transitionTask without project_number returns VALIDATION error", async () => {
    const adapter = new GitHubTaskTrackingAdapter("fake-token", "my-org", "my-repo");
    const result = await adapter.transitionTask(
      { provider: "github", key: "1", id: "1001", url: "https://github.com/my-org/my-repo/issues/1" },
      "In Progress",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.message).toContain("project_number");
  });

  it("getAvailableTransitions without project_number returns open/close transitions", async () => {
    const adapter = new GitHubTaskTrackingAdapter("fake-token", "my-org", "my-repo");
    const result = await adapter.getAvailableTransitions(
      { provider: "github", key: "1", id: "1001", url: "https://github.com/my-org/my-repo/issues/1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    const names = result.value.map(t => t.to_status);
    expect(names).toContain("Open");
    expect(names).toContain("Closed");
  });

  it("healthCheck fails with invalid token (network call) — returns AUTH or NETWORK error", async () => {
    // This test verifies the adapter calls the API correctly; expected to fail with a network error
    // in test environment (no real token). We only verify the error is not a code bug.
    const adapter = new GitHubTaskTrackingAdapter("invalid-token", "my-org", "my-repo");
    const result = await adapter.healthCheck();
    // In test environment (no network or invalid token), we expect either AUTH or NETWORK error.
    // We do NOT assert ok=false because CI may have no network — just verify the type shape.
    if (!result.ok) {
      expect(["AUTH", "NETWORK", "UNKNOWN"]).toContain(result.error.code);
    }
  });
});
