/**
 * T004: State manager tests
 */

import { describe, it, expect, afterEach } from "bun:test";
import { StateManager, StateError } from "../src/core/state-manager.ts";
import { rmSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const TEST_STATE_DIR = "/tmp/ai-sdd-test-state";

function makeManager(): StateManager {
  return new StateManager(TEST_STATE_DIR, "test-workflow", "/test/project");
}

afterEach(() => {
  try { rmSync(TEST_STATE_DIR, { recursive: true }); } catch { /* ignore */ }
});

describe("StateManager: initialization", () => {
  it("creates state directory on persist", () => {
    const sm = makeManager();
    sm.initializeTasks(["task-a", "task-b"]);
    // State dir should be created
    const stateFile = join(TEST_STATE_DIR, "workflow-state.json");
    expect(existsSync(stateFile)).toBe(true);
  });

  it("initializes tasks with PENDING status", () => {
    const sm = makeManager();
    sm.initializeTasks(["task-a", "task-b"]);
    expect(sm.getTaskState("task-a").status).toBe("PENDING");
    expect(sm.getTaskState("task-b").status).toBe("PENDING");
  });

  it("skips already-initialized tasks", () => {
    const sm = makeManager();
    sm.initializeTasks(["task-a"]);
    sm.transition("task-a", "RUNNING");
    sm.initializeTasks(["task-a", "task-b"]);
    // task-a should still be RUNNING, not reset to PENDING
    expect(sm.getTaskState("task-a").status).toBe("RUNNING");
  });
});

describe("StateManager: transitions", () => {
  it("PENDING → RUNNING is valid", () => {
    const sm = makeManager();
    sm.initializeTasks(["t"]);
    sm.transition("t", "RUNNING");
    expect(sm.getTaskState("t").status).toBe("RUNNING");
  });

  it("RUNNING → COMPLETED is valid", () => {
    const sm = makeManager();
    sm.initializeTasks(["t"]);
    sm.transition("t", "RUNNING");
    sm.transition("t", "COMPLETED");
    expect(sm.getTaskState("t").status).toBe("COMPLETED");
  });

  it("RUNNING → NEEDS_REWORK is valid", () => {
    const sm = makeManager();
    sm.initializeTasks(["t"]);
    sm.transition("t", "RUNNING");
    sm.transition("t", "NEEDS_REWORK");
    expect(sm.getTaskState("t").status).toBe("NEEDS_REWORK");
  });

  it("RUNNING → HIL_PENDING is valid", () => {
    const sm = makeManager();
    sm.initializeTasks(["t"]);
    sm.transition("t", "RUNNING");
    sm.transition("t", "HIL_PENDING");
    expect(sm.getTaskState("t").status).toBe("HIL_PENDING");
  });

  it("COMPLETED → RUNNING is invalid", () => {
    const sm = makeManager();
    sm.initializeTasks(["t"]);
    sm.transition("t", "RUNNING");
    sm.transition("t", "COMPLETED");
    expect(() => sm.transition("t", "RUNNING")).toThrow(StateError);
  });

  it("PENDING → COMPLETED is invalid (must go through RUNNING)", () => {
    const sm = makeManager();
    sm.initializeTasks(["t"]);
    expect(() => sm.transition("t", "COMPLETED")).toThrow(StateError);
  });

  it("FAILED → any is invalid (terminal)", () => {
    const sm = makeManager();
    sm.initializeTasks(["t"]);
    sm.transition("t", "RUNNING");
    sm.transition("t", "FAILED");
    expect(() => sm.transition("t", "RUNNING")).toThrow(StateError);
  });
});

describe("StateManager: persistence (schema version)", () => {
  it("rejects mismatched schema_version on load", () => {
    const stateFile = join(TEST_STATE_DIR, "workflow-state.json");
    mkdirSync(TEST_STATE_DIR, { recursive: true });
    const { writeFileSync } = require("fs");
    writeFileSync(stateFile, JSON.stringify({
      schema_version: "99",
      workflow: "test",
      project: "/test",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tasks: {},
    }));
    const sm = makeManager();
    expect(() => sm.load()).toThrow("schema version mismatch");
  });
});

describe("StateManager: queries", () => {
  it("getTasksByStatus returns correct IDs", () => {
    const sm = makeManager();
    sm.initializeTasks(["a", "b", "c"]);
    sm.transition("a", "RUNNING");
    sm.transition("a", "COMPLETED");
    const completed = sm.getTasksByStatus("COMPLETED");
    expect(completed).toContain("a");
    expect(completed).not.toContain("b");
  });

  it("isTerminal() returns true when all tasks are done", () => {
    const sm = makeManager();
    sm.initializeTasks(["a", "b"]);
    sm.transition("a", "RUNNING");
    sm.transition("a", "COMPLETED");
    sm.transition("b", "RUNNING");
    sm.transition("b", "FAILED");
    expect(sm.isTerminal()).toBe(true);
  });

  it("isTerminal() returns false when tasks are pending", () => {
    const sm = makeManager();
    sm.initializeTasks(["a", "b"]);
    sm.transition("a", "RUNNING");
    sm.transition("a", "COMPLETED");
    expect(sm.isTerminal()).toBe(false);
  });
});
