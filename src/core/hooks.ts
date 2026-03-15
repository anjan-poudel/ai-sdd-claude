/**
 * HookRegistry — pre/post-task, on-failure, on-loop-exit hooks.
 */

import type { TaskState } from "../types/index.ts";

export type HookEvent = "pre_task" | "post_task" | "on_failure" | "on_loop_exit" | "on_task_start" | "on_workflow_start" | "on_workflow_end" | "on_hil_requested";

export interface HookContext {
  task_id: string;
  workflow_id: string;
  run_id: string;
  task_state?: TaskState;
  error?: Error;
  extra?: Record<string, unknown>;
}

export type HookCallback = (ctx: HookContext) => void | Promise<void>;

export class HookRegistry {
  // "*" matches all tasks
  private hooks = new Map<HookEvent, Map<string, HookCallback[]>>();

  /**
   * Register a hook for a specific event and task pattern.
   * Use task_id="*" to match all tasks.
   */
  register(event: HookEvent, task_id: string, callback: HookCallback): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, new Map());
    }
    const eventMap = this.hooks.get(event)!;
    if (!eventMap.has(task_id)) {
      eventMap.set(task_id, []);
    }
    eventMap.get(task_id)!.push(callback);
  }

  /** Convenience: register a pre-task hook. */
  onPreTask(task_id: string, callback: HookCallback): void {
    this.register("pre_task", task_id, callback);
  }

  /** Convenience: register a post-task hook. */
  onPostTask(task_id: string, callback: HookCallback): void {
    this.register("post_task", task_id, callback);
  }

  /** Convenience: register an on-failure hook. */
  onFailure(task_id: string, callback: HookCallback): void {
    this.register("on_failure", task_id, callback);
  }

  /** Convenience: register an on-loop-exit hook. */
  onLoopExit(task_id: string, callback: HookCallback): void {
    this.register("on_loop_exit", task_id, callback);
  }

  /** Convenience: register an on-task-start hook (fires before overlay chain). */
  onTaskStart(task_id: string, callback: HookCallback): void {
    this.register("on_task_start", task_id, callback);
  }

  /** Convenience: register a workflow-start hook (fires once before first task). */
  onWorkflowStart(callback: HookCallback): void {
    this.register("on_workflow_start", "*", callback);
  }

  /** Convenience: register a workflow-end hook (fires after all tasks complete or fail). */
  onWorkflowEnd(callback: HookCallback): void {
    this.register("on_workflow_end", "*", callback);
  }

  /** Convenience: register a HIL-requested hook (fires when a task enters HIL_PENDING). */
  onHilRequested(task_id: string, callback: HookCallback): void {
    this.register("on_hil_requested", task_id, callback);
  }

  /**
   * Run all registered hooks for an event+task in registration order.
   * Runs wildcard "*" hooks first, then task-specific hooks.
   */
  async run(event: HookEvent, ctx: HookContext): Promise<void> {
    const eventMap = this.hooks.get(event);
    if (!eventMap) return;

    // Run wildcard hooks first
    const wildcards = eventMap.get("*") ?? [];
    for (const cb of wildcards) {
      await cb(ctx);
    }

    // Then task-specific hooks
    if (ctx.task_id !== "*") {
      const specific = eventMap.get(ctx.task_id) ?? [];
      for (const cb of specific) {
        await cb(ctx);
      }
    }
  }

  /**
   * Remove all hooks for a given event and task_id.
   */
  clear(event: HookEvent, task_id: string): void {
    this.hooks.get(event)?.delete(task_id);
  }

  /**
   * Remove all hooks.
   */
  clearAll(): void {
    this.hooks.clear();
  }
}
