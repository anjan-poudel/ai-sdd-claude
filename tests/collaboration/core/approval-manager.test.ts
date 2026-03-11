/**
 * Tests for ApprovalManager.
 * Covers deduplication, threshold checking, and rejection veto model.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { DefaultApprovalManager } from "../../../src/collaboration/core/approval-manager.ts";
import { StateManager } from "../../../src/core/state-manager.ts";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ApprovalSignal, RejectionSignal } from "../../../src/collaboration/types.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sdd-approval-test-"));
}

function makeApproval(stakeholderId: string, notes?: string): ApprovalSignal {
  return {
    stakeholder_id: stakeholderId,
    timestamp: new Date().toISOString(),
    source: `slack:test/${Date.now()}`,
    notes,
  };
}

function makeRejection(stakeholderId: string, feedback: string): RejectionSignal {
  return {
    stakeholder_id: stakeholderId,
    timestamp: new Date().toISOString(),
    source: `slack:test/${Date.now()}`,
    feedback,
  };
}

describe("ApprovalManager", () => {
  let dir: string;
  let sm: StateManager;
  let manager: DefaultApprovalManager;

  beforeEach(() => {
    dir = makeTempDir();
    sm = new StateManager(dir, "test-wf", "/project");
    sm.load();
    sm.initializeTasks(["task1", "task2"]);
    sm.transition("task1", "RUNNING");
    sm.transition("task1", "AWAITING_APPROVAL", {}, "async");

    manager = new DefaultApprovalManager(
      sm,
      new Map([["task1", 2], ["task2", 1]]), // task1 needs 2 approvals
    );
  });

  it("should be defined after each (cleanup)", () => {
    rmSync(dir, { recursive: true });
  });

  describe("recordApproval", () => {
    it("accepts first approval from a stakeholder", () => {
      const result = manager.recordApproval("task1", makeApproval("user1"));
      expect(result.accepted).toBe(true);
      expect(result.approval_status.received).toBe(1);
      expect(result.approval_status.required).toBe(2);
      expect(result.triggered_transition).toBeNull();
      expect(result.approval_status.threshold_met).toBe(false);
      rmSync(dir, { recursive: true });
    });

    it("deduplicates second approval from same stakeholder", () => {
      manager.recordApproval("task1", makeApproval("user1"));
      const result = manager.recordApproval("task1", makeApproval("user1"));
      expect(result.accepted).toBe(false);
      expect(result.approval_status.received).toBe(1); // still 1
      rmSync(dir, { recursive: true });
    });

    it("triggers APPROVED transition when threshold met", () => {
      manager.recordApproval("task1", makeApproval("user1"));
      const result = manager.recordApproval("task1", makeApproval("user2"));
      expect(result.accepted).toBe(true);
      expect(result.approval_status.threshold_met).toBe(true);
      expect(result.triggered_transition).toBe("APPROVED");
      rmSync(dir, { recursive: true });
    });

    it("accepts min_approvals=0 as auto-advance (threshold immediately met)", () => {
      const autoManager = new DefaultApprovalManager(sm, new Map([["task1", 0]]));
      const result = autoManager.recordApproval("task1", makeApproval("user1"));
      // With 0 required, any approval count >= 0 is sufficient but first signal triggers it.
      // Actually min=0 means threshold is met with 0 approvals.
      const status = autoManager.getStatus("task1");
      expect(status.threshold_met).toBe(true); // 1 >= 0
      rmSync(dir, { recursive: true });
    });

    it("returns ok:false for unknown task", () => {
      const result = manager.recordApproval("nonexistent", makeApproval("user1"));
      expect(result.accepted).toBe(false);
      rmSync(dir, { recursive: true });
    });
  });

  describe("recordRejection", () => {
    it("accepts rejection and sets triggered_transition to DOING", () => {
      const result = manager.recordRejection("task1", makeRejection("user1", "Needs more detail"));
      expect(result.accepted).toBe(true);
      expect(result.triggered_transition).toBe("DOING");
      expect(result.feedback).toBe("Needs more detail");
      rmSync(dir, { recursive: true });
    });

    it("rejection increments phase (resets approval cycle)", () => {
      // Get initial phase.
      const beforeStatus = manager.getStatus("task1");
      expect(beforeStatus.phase).toBe(1);

      manager.recordRejection("task1", makeRejection("user1", "Rejected"));

      const afterStatus = manager.getStatus("task1");
      expect(afterStatus.phase).toBe(2);
      expect(afterStatus.received).toBe(0); // cleared
      rmSync(dir, { recursive: true });
    });

    it("single rejection vetoes regardless of prior approvals", () => {
      manager.recordApproval("task1", makeApproval("user1")); // 1 of 2
      const rejectResult = manager.recordRejection("task1", makeRejection("user2", "Rejected"));
      expect(rejectResult.triggered_transition).toBe("DOING");
      rmSync(dir, { recursive: true });
    });
  });

  describe("getStatus", () => {
    it("returns empty status for task with no signals", () => {
      const status = manager.getStatus("task1");
      expect(status.task_id).toBe("task1");
      expect(status.received).toBe(0);
      expect(status.required).toBe(2);
      expect(status.threshold_met).toBe(false);
      rmSync(dir, { recursive: true });
    });
  });

  describe("isThresholdMet", () => {
    it("returns false before threshold", () => {
      manager.recordApproval("task1", makeApproval("user1"));
      expect(manager.isThresholdMet("task1")).toBe(false);
      rmSync(dir, { recursive: true });
    });

    it("returns true after threshold", () => {
      manager.recordApproval("task1", makeApproval("user1"));
      manager.recordApproval("task1", makeApproval("user2"));
      expect(manager.isThresholdMet("task1")).toBe(true);
      rmSync(dir, { recursive: true });
    });
  });

  describe("resetForNewCycle", () => {
    it("increments phase and clears approvals", () => {
      manager.recordApproval("task1", makeApproval("user1"));
      manager.resetForNewCycle("task1");

      const status = manager.getStatus("task1");
      expect(status.phase).toBe(2);
      expect(status.received).toBe(0);
      rmSync(dir, { recursive: true });
    });
  });
});
