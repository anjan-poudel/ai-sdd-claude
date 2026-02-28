/**
 * T005: HIL queue tests
 */

import { describe, it, expect, afterEach } from "bun:test";
import { HilQueue } from "../src/overlays/hil/hil-queue.ts";
import { rmSync } from "fs";
import type { HilItem } from "../src/types/index.ts";

const TEST_HIL_DIR = "/tmp/ai-sdd-hil-test";

afterEach(() => {
  try { rmSync(TEST_HIL_DIR, { recursive: true }); } catch { /* ignore */ }
});

function makeItem(id: string): HilItem {
  return {
    id,
    task_id: `task-${id}`,
    workflow_id: "test-wf",
    status: "PENDING",
    reason: "Test HIL item",
    context: {},
    created_at: new Date().toISOString(),
  };
}

describe("HilQueue", () => {
  it("creates and retrieves a HIL item", () => {
    const queue = new HilQueue(TEST_HIL_DIR);
    const item = makeItem("hil-001");
    queue.create(item);

    const retrieved = queue.get("hil-001");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("hil-001");
    expect(retrieved!.status).toBe("PENDING");
  });

  it("lists all PENDING items", () => {
    const queue = new HilQueue(TEST_HIL_DIR);
    queue.create(makeItem("hil-001"));
    queue.create(makeItem("hil-002"));

    const items = queue.list("PENDING");
    expect(items).toHaveLength(2);
  });

  it("resolve() transitions to RESOLVED with notes", () => {
    const queue = new HilQueue(TEST_HIL_DIR);
    queue.create(makeItem("hil-001"));

    const resolved = queue.resolve("hil-001", "Looks good");
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.notes).toBe("Looks good");
    expect(resolved.resolved_at).toBeDefined();
  });

  it("reject() transitions to REJECTED with reason", () => {
    const queue = new HilQueue(TEST_HIL_DIR);
    queue.create(makeItem("hil-001"));

    const rejected = queue.reject("hil-001", "Not approved");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejection_reason).toBe("Not approved");
    expect(rejected.rejected_at).toBeDefined();
  });

  it("ack() transitions to ACKED", () => {
    const queue = new HilQueue(TEST_HIL_DIR);
    queue.create(makeItem("hil-001"));

    const acked = queue.ack("hil-001");
    expect(acked.status).toBe("ACKED");
    expect(acked.acked_at).toBeDefined();
  });

  it("list() with filter returns only matching items", () => {
    const queue = new HilQueue(TEST_HIL_DIR);
    queue.create(makeItem("hil-001"));
    queue.create(makeItem("hil-002"));
    queue.resolve("hil-001");

    const pending = queue.list("PENDING");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe("hil-002");

    const resolved = queue.list("RESOLVED");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.id).toBe("hil-001");
  });

  it("get() returns null for unknown ID", () => {
    const queue = new HilQueue(TEST_HIL_DIR);
    expect(queue.get("nonexistent")).toBeNull();
  });

  it("waitForResolution resolves immediately for pre-resolved item", async () => {
    const queue = new HilQueue(TEST_HIL_DIR);
    queue.create(makeItem("hil-001"));
    queue.resolve("hil-001", "Approved");

    const resolved = await queue.waitForResolution("hil-001", 100, 5000);
    expect(resolved.status).toBe("RESOLVED");
  });
});
