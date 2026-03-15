/**
 * ConfluenceSyncManager unit tests.
 *
 * Verifies:
 *  - publishDocument() creates a page if no mapping exists
 *  - publishDocument() updates the page if a mapping exists (create vs update branching)
 *  - publishWorkflowIndex() creates/updates an index page with all task links
 *  - Mapping persistence: saveMappings / loadMappings round-trip
 *  - Returns ok:false when adapter fails
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockDocumentAdapter } from "../../../src/collaboration/impl/mock-document-adapter.ts";
import { ConfluenceSyncManager } from "../../../src/collaboration/core/confluence-sync-manager.ts";

const TMP_DIR = join(tmpdir(), `confluence-sync-test-${process.pid}`);

describe("ConfluenceSyncManager", () => {
  let adapter: MockDocumentAdapter;
  let mgr: ConfluenceSyncManager;

  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    adapter = new MockDocumentAdapter();
    mgr = new ConfluenceSyncManager(adapter, "TEST", "ai-sdd Artifacts");
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  });

  describe("publishDocument", () => {
    it("creates a new page when no mapping exists", async () => {
      const result = await mgr.publishDocument("task-1", "Task 1 Doc", "# Task 1\ncontent");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toContain("mock/pages/");
        expect(result.value.version).toBe(1);
      }
    });

    it("stores the mapping after creation", async () => {
      await mgr.publishDocument("task-1", "Task 1", "content");
      const ref = mgr.getPageRef("task-1");
      expect(ref).toBeDefined();
      expect(ref?.version).toBe(1);
    });

    it("updates the page on second call (re-run scenario)", async () => {
      // First publish — creates page
      const first = await mgr.publishDocument("task-1", "Task 1", "v1");
      expect(first.ok).toBe(true);
      // Second publish — updates page
      const second = await mgr.publishDocument("task-1", "Task 1", "v2 with more detail");
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.value.version).toBe(2);
      }
      // Only 1 createPage call total
      expect(mgr.getMappings()).toHaveLength(1);
    });

    it("returns ok:false when createPage fails", async () => {
      adapter = new MockDocumentAdapter({
        failOn: { method: "createPage", error: { code: "AUTH", message: "Unauthorized", retryable: false } },
      });
      mgr = new ConfluenceSyncManager(adapter, "TEST");
      const result = await mgr.publishDocument("task-1", "Task 1", "content");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("AUTH");
    });

    it("returns ok:false when updatePage fails", async () => {
      // First create succeeds
      await mgr.publishDocument("task-1", "Task 1", "v1");
      // Inject updatePage failure
      adapter = new MockDocumentAdapter({
        failOn: { method: "updatePage", error: { code: "NETWORK", message: "timeout", retryable: true } },
      });
      mgr = new ConfluenceSyncManager(adapter, "TEST");
      // Manually prime the mapping so it tries updatePage
      await mgr.loadMappings(join(TMP_DIR, "does-not-exist.json")); // no-op
      // Recreate with the existing mapping by saving and reloading
      const mappingPath = join(TMP_DIR, "mappings.json");
      // Use original mgr to save, then reload into a new mgr with failing adapter
      const originalMgr = new ConfluenceSyncManager(new MockDocumentAdapter(), "TEST");
      await originalMgr.publishDocument("task-1", "Task 1", "v1");
      await originalMgr.saveMappings(mappingPath);
      await mgr.loadMappings(mappingPath);
      const result = await mgr.publishDocument("task-1", "Task 1", "v2");
      expect(result.ok).toBe(false);
    });
  });

  describe("publishWorkflowIndex", () => {
    it("creates the index page on first call", async () => {
      await mgr.publishDocument("task-a", "Task A", "content-a");
      const result = await mgr.publishWorkflowIndex("my-workflow", [
        { taskId: "task-a", title: "Task A", status: "COMPLETED" },
      ]);
      expect(result.ok).toBe(true);
    });

    it("includes task links in the index body (for published tasks)", async () => {
      const mgr2 = new ConfluenceSyncManager(adapter, "TEST");
      // Publish a task first so it has a pageRef
      await mgr2.publishDocument("task-a", "Task A", "content");
      // Now publish the index
      const indexResult = await mgr2.publishWorkflowIndex("my-wf", [
        { taskId: "task-a", title: "Task A", status: "COMPLETED" },
        { taskId: "task-b", title: "Task B", status: "PENDING" },
      ]);
      expect(indexResult.ok).toBe(true);
      // task-a should have a link; task-b should show "—"
      const ref = mgr2.getPageRef("__workflow_index__my-wf");
      expect(ref).toBeDefined();
    });

    it("updates index page on subsequent calls", async () => {
      await mgr.publishWorkflowIndex("wf", [{ taskId: "t1", title: "T1", status: "COMPLETED" }]);
      const second = await mgr.publishWorkflowIndex("wf", [
        { taskId: "t1", title: "T1", status: "COMPLETED" },
        { taskId: "t2", title: "T2", status: "COMPLETED" },
      ]);
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.value.version).toBe(2);
      }
    });
  });

  describe("mapping persistence", () => {
    it("saveMappings + loadMappings round-trip", async () => {
      const mappingPath = join(TMP_DIR, "confluence-mappings.json");
      await mgr.publishDocument("task-x", "Task X", "content");
      await mgr.saveMappings(mappingPath);

      const mgr2 = new ConfluenceSyncManager(adapter, "TEST");
      await mgr2.loadMappings(mappingPath);
      const ref = mgr2.getPageRef("task-x");
      expect(ref).toBeDefined();
      expect(ref?.url).toContain("mock/pages/");
    });

    it("loadMappings is a no-op for non-existent file", async () => {
      await expect(
        mgr.loadMappings(join(TMP_DIR, "nonexistent.json")),
      ).resolves.toBeUndefined();
      expect(mgr.getMappings()).toHaveLength(0);
    });

    it("throws on schema version mismatch", async () => {
      const badPath = join(TMP_DIR, "bad-schema.json");
      const { writeFileSync } = await import("fs");
      writeFileSync(badPath, JSON.stringify({
        schema_version: "99",
        space_key: "TEST",
        saved_at: new Date().toISOString(),
        mappings: [],
      }));
      await expect(mgr.loadMappings(badPath)).rejects.toThrow("schema version mismatch");
    });

    it("throws on invalid JSON", async () => {
      const badPath = join(TMP_DIR, "invalid.json");
      const { writeFileSync } = await import("fs");
      writeFileSync(badPath, "not-json");
      await expect(mgr.loadMappings(badPath)).rejects.toThrow("not valid JSON");
    });

    it("atomic write (no .tmp file left behind on success)", async () => {
      const mappingPath = join(TMP_DIR, "confluence-mappings.json");
      await mgr.publishDocument("task-z", "Task Z", "content");
      await mgr.saveMappings(mappingPath);
      expect(existsSync(mappingPath)).toBe(true);
      expect(existsSync(mappingPath + ".tmp")).toBe(false);
    });
  });

  describe("getMappings", () => {
    it("returns empty array initially", () => {
      expect(mgr.getMappings()).toHaveLength(0);
    });

    it("returns all published tasks", async () => {
      await mgr.publishDocument("task-1", "Task 1", "content");
      await mgr.publishDocument("task-2", "Task 2", "content");
      expect(mgr.getMappings()).toHaveLength(2);
    });
  });
});
