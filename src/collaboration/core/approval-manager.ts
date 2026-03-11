/**
 * ApprovalManager — collects and validates approval/rejection signals.
 * Enforces per-stakeholder deduplication, threshold checking, and cycle-scoped state.
 * Stateless between restarts — reads/writes approval data from TaskState via StateManager.
 */

import type {
  ApprovalSignal,
  RejectionSignal,
  ApprovalStatus,
  ApprovalResult,
  RejectionResult,
  AsyncTaskState,
} from "../types.ts";
import type { StateManager } from "../../core/state-manager.ts";

export interface ApprovalManager {
  recordApproval(taskId: string, signal: ApprovalSignal): ApprovalResult;
  recordRejection(taskId: string, signal: RejectionSignal): RejectionResult;
  getStatus(taskId: string): ApprovalStatus;
  isThresholdMet(taskId: string): boolean;
  resetForNewCycle(taskId: string): void;
}

export class DefaultApprovalManager implements ApprovalManager {
  constructor(
    private readonly stateManager: StateManager,
    private readonly minApprovals: Map<string, number>,
  ) {}

  /**
   * Record an approval signal for a task.
   * Deduplicates per stakeholder per phase.
   * Returns the updated status and whether the approval threshold was met.
   */
  recordApproval(taskId: string, signal: ApprovalSignal): ApprovalResult {
    const taskState = this.safeGetState(taskId);
    if (!taskState) {
      console.warn(`[ApprovalManager] recordApproval: task '${taskId}' not found — ignoring`);
      return {
        accepted: false,
        approval_status: this.emptyStatus(taskId),
        triggered_transition: null,
      };
    }

    const asyncState = this.getOrInitAsyncState(taskState);
    const currentPhase = asyncState.async_phase;

    // Deduplication: check if stakeholder already approved in this phase.
    const alreadyApproved = asyncState.approval_signals.some(
      s => s.stakeholder_id === signal.stakeholder_id,
    );
    if (alreadyApproved) {
      console.info(
        `[ApprovalManager] Duplicate approval from '${signal.stakeholder_id}' ` +
        `for task '${taskId}' phase ${currentPhase} — ignored`,
      );
      const status = this.buildStatus(taskId, asyncState);
      return { accepted: false, approval_status: status, triggered_transition: null };
    }

    // Record the new signal.
    const updatedSignals = [...asyncState.approval_signals, signal];
    const updatedAsyncState: AsyncTaskState = {
      ...asyncState,
      approval_signals: updatedSignals,
    };

    // Update task state with new async_state.
    this.stateManager.updateTaskFields(taskId, { async_state: updatedAsyncState });

    const status = this.buildStatus(taskId, updatedAsyncState);
    const triggered = status.threshold_met ? "APPROVED" : null;

    return { accepted: true, approval_status: status, triggered_transition: triggered };
  }

  /**
   * Record a rejection signal for a task.
   * Any single rejection triggers DOING (veto model) and resets the cycle.
   */
  recordRejection(taskId: string, signal: RejectionSignal): RejectionResult {
    const taskState = this.safeGetState(taskId);
    if (!taskState) {
      console.warn(`[ApprovalManager] recordRejection: task '${taskId}' not found — ignoring`);
      return { accepted: false, feedback: signal.feedback, triggered_transition: "DOING" };
    }

    const asyncState = this.getOrInitAsyncState(taskState);
    const updatedRejections = [...asyncState.rejection_signals, signal];

    // On rejection, immediately reset for the next cycle (increment phase, clear approvals).
    const updatedAsyncState: AsyncTaskState = {
      ...asyncState,
      async_phase: asyncState.async_phase + 1,
      approval_signals: [],
      rejection_signals: updatedRejections,
    };

    this.stateManager.updateTaskFields(taskId, { async_state: updatedAsyncState });

    return { accepted: true, feedback: signal.feedback, triggered_transition: "DOING" };
  }

  /**
   * Get the current approval status for a task.
   */
  getStatus(taskId: string): ApprovalStatus {
    const taskState = this.safeGetState(taskId);
    if (!taskState) return this.emptyStatus(taskId);
    const asyncState = this.getOrInitAsyncState(taskState);
    return this.buildStatus(taskId, asyncState);
  }

  /**
   * Check whether the minimum approval threshold has been met.
   */
  isThresholdMet(taskId: string): boolean {
    return this.getStatus(taskId).threshold_met;
  }

  /**
   * Reset approval state for a new cycle (called after rejection or timeout recovery).
   */
  resetForNewCycle(taskId: string): void {
    const taskState = this.safeGetState(taskId);
    if (!taskState) return;
    const asyncState = this.getOrInitAsyncState(taskState);
    const resetState: AsyncTaskState = {
      ...asyncState,
      async_phase: asyncState.async_phase + 1,
      approval_signals: [],
    };
    this.stateManager.updateTaskFields(taskId, { async_state: resetState });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private safeGetState(taskId: string) {
    try {
      return this.stateManager.getTaskState(taskId);
    } catch {
      return null;
    }
  }

  private getOrInitAsyncState(taskState: ReturnType<StateManager["getTaskState"]>): AsyncTaskState {
    return taskState.async_state ?? {
      async_phase: 1,
      approval_signals: [],
      rejection_signals: [],
      collaboration_refs: {},
    };
  }

  private buildStatus(taskId: string, asyncState: AsyncTaskState): ApprovalStatus {
    const required = this.minApprovals.get(taskId) ?? 1;
    const received = asyncState.approval_signals.length;
    const stakeholders = asyncState.approval_signals.map(s => s.stakeholder_id);
    return {
      task_id: taskId,
      phase: asyncState.async_phase,
      received,
      required,
      stakeholders,
      threshold_met: received >= required,
    };
  }

  private emptyStatus(taskId: string): ApprovalStatus {
    return {
      task_id: taskId,
      phase: 1,
      received: 0,
      required: this.minApprovals.get(taskId) ?? 1,
      stakeholders: [],
      threshold_met: false,
    };
  }
}
