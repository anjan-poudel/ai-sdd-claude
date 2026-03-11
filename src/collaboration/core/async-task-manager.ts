/**
 * AsyncTaskManager — extends the engine's task lifecycle to handle async execution.
 * Owns the sync/async mode fork, the RUNNING→AWAITING_APPROVAL transition,
 * the polling/timeout loop, and delegates signal handling to ApprovalManager.
 */

import { z } from "zod";
import type { TaskOutput } from "../../types/index.ts";
import type { StateManager } from "../../core/state-manager.ts";
import type {
  AsyncTaskState,
  ApprovalSignal,
  RejectionSignal,
  CollaborationEvent,
} from "../types.ts";
import type { NotificationAdapter, ListenerHandle } from "../adapters/notification-adapter.ts";
import type { ApprovalManager } from "./approval-manager.ts";
import type { CollaborationEventBus } from "./event-bus.ts";

// ─── Config Schema ────────────────────────────────────────────────────────────

export const AsyncTaskConfigSchema = z.object({
  mode: z.enum(["sync", "async"]).default("sync"),
  min_approvals: z.number().int().min(0).default(1),
  approval_timeout_seconds: z.number().int().min(0).default(0),
});

export type AsyncTaskConfig = z.infer<typeof AsyncTaskConfigSchema>;

// ─── Status Types ─────────────────────────────────────────────────────────────

export interface AsyncTaskStatus {
  task_id: string;
  is_async: boolean;
  async_state: AsyncTaskState | undefined;
  listener_active: boolean;
}

export type StateTransitionResult =
  | { transitioned: true; new_status: "APPROVED" | "DOING" }
  | { transitioned: false; reason: string };

export interface TimeoutResult {
  task_id: string;
  expired: true;
  new_status: "FAILED";
}

// ─── Manager Interface ────────────────────────────────────────────────────────

export interface AsyncTaskManagerInterface {
  startAsyncCycle(taskId: string, config: AsyncTaskConfig, output: TaskOutput[]): Promise<void>;
  handleSignal(taskId: string, signal: ApprovalSignal | RejectionSignal): Promise<StateTransitionResult>;
  checkTimeouts(): Promise<TimeoutResult[]>;
  getAsyncStatus(taskId: string): AsyncTaskStatus;
  stopAll(): Promise<void>;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class AsyncTaskManager implements AsyncTaskManagerInterface {
  private listeners: Map<string, ListenerHandle> = new Map();
  private configs: Map<string, AsyncTaskConfig> = new Map();

  constructor(
    private readonly stateManager: StateManager,
    private readonly approvalManager: ApprovalManager,
    private readonly notificationAdapter: NotificationAdapter,
    private readonly eventBus: CollaborationEventBus,
    private readonly slackChannel: string,
  ) {}

  /**
   * Start the async approval cycle for a task.
   * Called by the engine after overlay chain completes when mode === "async".
   */
  async startAsyncCycle(
    taskId: string,
    config: AsyncTaskConfig,
    outputs: TaskOutput[],
  ): Promise<void> {
    this.configs.set(taskId, config);

    // Initialize async state on the task.
    const asyncState: AsyncTaskState = {
      async_phase: 1,
      approval_signals: [],
      rejection_signals: [],
      collaboration_refs: {},
      ...(config.approval_timeout_seconds > 0 ? {
        approval_timeout_at: new Date(
          Date.now() + config.approval_timeout_seconds * 1000,
        ).toISOString(),
      } : {}),
    };
    this.stateManager.updateTaskFields(taskId, { async_state: asyncState });

    // Transition RUNNING → AWAITING_APPROVAL.
    this.stateManager.transition(taskId, "AWAITING_APPROVAL", {}, "async");

    // Post notification.
    const artifactUrl = outputs[0]?.path;
    const notifyResult = await this.notificationAdapter.postNotification(this.slackChannel, {
      task_id: taskId,
      title: `Task '${taskId}' awaiting approval`,
      body: [
        `Agent output is ready for review.`,
        artifactUrl ? `Artifact: ${artifactUrl}` : "",
        ``,
        `To approve: @ai-sdd approve ${taskId}`,
        `To reject:  @ai-sdd reject ${taskId} <reason>`,
      ].filter(Boolean).join("\n"),
      action_hints: {
        approve_cmd: `@ai-sdd approve ${taskId}`,
        reject_cmd: `@ai-sdd reject ${taskId} <reason>`,
      },
      ...(artifactUrl !== undefined ? { artifact_url: artifactUrl } : {}),
    });

    if (!notifyResult.ok) {
      console.warn(
        `[AsyncTaskManager] Failed to post notification for '${taskId}': ` +
        notifyResult.error.message,
      );
    } else {
      // Persist Slack message ts for later reference.
      const currentTaskState = this.stateManager.getTaskState(taskId);
      const currentAsyncState = currentTaskState.async_state ?? asyncState;
      this.stateManager.updateTaskFields(taskId, {
        async_state: {
          ...currentAsyncState,
          collaboration_refs: {
            ...currentAsyncState.collaboration_refs,
            slack_message_ts: notifyResult.value.timestamp,
          },
        },
      });
    }

    // Start polling listener.
    const listenerResult = await this.notificationAdapter.startListener(
      this.slackChannel,
      (signal) => {
        void this.handleSignal(taskId, signal);
      },
    );

    if (!listenerResult.ok) {
      console.warn(
        `[AsyncTaskManager] Failed to start listener for '${taskId}': ` +
        listenerResult.error.message,
      );
    } else {
      this.listeners.set(taskId, listenerResult.value);
    }

    // Emit async.cycle.started event.
    const event: CollaborationEvent = {
      type: "async.cycle.started",
      task_id: taskId,
      timestamp: new Date().toISOString(),
      payload: {
        min_approvals: config.min_approvals,
        timeout_seconds: config.approval_timeout_seconds,
        artifact_url: artifactUrl,
      },
    };
    this.eventBus.publish(event);
  }

  /**
   * Handle an incoming approval or rejection signal.
   * Called by the polling listener callback.
   */
  async handleSignal(
    taskId: string,
    signal: ApprovalSignal | RejectionSignal,
  ): Promise<StateTransitionResult> {
    const taskState = this.stateManager.getTaskState(taskId);

    // Only process signals for tasks in AWAITING_APPROVAL state.
    if (taskState.status !== "AWAITING_APPROVAL") {
      console.warn(
        `[AsyncTaskManager] Ignoring signal for '${taskId}' — ` +
        `task is in ${taskState.status}, not AWAITING_APPROVAL`,
      );
      return { transitioned: false, reason: `Task not in AWAITING_APPROVAL state (currently ${taskState.status})` };
    }

    const isApproval = "notes" in signal || !("feedback" in signal);

    if (isApproval && !("feedback" in signal)) {
      // It's an ApprovalSignal.
      const result = this.approvalManager.recordApproval(taskId, signal as ApprovalSignal);

      this.eventBus.publish({
        type: "async.approval.received",
        task_id: taskId,
        timestamp: new Date().toISOString(),
        payload: {
          stakeholder_id: (signal as ApprovalSignal).stakeholder_id,
          accepted: result.accepted,
          approval_count: result.approval_status.received,
          required: result.approval_status.required,
        },
      });

      if (result.triggered_transition === "APPROVED") {
        this.eventBus.publish({
          type: "async.threshold.met",
          task_id: taskId,
          timestamp: new Date().toISOString(),
          payload: { approvals: result.approval_status.received },
        });
        await this.stopListenerFor(taskId);
        this.stateManager.transition(taskId, "APPROVED", {}, "async");
        this.stateManager.transition(taskId, "DOING", {}, "async");
        return { transitioned: true, new_status: "DOING" };
      }

      return { transitioned: false, reason: `Waiting for more approvals (${result.approval_status.received}/${result.approval_status.required})` };
    } else {
      // It's a RejectionSignal.
      const rejection = signal as RejectionSignal;
      const result = this.approvalManager.recordRejection(taskId, rejection);

      this.eventBus.publish({
        type: "async.rejection.received",
        task_id: taskId,
        timestamp: new Date().toISOString(),
        payload: {
          stakeholder_id: rejection.stakeholder_id,
          feedback: rejection.feedback,
        },
      });

      await this.stopListenerFor(taskId);
      this.stateManager.transition(taskId, result.triggered_transition, {
        rework_feedback: rejection.feedback,
      }, "async");
      return { transitioned: true, new_status: "DOING" };
    }
  }

  /**
   * Check for tasks that have exceeded their approval timeout.
   * Should be called periodically by the engine.
   */
  async checkTimeouts(): Promise<TimeoutResult[]> {
    const now = Date.now();
    const results: TimeoutResult[] = [];
    const state = this.stateManager.getState();

    for (const [taskId, taskState] of Object.entries(state.tasks)) {
      if (taskState.status !== "AWAITING_APPROVAL") continue;
      const asyncState = taskState.async_state;
      if (!asyncState?.approval_timeout_at) continue;

      const deadline = new Date(asyncState.approval_timeout_at).getTime();
      if (now > deadline) {
        this.eventBus.publish({
          type: "async.timeout.expired",
          task_id: taskId,
          timestamp: new Date().toISOString(),
          payload: {
            deadline: asyncState.approval_timeout_at,
            approvals_received: asyncState.approval_signals.length,
          },
        });

        await this.stopListenerFor(taskId);

        // Post timeout notification.
        void this.notificationAdapter.postNotification(this.slackChannel, {
          task_id: taskId,
          title: `Task '${taskId}' approval timed out`,
          body: `The approval window for task '${taskId}' has expired. The task has been marked FAILED.`,
        });

        this.stateManager.transition(taskId, "FAILED", {
          error: `Approval timeout exceeded at ${asyncState.approval_timeout_at}`,
        }, "async");

        results.push({ task_id: taskId, expired: true, new_status: "FAILED" });
      }
    }

    return results;
  }

  /**
   * Get the async execution status for a task.
   */
  getAsyncStatus(taskId: string): AsyncTaskStatus {
    let taskState;
    try {
      taskState = this.stateManager.getTaskState(taskId);
    } catch {
      return { task_id: taskId, is_async: false, async_state: undefined, listener_active: false };
    }

    const config = this.configs.get(taskId);
    return {
      task_id: taskId,
      is_async: config?.mode === "async",
      async_state: taskState.async_state,
      listener_active: this.listeners.has(taskId),
    };
  }

  /**
   * Stop all active polling listeners. Called on engine shutdown.
   */
  async stopAll(): Promise<void> {
    for (const [taskId] of this.listeners) {
      await this.stopListenerFor(taskId);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async stopListenerFor(taskId: string): Promise<void> {
    const handle = this.listeners.get(taskId);
    if (handle) {
      await this.notificationAdapter.stopListener(handle);
      this.listeners.delete(taskId);
    }
  }
}
