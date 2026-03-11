/**
 * Tests for AsyncTaskManager.
 * Covers T-002 acceptance criteria.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { AsyncTaskManager } from "../../../src/collaboration/core/async-task-manager.ts";
import { DefaultApprovalManager } from "../../../src/collaboration/core/approval-manager.ts";
import { DefaultCollaborationEventBus } from "../../../src/collaboration/core/event-bus.ts";
import { MockNotificationAdapter } from "../../../src/collaboration/impl/mock-notification-adapter.ts";
import { StateManager } from "../../../src/core/state-manager.ts";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CollaborationEvent } from "../../../src/collaboration/types.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sdd-async-mgr-test-"));
}

describe("AsyncTaskManager", () => {
  let dir: string;
  let sm: StateManager;
  let notifAdapter: MockNotificationAdapter;
  let approvalMgr: DefaultApprovalManager;
  let eventBus: DefaultCollaborationEventBus;
  let manager: AsyncTaskManager;
  const CHANNEL = "#test-channel";

  beforeEach(() => {
    dir = makeTempDir();
    sm = new StateManager(dir, "test-wf", "/project");
    sm.load();
    sm.initializeTasks(["async-task", "sync-task"]);
    sm.transition("async-task", "RUNNING");
    sm.transition("sync-task", "RUNNING");

    notifAdapter = new MockNotificationAdapter();
    eventBus = new DefaultCollaborationEventBus();
    approvalMgr = new DefaultApprovalManager(sm, new Map([["async-task", 1]]));

    manager = new AsyncTaskManager(
      sm,
      approvalMgr,
      notifAdapter,
      eventBus,
      CHANNEL,
    );
  });

  afterEach(async () => {
    await manager.stopAll();
    rmSync(dir, { recursive: true });
  });

  describe("startAsyncCycle", () => {
    it("transitions task to AWAITING_APPROVAL", async () => {
      await manager.startAsyncCycle("async-task", { mode: "async", min_approvals: 1, approval_timeout_seconds: 0 }, []);
      expect(sm.getTaskState("async-task").status).toBe("AWAITING_APPROVAL");
    });

    it("posts notification to Slack channel", async () => {
      await manager.startAsyncCycle("async-task", { mode: "async", min_approvals: 1, approval_timeout_seconds: 0 }, [
        { path: "specs/async-task-notes.md" },
      ]);
      const postCall = notifAdapter.calls.find(c => c.method === "postNotification");
      expect(postCall).toBeDefined();
      const [channel, message] = postCall!.args as [string, { task_id: string }];
      expect(channel).toBe(CHANNEL);
      expect(message.task_id).toBe("async-task");
    });

    it("starts polling listener", async () => {
      await manager.startAsyncCycle("async-task", { mode: "async", min_approvals: 1, approval_timeout_seconds: 0 }, []);
      const listenerCall = notifAdapter.calls.find(c => c.method === "startListener");
      expect(listenerCall).toBeDefined();
    });

    it("emits async.cycle.started event", async () => {
      const events: CollaborationEvent[] = [];
      eventBus.subscribeAll(e => events.push(e));

      await manager.startAsyncCycle("async-task", { mode: "async", min_approvals: 1, approval_timeout_seconds: 0 }, []);

      const cycleEvent = events.find(e => e.type === "async.cycle.started");
      expect(cycleEvent).toBeDefined();
      expect(cycleEvent!.task_id).toBe("async-task");
    });

    it("persists async_state on task", async () => {
      await manager.startAsyncCycle("async-task", { mode: "async", min_approvals: 1, approval_timeout_seconds: 0 }, []);
      const state = sm.getTaskState("async-task");
      expect(state.async_state).toBeDefined();
      expect(state.async_state!.async_phase).toBe(1);
    });
  });

  describe("handleSignal", () => {
    beforeEach(async () => {
      await manager.startAsyncCycle("async-task", { mode: "async", min_approvals: 1, approval_timeout_seconds: 0 }, []);
    });

    it("processes approval signal and transitions to DOING when threshold met", async () => {
      const result = await manager.handleSignal("async-task", {
        stakeholder_id: "user1",
        timestamp: new Date().toISOString(),
        source: "slack:test/123",
      });

      expect(result.transitioned).toBe(true);
      if (result.transitioned) {
        expect(result.new_status).toBe("DOING");
      }
      expect(sm.getTaskState("async-task").status).toBe("DOING");
    });

    it("processes rejection and transitions to DOING", async () => {
      const result = await manager.handleSignal("async-task", {
        stakeholder_id: "user1",
        timestamp: new Date().toISOString(),
        source: "slack:test/123",
        feedback: "Please revise the approach",
      });

      expect(result.transitioned).toBe(true);
      if (result.transitioned) {
        expect(result.new_status).toBe("DOING");
      }
      expect(sm.getTaskState("async-task").status).toBe("DOING");
    });

    it("ignores signal for task not in AWAITING_APPROVAL state", async () => {
      // Manually transition to DOING first.
      sm.transition("async-task", "DOING", {}, "async");

      const result = await manager.handleSignal("async-task", {
        stakeholder_id: "user1",
        timestamp: new Date().toISOString(),
        source: "slack:test/123",
      });

      expect(result.transitioned).toBe(false);
    });

    it("emits async.approval.received event", async () => {
      const events: CollaborationEvent[] = [];
      eventBus.subscribeAll(e => events.push(e));

      await manager.handleSignal("async-task", {
        stakeholder_id: "user1",
        timestamp: new Date().toISOString(),
        source: "slack:test/123",
      });

      const approvalEvent = events.find(e => e.type === "async.approval.received");
      expect(approvalEvent).toBeDefined();
    });

    it("emits async.threshold.met event when threshold is reached", async () => {
      const events: CollaborationEvent[] = [];
      eventBus.subscribeAll(e => events.push(e));

      await manager.handleSignal("async-task", {
        stakeholder_id: "user1",
        timestamp: new Date().toISOString(),
        source: "slack:test/123",
      });

      const thresholdEvent = events.find(e => e.type === "async.threshold.met");
      expect(thresholdEvent).toBeDefined();
    });
  });

  describe("checkTimeouts", () => {
    it("transitions expired tasks to FAILED", async () => {
      // Start cycle with a timeout in the past.
      await manager.startAsyncCycle("async-task", { mode: "async", min_approvals: 1, approval_timeout_seconds: 1 }, []);

      // Artificially set the timeout to the past.
      const state = sm.getTaskState("async-task");
      sm.updateTaskFields("async-task", {
        async_state: {
          ...state.async_state!,
          approval_timeout_at: new Date(Date.now() - 5000).toISOString(),
        },
      });

      const results = await manager.checkTimeouts();
      expect(results).toHaveLength(1);
      const timedOut = results[0];
      expect(timedOut).toBeDefined();
      if (!timedOut) return;
      expect(timedOut.task_id).toBe("async-task");
      expect(timedOut.new_status).toBe("FAILED");
      expect(sm.getTaskState("async-task").status).toBe("FAILED");
    });

    it("does not time out tasks without a timeout configured", async () => {
      await manager.startAsyncCycle("async-task", { mode: "async", min_approvals: 1, approval_timeout_seconds: 0 }, []);
      const results = await manager.checkTimeouts();
      expect(results).toHaveLength(0);
    });
  });

  describe("getAsyncStatus", () => {
    it("returns is_async:false for unknown task", () => {
      const status = manager.getAsyncStatus("nonexistent");
      expect(status.is_async).toBe(false);
    });

    it("returns is_async:true for started async task", async () => {
      await manager.startAsyncCycle("async-task", { mode: "async", min_approvals: 1, approval_timeout_seconds: 0 }, []);
      const status = manager.getAsyncStatus("async-task");
      expect(status.is_async).toBe(true);
      expect(status.listener_active).toBe(true);
    });
  });
});
