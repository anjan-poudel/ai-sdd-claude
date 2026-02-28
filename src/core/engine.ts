/**
 * Core engine — workflow orchestrator.
 * Dispatches tasks via RuntimeAdapter, manages state, fires hooks.
 */

import type { AgentConfig, TaskDefinition, TaskStatus, TaskOutput, TokenUsage } from "../types/index.ts";
import type { WorkflowGraph } from "./workflow-loader.ts";
import type { StateManager } from "./state-manager.ts";
import type { RuntimeAdapter } from "../adapters/base-adapter.ts";
import type { AgentRegistry } from "./agent-loader.ts";
import type { ConstitutionResolver } from "../constitution/resolver.ts";
import type { ManifestWriter } from "../constitution/manifest-writer.ts";
import { HookRegistry } from "./hooks.ts";
import { assembleContext, mergeHandoverState } from "./context-manager.ts";
import { ObservabilityEmitter } from "../observability/emitter.ts";
import { CostTracker } from "../observability/cost-tracker.ts";

export interface EngineConfig {
  max_concurrent_tasks?: number;
  cost_budget_per_run_usd?: number;
  cost_enforcement?: "warn" | "pause" | "stop";
}

export interface EngineRunOptions {
  dry_run?: boolean;
  step?: boolean;            // Pause after each task
  resume?: boolean;
  target_task?: string;     // --task <id>: run specific task + unmet deps
}

export interface EngineRunResult {
  completed: string[];
  failed: string[];
  skipped: string[];
  total_cost_usd: number;
  duration_ms: number;
}

// Simple async semaphore
class Semaphore {
  private queue: Array<() => void> = [];
  private count: number;

  constructor(limit: number) {
    this.count = limit;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.count++;
    }
  }
}

export class Engine {
  readonly hooks: HookRegistry;
  private readonly costTracker: CostTracker;
  private readonly semaphore: Semaphore;
  private runId: string;
  private handoverState: Record<string, unknown> = {};

  constructor(
    private readonly workflow: WorkflowGraph,
    private readonly stateManager: StateManager,
    private readonly agentRegistry: AgentRegistry,
    private readonly adapter: RuntimeAdapter,
    private readonly constitutionResolver: ConstitutionResolver,
    private readonly manifestWriter: ManifestWriter,
    private readonly emitter: ObservabilityEmitter,
    private readonly config: EngineConfig = {},
  ) {
    this.hooks = new HookRegistry();
    this.costTracker = new CostTracker();
    this.semaphore = new Semaphore(config.max_concurrent_tasks ?? 3);
    this.runId = crypto.randomUUID();

    // Register default post-task hook: manifest writer
    this.hooks.onPostTask("*", async ({ task_id }) => {
      try {
        this.manifestWriter.writeArtifactManifest(this.stateManager.getState());
      } catch (err) {
        this.emitter.emit("task.failed", {
          task_id,
          error: `Manifest writer failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }

  async run(options: EngineRunOptions = {}): Promise<EngineRunResult> {
    const startTime = Date.now();
    const completed: string[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];

    this.emitter.emit("workflow.started", {
      workflow_name: this.workflow.config.name,
      task_count: this.workflow.config.tasks ? Object.keys(this.workflow.config.tasks).length : 0,
      adapter_type: this.adapter.adapter_type,
      dry_run: options.dry_run ?? false,
    });

    // Initialize state for all tasks
    const allTaskIds = this.workflow.execution_plan.all_tasks;
    this.stateManager.initializeTasks(allTaskIds);

    if (options.dry_run) {
      // Print plan without executing
      console.log("\nDry run — execution plan:");
      for (const group of this.workflow.execution_plan.groups) {
        console.log(`  Level ${group.level}: [${group.tasks.join(", ")}]`);
      }
      return { completed: [], failed: [], skipped: allTaskIds, total_cost_usd: 0, duration_ms: Date.now() - startTime };
    }

    // Determine which tasks to run
    let tasksToRun = new Set(allTaskIds);
    if (options.target_task) {
      tasksToRun = this.getTasksToRun(options.target_task);
    }

    // Skip tasks that are already COMPLETED (for resume)
    const completedTasks = new Set<string>();
    for (const taskId of allTaskIds) {
      const state = this.stateManager.getTaskState(taskId);
      if (state.status === "COMPLETED") {
        completedTasks.add(taskId);
        completed.push(taskId);
      }
    }

    // Execute tasks level by level (parallel groups)
    for (const group of this.workflow.execution_plan.groups) {
      const groupTasks = group.tasks.filter((id) => {
        if (!tasksToRun.has(id)) { skipped.push(id); return false; }
        if (completedTasks.has(id)) return false;
        // Skip if any dependency failed (leave task as PENDING — do not attempt invalid transition)
        const deps = [...(this.workflow.dependencies.get(id) ?? [])];
        const hasFailedDep = deps.some((d) => failed.includes(d));
        if (hasFailedDep) {
          skipped.push(id);
          failed.push(id);
          return false;
        }
        return true;
      });

      if (groupTasks.length === 0) continue;

      // Dispatch group in parallel (up to semaphore limit)
      await Promise.all(
        groupTasks.map(async (taskId) => {
          await this.semaphore.acquire();
          try {
            const success = await this.runTask(taskId, options);
            if (success) {
              completedTasks.add(taskId);
              completed.push(taskId);
            } else {
              failed.push(taskId);
            }
          } finally {
            this.semaphore.release();
          }
        }),
      );

      if (options.step && group !== this.workflow.execution_plan.groups.at(-1)) {
        // Step mode: pause between groups
        await waitForEnter(`\nStep mode: press Enter to continue to next group...`);
      }
    }

    const totalCost = this.costTracker.getTotalCost();
    const durationMs = Date.now() - startTime;

    this.emitter.emit("workflow.completed", {
      duration_ms: durationMs,
      tasks_completed: completed.length,
      tasks_failed: failed.length,
      total_cost_usd: totalCost,
    });

    return { completed, failed, skipped, total_cost_usd: totalCost, duration_ms: durationMs };
  }

  private async runTask(
    taskId: string,
    options: EngineRunOptions,
  ): Promise<boolean> {
    const taskDef = this.workflow.getTask(taskId);
    const agent = this.agentRegistry.resolve(taskDef.agent);
    const maxIterations = taskDef.max_rework_iterations ?? 3;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const success = await this.runTaskIteration(taskId, taskDef, agent, iteration);
      if (success === "COMPLETED") return true;
      if (success === "FAILED") return false;
      // NEEDS_REWORK: loop
    }

    // Exceeded max iterations
    this.stateManager.transition(taskId, "FAILED", {
      error: `Exceeded max_rework_iterations (${maxIterations})`,
    });
    this.emitter.emit("task.failed", {
      task_id: taskId,
      error: `Exceeded max rework iterations`,
    });
    return false;
  }

  private async runTaskIteration(
    taskId: string,
    taskDef: TaskDefinition,
    agent: AgentConfig,
    iteration: number,
  ): Promise<"COMPLETED" | "NEEDS_REWORK" | "FAILED"> {
    // Build idempotency keys
    const taskRunId = crypto.randomUUID();
    const operation_id = `${this.workflow.config.name}:${taskId}:${taskRunId}`;
    const attempt_id = `${operation_id}:attempt_${iteration}`;

    // Pre-task hook
    const taskState = this.stateManager.getTaskState(taskId);
    await this.hooks.run("pre_task", {
      task_id: taskId,
      workflow_id: this.workflow.config.name,
      run_id: this.runId,
      task_state: taskState,
    });

    // Transition to RUNNING
    this.stateManager.transition(taskId, "RUNNING");
    this.stateManager.incrementIteration(taskId);

    this.emitter.emit("task.started", {
      task_id: taskId,
      agent: taskDef.agent,
      operation_id,
      attempt_id,
      iteration,
    });

    // Assemble context
    const constitution = this.constitutionResolver.resolveForTask(taskId);
    const context = assembleContext({
      constitution: constitution.content,
      handover_state: this.handoverState,
      task_definition: taskDef,
      dispatch_mode: this.adapter.dispatch_mode,
    });

    // Check cost budget
    if (this.config.cost_budget_per_run_usd !== undefined) {
      const totalCost = this.costTracker.getTotalCost();
      if (totalCost >= this.config.cost_budget_per_run_usd) {
        const enforcement = this.config.cost_enforcement ?? "pause";
        this.emitter.emit("cost.warning", {
          current_cost_usd: totalCost,
          budget_usd: this.config.cost_budget_per_run_usd,
          enforcement,
        });
        if (enforcement === "stop") {
          this.stateManager.transition(taskId, "FAILED", { error: "Cost budget exceeded" });
          return "FAILED";
        }
        // "warn" and "pause" continue for now (pause would trigger HIL in full impl)
      }
    }

    // Dispatch
    const result = await this.adapter.dispatchWithRetry(taskId, context, {
      operation_id,
      attempt_id,
    });

    // Record cost
    if (result.tokens_used) {
      const cost = CostTracker.computeCost(
        agent.llm.model,
        result.tokens_used.input,
        result.tokens_used.output,
      );
      this.costTracker.recordTask(taskId, agent.llm.model, result.tokens_used);
      result.tokens_used.cost_usd = cost;
    }

    if (result.status === "FAILED") {
      this.stateManager.transition(taskId, "FAILED", {
        error: result.error ?? "Adapter dispatch failed",
      });
      await this.hooks.run("on_failure", {
        task_id: taskId,
        workflow_id: this.workflow.config.name,
        run_id: this.runId,
        task_state: this.stateManager.getTaskState(taskId),
      });
      this.emitter.emit("task.failed", {
        task_id: taskId,
        error: result.error ?? "Unknown error",
        error_type: result.error_type,
      });
      return "FAILED";
    }

    if (result.status === "NEEDS_REWORK") {
      this.stateManager.transition(taskId, "NEEDS_REWORK", {
        rework_feedback: result.error ?? "Rework required",
      });
      this.emitter.emit("task.rework", {
        task_id: taskId,
        iteration,
        feedback: result.error ?? "",
      });
      // Re-transition to PENDING for the next iteration
      this.stateManager.transition(taskId, "RUNNING");
      return "NEEDS_REWORK";
    }

    // COMPLETED
    const outputs: TaskOutput[] = result.outputs ?? [];
    this.stateManager.transition(taskId, "COMPLETED", { outputs });

    // Merge handover state
    if (result.handover_state) {
      this.handoverState = mergeHandoverState(
        this.handoverState,
        taskId,
        result.handover_state,
      );
    }

    this.emitter.emit("task.completed", {
      task_id: taskId,
      duration_ms: 0, // TODO: track per-task timing
      tokens_used: result.tokens_used,
    });

    // Post-task hook
    await this.hooks.run("post_task", {
      task_id: taskId,
      workflow_id: this.workflow.config.name,
      run_id: this.runId,
      task_state: this.stateManager.getTaskState(taskId),
    });

    return "COMPLETED";
  }

  /**
   * Get the set of tasks to run for --task <id> (task + unmet deps).
   */
  private getTasksToRun(targetTaskId: string): Set<string> {
    const result = new Set<string>();
    const visit = (id: string) => {
      if (result.has(id)) return;
      result.add(id);
      for (const dep of this.workflow.dependencies.get(id) ?? []) {
        const depState = this.stateManager.getTaskState(dep);
        if (depState.status !== "COMPLETED") {
          visit(dep);
        }
      }
    };
    visit(targetTaskId);
    return result;
  }
}

async function waitForEnter(prompt: string): Promise<void> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    process.stdin.once("data", () => resolve());
  });
}
