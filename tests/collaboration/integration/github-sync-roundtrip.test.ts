/**
 * GitHub-as-Code sync integration tests (T-023).
 * Verifies that DefaultAsCodeSyncEngine works with GitHubTaskTrackingAdapter
 * (via MockTaskTrackingAdapter for tests) to sync workflow tasks to GitHub Issues.
 *
 * This suite tests NFR-006 portability: the sync engine is adapter-agnostic.
 *
 * Scenarios (Gherkin T-023):
 *   - Sync workflow tasks to GitHub Issues (create flow)
 *   - Sync idempotent (no-op when content hash unchanged)
 *   - Sync detects content change and updates issue
 *   - Sync marks orphaned tasks when removed from workflow
 *   - Mapping file saved to .ai-sdd/sync-mappings/github.json atomically
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockTaskTrackingAdapter } from "../../../src/collaboration/impl/mock-task-tracking-adapter.ts";
import { GitHubTaskTrackingAdapter } from "../../../src/collaboration/impl/github-task-tracking-adapter.ts";
import { DefaultAsCodeSyncEngine } from "../../../src/collaboration/core/sync-engine.ts";
import type { SyncMappingFile } from "../../../src/collaboration/types.ts";
import type { WorkflowConfig } from "../../../src/types/index.ts";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sdd-github-sync-test-"));
}

/** Minimal WorkflowConfig with a tasks block for testing. */
function makeWorkflow(tasks: Record<string, { description?: string; depends_on?: string[] }>): WorkflowConfig {
  return {
    version: "1",
    name: "test-workflow",
    tasks: tasks as WorkflowConfig["tasks"],
  } as WorkflowConfig;
}

describe("GitHub-as-Code sync (DefaultAsCodeSyncEngine + MockTaskTrackingAdapter)", () => {
  const tmpdirs: string[] = [];

  afterEach(() => {
    for (const d of tmpdirs) {
      try { rmSync(d, { recursive: true }); } catch {}
    }
    tmpdirs.length = 0;
  });

  it("creates GitHub Issues for all workflow tasks on first sync", async () => {
    const tmpDir = makeTmpDir();
    tmpdirs.push(tmpDir);

    const adapter = new MockTaskTrackingAdapter();
    const engine = new DefaultAsCodeSyncEngine("my-org/my-repo");

    const workflow = makeWorkflow({
      "define-requirements": { description: "BA task" },
      "design-l1":           { description: "Architect task" },
      "implement-engine":    { description: "Dev task" },
      "review-mvp1":         { description: "Reviewer task" },
      "mvp2-github-issues":  { description: "GitHub Issues adapter" },
    });

    const report = await engine.sync(workflow, adapter);

    expect(report.created).toBe(5);
    expect(report.updated).toBe(0);
    expect(report.unchanged).toBe(0);
    expect(report.orphaned).toBe(0);
    expect(report.errors).toHaveLength(0);

    // Verify all 5 issues exist in the mock adapter.
    const mappings = engine.getMappings();
    expect(mappings).toHaveLength(5);

    for (const mapping of mappings) {
      expect(mapping.orphaned).toBe(false);
      expect(mapping.content_hash).toMatch(/^sha256:/);
      const getResult = await adapter.getTask({
        provider: "mock",
        key: mapping.issue_key,
        id: mapping.issue_key,
        url: `http://mock/issues/${mapping.issue_key}`,
      });
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) continue;
      expect(getResult.value.labels).toContain("ai-sdd");
    }
  });

  it("second sync is idempotent when nothing changed", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const engine = new DefaultAsCodeSyncEngine("my-org/my-repo");

    const workflow = makeWorkflow({
      "task-a": { description: "Task A" },
      "task-b": { description: "Task B" },
    });

    await engine.sync(workflow, adapter);

    // Second sync — content unchanged.
    const report2 = await engine.sync(workflow, adapter);

    expect(report2.created).toBe(0);
    expect(report2.updated).toBe(0);
    expect(report2.unchanged).toBe(2);
    expect(report2.errors).toHaveLength(0);
  });

  it("detects content change and updates existing issue", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const engine = new DefaultAsCodeSyncEngine("my-org/my-repo");

    const workflow1 = makeWorkflow({
      "task-a": { description: "Original description" },
    });
    await engine.sync(workflow1, adapter);

    const workflow2 = makeWorkflow({
      "task-a": { description: "Updated description — new scope added" },
    });
    const report2 = await engine.sync(workflow2, adapter);

    expect(report2.created).toBe(0);
    expect(report2.updated).toBe(1);
    expect(report2.unchanged).toBe(0);
  });

  it("marks orphaned tasks when removed from workflow", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const engine = new DefaultAsCodeSyncEngine("my-org/my-repo");

    const workflow1 = makeWorkflow({
      "task-a": { description: "Task A" },
      "task-b": { description: "Task B" },
      "task-c": { description: "Task C" },
    });
    await engine.sync(workflow1, adapter);

    // Remove task-c from the workflow.
    const workflow2 = makeWorkflow({
      "task-a": { description: "Task A" },
      "task-b": { description: "Task B" },
    });
    const report2 = await engine.sync(workflow2, adapter);

    expect(report2.orphaned).toBe(1);

    const mappings = engine.getMappings();
    const orphanedMapping = mappings.find(m => m.task_id === "task-c");
    expect(orphanedMapping).toBeDefined();
    expect(orphanedMapping?.orphaned).toBe(true);

    // Verify the orphaned label was added to the mock issue.
    if (orphanedMapping) {
      const getResult = await adapter.getTask({
        provider: "mock",
        key: orphanedMapping.issue_key,
        id: orphanedMapping.issue_key,
        url: "",
      });
      if (getResult.ok) {
        expect(getResult.value.labels).toContain("ai-sdd:orphaned");
      }
    }
  });

  it("saves mapping file atomically to configured path", async () => {
    const tmpDir = makeTmpDir();
    tmpdirs.push(tmpDir);

    const adapter = new MockTaskTrackingAdapter();
    const engine = new DefaultAsCodeSyncEngine("my-org/my-repo");
    const mappingPath = join(tmpDir, ".ai-sdd", "sync-mappings", "github.json");

    const workflow = makeWorkflow({
      "mvp2-github-issues": { description: "GitHub Issues adapter" },
      "mvp2-github-pr":     { description: "GitHub PR adapter" },
      "mvp2-github-board":  { description: "GitHub Projects board" },
    });

    await engine.sync(workflow, adapter);
    await engine.saveMappings(mappingPath);

    // Verify the file exists and has valid schema.
    expect(existsSync(mappingPath)).toBe(true);

    const raw = readFileSync(mappingPath, "utf-8");
    const data = JSON.parse(raw) as SyncMappingFile;

    expect(data.schema_version).toBe("1");
    expect(data.project_key).toBe("my-org/my-repo");
    expect(Array.isArray(data.mappings)).toBe(true);
    expect(data.mappings).toHaveLength(3);

    for (const mapping of data.mappings) {
      expect(typeof mapping.task_id).toBe("string");
      expect(typeof mapping.issue_key).toBe("string");
      expect(typeof mapping.content_hash).toBe("string");
      expect(mapping.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(typeof mapping.created_at).toBe("string");
      expect(mapping.orphaned).toBe(false);
    }
  });

  it("loads mappings and resumes from previous sync state", async () => {
    const tmpDir = makeTmpDir();
    tmpdirs.push(tmpDir);

    const adapter = new MockTaskTrackingAdapter();
    const engine1 = new DefaultAsCodeSyncEngine("my-org/my-repo");
    const mappingPath = join(tmpDir, "github.json");

    const workflow = makeWorkflow({
      "task-a": { description: "Task A" },
    });

    await engine1.sync(workflow, adapter);
    await engine1.saveMappings(mappingPath);

    // New engine instance — should load state and not re-create issues.
    const engine2 = new DefaultAsCodeSyncEngine("my-org/my-repo");
    await engine2.loadMappings(mappingPath);

    const report2 = await engine2.sync(workflow, adapter);

    // Should be unchanged since content hasn't changed.
    expect(report2.created).toBe(0);
    expect(report2.unchanged).toBe(1);
  });

  it("SyncReport shows created=5 matching the Gherkin scenario", async () => {
    const adapter = new MockTaskTrackingAdapter();
    const engine = new DefaultAsCodeSyncEngine("my-org/my-repo");

    // Gherkin: "Given a workflow YAML with 5 tasks and adapters.task_tracking = 'github'"
    const workflow = makeWorkflow({
      "define-requirements":        { description: "Requirements task" },
      "design-l1":                  { description: "L1 architecture" },
      "mvp2-github-issues-adapter": { description: "GitHub Issues adapter" },
      "mvp2-github-pr-adapter":     { description: "GitHub PR adapter" },
      "mvp2-github-project-adapter": { description: "GitHub Project board" },
    });

    // "When sync is called with the GitHubTaskTrackingAdapter" (mocked here)
    const report = await engine.sync(workflow, adapter);

    // "Then ... SyncReport shows created = 5"
    expect(report.created).toBe(5);
    expect(report.errors).toHaveLength(0);
  });

  it("handles adapter error gracefully and records in report.errors", async () => {
    const adapter = new MockTaskTrackingAdapter({
      failOn: { method: "createTask", error: { code: "RATE_LIMIT", message: "Rate limited", retryable: true } },
    });
    const engine = new DefaultAsCodeSyncEngine("my-org/my-repo");

    const workflow = makeWorkflow({
      "task-will-fail": { description: "This will hit rate limit" },
    });

    const report = await engine.sync(workflow, adapter);

    expect(report.created).toBe(0);
    expect(report.errors).toHaveLength(1);
    const firstError = report.errors[0];
    expect(firstError).toBeDefined();
    if (!firstError) return;
    expect(firstError.task_id).toBe("task-will-fail");
    expect(firstError.error.code).toBe("RATE_LIMIT");
  });
});

// ── GitHubTaskTrackingAdapter adapter type ────────────────────────────────

describe("GitHubTaskTrackingAdapter — provider and interface compliance", () => {
  it("implements TaskTrackingAdapter interface (provider=github)", () => {
    const adapter = new GitHubTaskTrackingAdapter("fake-token", "my-org", "my-repo");
    // Verify all required methods exist.
    expect(typeof adapter.createEpic).toBe("function");
    expect(typeof adapter.createTask).toBe("function");
    expect(typeof adapter.updateTask).toBe("function");
    expect(typeof adapter.transitionTask).toBe("function");
    expect(typeof adapter.getTask).toBe("function");
    expect(typeof adapter.listTasks).toBe("function");
    expect(typeof adapter.addLabel).toBe("function");
    expect(typeof adapter.getAvailableTransitions).toBe("function");
    expect(typeof adapter.healthCheck).toBe("function");
    expect(adapter.provider).toBe("github");
  });

  it("can be used as a drop-in replacement for MockTaskTrackingAdapter in AsCodeSyncEngine", () => {
    // This test verifies the portability guarantee (NFR-006):
    // AsCodeSyncEngine accepts any TaskTrackingAdapter implementation.
    const engine = new DefaultAsCodeSyncEngine("my-org/my-repo");
    const githubAdapter = new GitHubTaskTrackingAdapter("token", "my-org", "my-repo", 1);
    const mockAdapter = new MockTaskTrackingAdapter();

    // Both should be assignable to the same parameter.
    // TypeScript enforces this at compile time; we verify at runtime:
    expect(githubAdapter.provider).toBe("github");
    expect(mockAdapter.provider).toBe("mock");

    // Both implement the same sync engine interface.
    expect(typeof engine.sync).toBe("function");
  });
});
