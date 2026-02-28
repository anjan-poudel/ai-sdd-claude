/**
 * StateManager — atomic workflow state persistence.
 * Writes via tmp+rename for POSIX atomic semantics.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import type { TaskState, TaskStatus, WorkflowState } from "../types/index.ts";
import { VALID_TRANSITIONS } from "../types/index.ts";

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

const SCHEMA_VERSION = "1" as const;
const STATE_FILE_NAME = "workflow-state.json";

export class StateManager {
  private statePath: string;
  private state: WorkflowState;

  constructor(stateDir: string, workflowName: string, projectPath: string) {
    this.statePath = join(stateDir, STATE_FILE_NAME);
    this.state = {
      schema_version: SCHEMA_VERSION,
      workflow: workflowName,
      project: projectPath,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tasks: {},
    };
  }

  /**
   * Load state from disk, or initialize fresh state.
   */
  load(): void {
    if (existsSync(this.statePath)) {
      const raw = readFileSync(this.statePath, "utf-8");
      const loaded = JSON.parse(raw) as WorkflowState;
      if (loaded.schema_version !== SCHEMA_VERSION) {
        throw new StateError(
          `schema version mismatch: expected '${SCHEMA_VERSION}', got '${loaded.schema_version}'; run ai-sdd migrate`,
        );
      }
      this.state = loaded;
    }
  }

  /**
   * Initialize task entries for all tasks in the workflow.
   * Skips tasks that already have a state.
   */
  initializeTasks(taskIds: string[]): void {
    for (const id of taskIds) {
      if (!this.state.tasks[id]) {
        this.state.tasks[id] = {
          status: "PENDING",
          started_at: null,
          completed_at: null,
          outputs: [],
          iterations: 0,
        };
      }
    }
    this.persist();
  }

  /**
   * Get the current state of a task.
   */
  getTaskState(taskId: string): TaskState {
    const state = this.state.tasks[taskId];
    if (!state) {
      throw new StateError(`Task '${taskId}' not found in state`);
    }
    return { ...state };
  }

  /**
   * Transition a task to a new status.
   * Throws StateError on invalid transition.
   */
  transition(taskId: string, newStatus: TaskStatus, updates?: Partial<TaskState>): void {
    const current = this.state.tasks[taskId];
    if (!current) {
      throw new StateError(`Task '${taskId}' not found in state`);
    }

    const allowed = VALID_TRANSITIONS[current.status];
    if (!allowed.includes(newStatus)) {
      throw new StateError(
        `Invalid transition for task '${taskId}': ${current.status} → ${newStatus}. ` +
        `Allowed: ${allowed.join(", ")}`,
      );
    }

    const now = new Date().toISOString();
    this.state.tasks[taskId] = {
      ...current,
      ...updates,
      status: newStatus,
      started_at: newStatus === "RUNNING" ? (current.started_at ?? now) : current.started_at,
      completed_at: (newStatus === "COMPLETED" || newStatus === "FAILED") ? now : current.completed_at,
    };
    this.state.updated_at = now;
    this.persist();
  }

  /**
   * Increment the iteration counter for a task.
   */
  incrementIteration(taskId: string): void {
    const current = this.state.tasks[taskId];
    if (!current) throw new StateError(`Task '${taskId}' not found`);
    this.state.tasks[taskId] = {
      ...current,
      iterations: current.iterations + 1,
    };
    this.state.updated_at = new Date().toISOString();
    this.persist();
  }

  /**
   * Get the full workflow state (read-only copy).
   */
  getState(): WorkflowState {
    return JSON.parse(JSON.stringify(this.state)) as WorkflowState;
  }

  /**
   * Get all task IDs with a specific status.
   */
  getTasksByStatus(status: TaskStatus): string[] {
    return Object.entries(this.state.tasks)
      .filter(([, s]) => s.status === status)
      .map(([id]) => id);
  }

  /**
   * Check if all tasks are in terminal states (COMPLETED or FAILED).
   */
  isTerminal(): boolean {
    return Object.values(this.state.tasks).every(
      (s) => s.status === "COMPLETED" || s.status === "FAILED",
    );
  }

  /**
   * Atomically persist state to disk (tmp + rename).
   */
  private persist(): void {
    const dir = dirname(this.statePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.statePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
    renameSync(tmpPath, this.statePath);
  }
}
