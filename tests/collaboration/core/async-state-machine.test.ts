/**
 * Tests for async state machine extensions.
 * Covers T-001 acceptance criteria.
 */

import { describe, it, expect } from "bun:test";
import { VALID_TRANSITIONS, ASYNC_ONLY_STATUSES } from "../../../src/types/index.ts";
import { StateError } from "../../../src/core/state-manager.ts";
import { StateManager } from "../../../src/core/state-manager.ts";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sdd-async-test-"));
}

describe("Async state machine extensions", () => {
  describe("VALID_TRANSITIONS includes async states", () => {
    it("AWAITING_APPROVAL transitions to APPROVED, FAILED, CANCELLED", () => {
      const allowed = VALID_TRANSITIONS["AWAITING_APPROVAL"];
      expect(allowed).toContain("APPROVED");
      expect(allowed).toContain("FAILED");
      expect(allowed).toContain("CANCELLED");
    });

    it("APPROVED transitions to DOING only", () => {
      const allowed = VALID_TRANSITIONS["APPROVED"];
      expect(allowed).toContain("DOING");
      expect(allowed).toHaveLength(1);
    });

    it("DOING transitions to AWAITING_APPROVAL, COMPLETED, FAILED, CANCELLED", () => {
      const allowed = VALID_TRANSITIONS["DOING"];
      expect(allowed).toContain("AWAITING_APPROVAL");
      expect(allowed).toContain("COMPLETED");
      expect(allowed).toContain("FAILED");
      expect(allowed).toContain("CANCELLED");
    });

    it("RUNNING can transition to AWAITING_APPROVAL (async fork)", () => {
      const allowed = VALID_TRANSITIONS["RUNNING"];
      expect(allowed).toContain("AWAITING_APPROVAL");
    });
  });

  describe("ASYNC_ONLY_STATUSES set", () => {
    it("contains AWAITING_APPROVAL, APPROVED, DOING", () => {
      expect(ASYNC_ONLY_STATUSES.has("AWAITING_APPROVAL")).toBe(true);
      expect(ASYNC_ONLY_STATUSES.has("APPROVED")).toBe(true);
      expect(ASYNC_ONLY_STATUSES.has("DOING")).toBe(true);
    });

    it("does NOT contain sync states", () => {
      expect(ASYNC_ONLY_STATUSES.has("PENDING")).toBe(false);
      expect(ASYNC_ONLY_STATUSES.has("RUNNING")).toBe(false);
      expect(ASYNC_ONLY_STATUSES.has("COMPLETED")).toBe(false);
      expect(ASYNC_ONLY_STATUSES.has("FAILED")).toBe(false);
    });
  });

  describe("StateManager mode guard", () => {
    it("allows async transitions when mode is async", () => {
      const dir = makeTempDir();
      try {
        const sm = new StateManager(dir, "test-wf", "/project");
        sm.load();
        sm.initializeTasks(["task1"]);
        sm.transition("task1", "RUNNING");

        // Should not throw for async mode.
        expect(() => {
          sm.transition("task1", "AWAITING_APPROVAL", {}, "async");
        }).not.toThrow();
      } finally {
        rmSync(dir, { recursive: true });
      }
    });

    it("rejects AWAITING_APPROVAL transition for sync task", () => {
      const dir = makeTempDir();
      try {
        const sm = new StateManager(dir, "test-wf", "/project");
        sm.load();
        sm.initializeTasks(["task1"]);
        sm.transition("task1", "RUNNING");

        // Should throw for sync mode.
        expect(() => {
          sm.transition("task1", "AWAITING_APPROVAL", {}, "sync");
        }).toThrow(StateError);
      } finally {
        rmSync(dir, { recursive: true });
      }
    });

    it("rejects AWAITING_APPROVAL when mode is omitted (defaults to sync)", () => {
      const dir = makeTempDir();
      try {
        const sm = new StateManager(dir, "test-wf", "/project");
        sm.load();
        sm.initializeTasks(["task1"]);
        sm.transition("task1", "RUNNING");

        expect(() => {
          sm.transition("task1", "AWAITING_APPROVAL");
        }).toThrow(StateError);
      } finally {
        rmSync(dir, { recursive: true });
      }
    });

    it("rejects APPROVED transition for sync task", () => {
      const dir = makeTempDir();
      try {
        const sm = new StateManager(dir, "test-wf", "/project");
        sm.load();
        sm.initializeTasks(["task1"]);
        sm.transition("task1", "RUNNING");
        sm.transition("task1", "AWAITING_APPROVAL", {}, "async");

        expect(() => {
          sm.transition("task1", "APPROVED", {}, "sync");
        }).toThrow(StateError);
      } finally {
        rmSync(dir, { recursive: true });
      }
    });

    it("full async lifecycle: RUNNING→AWAITING_APPROVAL→APPROVED→DOING→COMPLETED", () => {
      const dir = makeTempDir();
      try {
        const sm = new StateManager(dir, "test-wf", "/project");
        sm.load();
        sm.initializeTasks(["task1"]);

        sm.transition("task1", "RUNNING");
        expect(sm.getTaskState("task1").status).toBe("RUNNING");

        sm.transition("task1", "AWAITING_APPROVAL", {}, "async");
        expect(sm.getTaskState("task1").status).toBe("AWAITING_APPROVAL");

        sm.transition("task1", "APPROVED", {}, "async");
        expect(sm.getTaskState("task1").status).toBe("APPROVED");

        sm.transition("task1", "DOING", {}, "async");
        expect(sm.getTaskState("task1").status).toBe("DOING");

        sm.transition("task1", "COMPLETED", {}, "async");
        expect(sm.getTaskState("task1").status).toBe("COMPLETED");
      } finally {
        rmSync(dir, { recursive: true });
      }
    });

    it("rejection loop: AWAITING_APPROVAL→DOING→AWAITING_APPROVAL", () => {
      const dir = makeTempDir();
      try {
        const sm = new StateManager(dir, "test-wf", "/project");
        sm.load();
        sm.initializeTasks(["task1"]);

        sm.transition("task1", "RUNNING");
        sm.transition("task1", "AWAITING_APPROVAL", {}, "async");
        sm.transition("task1", "DOING", {}, "async"); // rejection

        expect(sm.getTaskState("task1").status).toBe("DOING");

        // Back to AWAITING_APPROVAL for next review cycle.
        sm.transition("task1", "AWAITING_APPROVAL", {}, "async");
        expect(sm.getTaskState("task1").status).toBe("AWAITING_APPROVAL");
      } finally {
        rmSync(dir, { recursive: true });
      }
    });

    it("existing sync transitions are unchanged", () => {
      const dir = makeTempDir();
      try {
        const sm = new StateManager(dir, "test-wf", "/project");
        sm.load();
        sm.initializeTasks(["task1"]);

        sm.transition("task1", "RUNNING");
        sm.transition("task1", "NEEDS_REWORK");
        sm.transition("task1", "RUNNING");
        sm.transition("task1", "COMPLETED");

        expect(sm.getTaskState("task1").status).toBe("COMPLETED");
      } finally {
        rmSync(dir, { recursive: true });
      }
    });
  });
});
