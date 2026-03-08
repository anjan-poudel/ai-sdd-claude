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
import type { OverlayProvider, OverlayDecision, OverlayVerdict, OverlayContext } from "../types/overlay-protocol.ts";
import { runPreProviderChain, runPostProviderChain } from "../overlays/provider-chain.ts";
import type { LocalOverlayProvider } from "../overlays/local-overlay-provider.ts";
import { validateAdapterOutputs } from "../security/output-validator.ts";

export interface EngineConfig {
  max_concurrent_tasks?: number;
  cost_budget_per_run_usd?: number;
  cost_enforcement?: "warn" | "pause" | "stop";
  max_context_tokens?: number;
  context_warning_threshold_pct?: number;
  context_hil_threshold_pct?: number;
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
    private readonly providerChain: OverlayProvider[] = [],
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
    const iterStart = Date.now();

    // Build idempotency keys
    const taskRunId = crypto.randomUUID();
    const operation_id = `${this.workflow.config.name}:${taskId}:${taskRunId}`;
    const attempt_id = `${operation_id}:attempt_${iteration}`;

    // ── HIL resume path ──────────────────────────────────────────────────
    // If the task is already HIL_PENDING (loaded from persisted state on --resume),
    // skip pre-overlays and go directly to awaitResolution. This prevents the state
    // machine reset bug where HIL_PENDING → RUNNING → pre-overlays → new HIL item.
    const currentState = this.stateManager.getTaskState(taskId);
    if (currentState.status === "HIL_PENDING") {
      const hilItemId = currentState.hil_item_id;
      if (!hilItemId) {
        this.stateManager.transition(taskId, "FAILED", {
          error: "HIL_PENDING task has no hil_item_id — cannot resume",
        });
        this.emitter.emit("task.failed", {
          task_id: taskId,
          error: "HIL_PENDING task has no hil_item_id — cannot resume",
        });
        return "FAILED";
      }

      this.emitter.emit("task.hil_resuming", {
        task_id: taskId,
        hil_id: hilItemId,
      });

      const hilProvider = this.providerChain.find(
        (p) => p.id === "hil" && p.runtime === "local"
      ) as (LocalOverlayProvider | undefined);
      const hilOverlay = hilProvider?.inner;

      const waitResult = hilOverlay?.awaitResolution
        ? await hilOverlay.awaitResolution(hilItemId)
        : { proceed: false, feedback: "HIL overlay unavailable" };

      if (!waitResult.proceed) {
        this.stateManager.transition(taskId, "FAILED", {
          error: waitResult.feedback ?? "HIL rejected",
        });
        this.emitter.emit("task.failed", {
          task_id: taskId,
          error: waitResult.feedback ?? "HIL rejected",
        });
        return "FAILED";
      }

      // HIL resolved — transition to RUNNING and fall through to dispatch
      this.stateManager.transition(taskId, "RUNNING");
      // Do NOT incrementIteration — the iteration already started before HIL
    } else {
      // ── Normal (non-HIL-resume) path ─────────────────────────────────────

      // Pre-task hook (non-overlay lifecycle hook)
      const taskState = this.stateManager.getTaskState(taskId);
      await this.hooks.run("pre_task", {
        task_id: taskId,
        workflow_id: this.workflow.config.name,
        run_id: this.runId,
        task_state: taskState,
      });

      // Transition to RUNNING.
      // If the task was re-armed to RUNNING by a previous REWORK verdict, skip the
      // redundant transition (RUNNING → RUNNING is not a valid state machine move).
      if (currentState.status !== "RUNNING") {
        this.stateManager.transition(taskId, "RUNNING");
      }
      this.stateManager.incrementIteration(taskId);

      this.emitter.emit("task.started", {
        task_id: taskId,
        agent: taskDef.agent,
        operation_id,
        attempt_id,
        iteration,
      });

      // ── Pre-task overlay chain ──────────────────────────────────────────
      if (this.providerChain.length > 0) {
        // Assemble context early — needed for overlay chain
        const constitution = this.constitutionResolver.resolveForTask(taskId);
        const projectPath = this.stateManager.getState().project;
        const overlayContext = assembleContext({
          constitution: constitution.content,
          handover_state: this.handoverState,
          task_definition: taskDef,
          dispatch_mode: this.adapter.dispatch_mode,
          project_path: projectPath,
        });

        const overlayCtx: OverlayContext = {
          task_id: taskId,
          workflow_id: this.workflow.config.name,
          run_id: this.runId,
          task_definition: taskDef,
          agent_context: overlayContext,
        };

        const preDecision = await runPreProviderChain(this.providerChain, overlayCtx);

        const preResult = await this.applyPreDecision(taskId, preDecision, iteration);
        if (preResult === "NEEDS_REWORK") return "NEEDS_REWORK";
        if (preResult === "FAILED") return "FAILED";
        if (preResult === "HIL_AWAITING") {
          // HIL: find the local HIL provider's inner overlay for awaitResolution
          const hilProvider = this.providerChain.find(
            (p) => p.id === "hil" && p.runtime === "local"
          ) as (LocalOverlayProvider | undefined);
          const hilOverlay = hilProvider?.inner;
          const hilId = preDecision.evidence?.data?.["hil_id"] as string | undefined;
          const waitResult = hilOverlay?.awaitResolution && hilId
            ? await hilOverlay.awaitResolution(hilId)
            : { proceed: false, feedback: "HIL overlay unavailable or hil_id missing" };

          if (!waitResult.proceed) {
            this.stateManager.transition(taskId, "FAILED", {
              error: waitResult.feedback ?? "HIL rejected",
            });
            this.emitter.emit("task.failed", {
              task_id: taskId,
              error: waitResult.feedback ?? "HIL rejected",
            });
            return "FAILED";
          }
          // HIL resolved — re-arm to RUNNING
          this.stateManager.transition(taskId, "RUNNING");
        }
        // preResult === "CONTINUE" — proceed to dispatch
      }
    }

    // ── Assemble context (shared by both normal and HIL resume paths) ──────
    const constitution = this.constitutionResolver.resolveForTask(taskId);
    this.emitter.emit("constitution.resolved", {
      task_id: taskId,
      sources: constitution.sources,
      warnings: constitution.warnings,
    });
    const projectPath = this.stateManager.getState().project;
    const context = assembleContext({
      constitution: constitution.content,
      handover_state: this.handoverState,
      task_definition: taskDef,
      dispatch_mode: this.adapter.dispatch_mode,
      project_path: projectPath,
    });

    // ── Context size monitoring ─────────────────────────────────────────────
    const contextStr = JSON.stringify(context);
    const estimatedTokens = Math.ceil(contextStr.length / 4);
    this.emitter.emit("context.assembled", {
      task_id: taskId,
      token_count: estimatedTokens,
    });

    if (this.config.max_context_tokens !== undefined && this.adapter.dispatch_mode === "direct") {
      const maxTokens = this.config.max_context_tokens;
      const usagePct = (estimatedTokens / maxTokens) * 100;

      const warnPct = this.config.context_warning_threshold_pct ?? 80;
      const hilPct = this.config.context_hil_threshold_pct ?? 95;

      if (usagePct >= hilPct) {
        // Escalate to HIL — context too large for safe dispatch
        const hilProvider = this.providerChain.find(
          (p) => p.id === "hil" && p.runtime === "local"
        ) as (LocalOverlayProvider | undefined);
        const hilOverlay = hilProvider?.inner;

        if (hilOverlay) {
          const hilId = crypto.randomUUID();
          const hilQueue = (hilOverlay as { queue?: { create: (item: unknown) => void } }).queue;
          if (hilQueue) {
            hilQueue.create({
              id: hilId,
              task_id: taskId,
              workflow_id: this.workflow.config.name,
              status: "PENDING" as const,
              reason: `Context size (${estimatedTokens} tokens, ${usagePct.toFixed(1)}%) exceeds HIL threshold (${hilPct}%) — human review required before dispatch`,
              context: { token_count: estimatedTokens, max_tokens: maxTokens, usage_pct: usagePct },
              created_at: new Date().toISOString(),
            });
          }

          this.emitter.emit("hil.created", {
            hil_id: hilId,
            task_id: taskId,
            reason: `Context size exceeds HIL threshold (${hilPct}%)`,
          });

          this.stateManager.transition(taskId, "HIL_PENDING", { hil_item_id: hilId });
          this.emitter.emit("task.hil_pending", { task_id: taskId, hil_id: hilId });

          const waitResult = hilOverlay.awaitResolution
            ? await hilOverlay.awaitResolution(hilId)
            : { proceed: false, feedback: "HIL overlay unavailable" };

          if (!waitResult.proceed) {
            this.stateManager.transition(taskId, "FAILED", {
              error: waitResult.feedback ?? "Context HIL rejected",
            });
            this.emitter.emit("task.failed", {
              task_id: taskId,
              error: waitResult.feedback ?? "Context HIL rejected",
            });
            return "FAILED";
          }
          this.stateManager.transition(taskId, "RUNNING");
        } else {
          // HIL overlay unavailable — emit warning and continue
          this.emitter.emit("context.warning", {
            task_id: taskId,
            usage_pct: usagePct,
            threshold_pct: hilPct,
          });
        }
      } else if (usagePct >= warnPct) {
        this.emitter.emit("context.warning", {
          task_id: taskId,
          usage_pct: usagePct,
          threshold_pct: warnPct,
        });
      }
    }

    // ── Cost budget check ───────────────────────────────────────────────────
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
      }
    }

    // ── Dispatch ────────────────────────────────────────────────────────────
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
      this.stateManager.transition(taskId, "RUNNING");
      return "NEEDS_REWORK";
    }

    // ── Post-task overlay chain (only on COMPLETED from adapter) ────────────
    if (this.providerChain.length > 0) {
      const overlayCtx: OverlayContext = {
        task_id: taskId,
        workflow_id: this.workflow.config.name,
        run_id: this.runId,
        task_definition: taskDef,
        agent_context: context,
      };

      const postDecision = await runPostProviderChain(this.providerChain, overlayCtx, result);
      const postResult = await this.applyPostDecision(taskId, postDecision, iteration);
      if (postResult === "NEEDS_REWORK") return "NEEDS_REWORK";
      if (postResult === "FAILED") return "FAILED";
    }

    // ── Output contract validation (adapter-independent safety check) ───────
    // Validates path allowlist and secret detection regardless of adapter type.
    // This ensures OpenAIAdapter (direct file writes) follows the same safety
    // model as ClaudeCodeAdapter (which goes through complete-task).
    const adapterOutputs = result.outputs ?? [];
    const declaredOutputs = taskDef.outputs ?? [];
    if (adapterOutputs.length > 0) {
      const validation = validateAdapterOutputs(adapterOutputs, declaredOutputs, projectPath);
      if (!validation.valid) {
        const secretError = validation.errors.find((e) => e.kind === "secret_detected");
        const otherErrors = validation.errors.filter((e) => e.kind !== "secret_detected");
        if (secretError) {
          // Secret in output → NEEDS_REWORK (same as complete-task behaviour)
          this.stateManager.transition(taskId, "NEEDS_REWORK", {
            rework_feedback: secretError.message,
          });
          this.emitter.emit("task.rework", {
            task_id: taskId,
            iteration,
            feedback: secretError.message,
          });
          this.stateManager.transition(taskId, "RUNNING");
          return "NEEDS_REWORK";
        }
        if (otherErrors.length > 0) {
          const msg = otherErrors.map((e) => e.message).join("; ");
          this.stateManager.transition(taskId, "FAILED", { error: msg });
          this.emitter.emit("task.failed", { task_id: taskId, error: msg });
          return "FAILED";
        }
      }
    }

    // ── COMPLETED ───────────────────────────────────────────────────────────
    const outputs: TaskOutput[] = adapterOutputs;
    this.stateManager.transition(taskId, "COMPLETED", { outputs });

    if (result.handover_state) {
      this.handoverState = mergeHandoverState(
        this.handoverState,
        taskId,
        result.handover_state,
      );
    }

    this.emitter.emit("task.completed", {
      task_id: taskId,
      duration_ms: Date.now() - iterStart,
      tokens_used: result.tokens_used,
    });

    // Post-task lifecycle hook
    await this.hooks.run("post_task", {
      task_id: taskId,
      workflow_id: this.workflow.config.name,
      run_id: this.runId,
      task_state: this.stateManager.getTaskState(taskId),
    });

    return "COMPLETED";
  }

  private async applyPreDecision(
    taskId: string,
    decision: OverlayDecision,
    iteration: number,
  ): Promise<"CONTINUE" | "NEEDS_REWORK" | "FAILED" | "HIL_AWAITING"> {
    const verdict: OverlayVerdict = decision.verdict;

    switch (verdict) {
      case "PASS":
        return "CONTINUE";

      case "REWORK":
        this.stateManager.transition(taskId, "NEEDS_REWORK", {
          rework_feedback: decision.feedback ?? "Pre-task overlay requested rework",
          ...(decision.evidence && { overlay_evidence: decision.evidence }),
        });
        this.emitter.emit("task.rework", {
          task_id: taskId,
          iteration,
          feedback: decision.feedback ?? "",
        });
        this.stateManager.transition(taskId, "RUNNING");
        return "NEEDS_REWORK";

      case "FAIL":
        this.stateManager.transition(taskId, "FAILED", {
          error: decision.feedback ?? "Pre-task overlay returned FAIL",
          ...(decision.evidence && { overlay_evidence: decision.evidence }),
        });
        this.emitter.emit("task.failed", {
          task_id: taskId,
          error: decision.feedback ?? "Pre-task overlay returned FAIL",
        });
        return "FAILED";

      case "HIL": {
        const hilId = decision.evidence?.data?.["hil_id"] as string | undefined;
        this.stateManager.transition(taskId, "HIL_PENDING", {
          ...(hilId !== undefined && { hil_item_id: hilId }),
          ...(decision.evidence && { overlay_evidence: decision.evidence }),
        });
        this.emitter.emit("task.hil_pending", {
          task_id: taskId,
          hil_id: hilId,
          feedback: decision.feedback,
        });
        return "HIL_AWAITING";
      }

      default: {
        // This branch is unreachable if OverlayVerdict is exhaustive.
        // TypeScript compilation fails if a new verdict is added without a handler.
        const _exhaustive: never = verdict;
        throw new Error(`Unhandled OverlayVerdict: ${String(_exhaustive)}`);
      }
    }
  }

  private async applyPostDecision(
    taskId: string,
    decision: OverlayDecision,
    iteration: number,
  ): Promise<"PASS" | "NEEDS_REWORK" | "FAILED"> {
    switch (decision.verdict) {
      case "PASS":
        return "PASS";
      case "REWORK":
        this.stateManager.transition(taskId, "NEEDS_REWORK", {
          rework_feedback: decision.feedback ?? "Post-task overlay requested rework",
          ...(decision.evidence && { overlay_evidence: decision.evidence }),
        });
        this.emitter.emit("task.rework", {
          task_id: taskId,
          iteration,
          feedback: decision.feedback ?? "",
        });
        this.stateManager.transition(taskId, "RUNNING");
        return "NEEDS_REWORK";
      case "FAIL":
        this.stateManager.transition(taskId, "FAILED", {
          error: decision.feedback ?? "Post-task overlay returned FAIL",
          ...(decision.evidence && { overlay_evidence: decision.evidence }),
        });
        this.emitter.emit("task.failed", {
          task_id: taskId,
          error: decision.feedback ?? "FAIL",
        });
        return "FAILED";
      case "HIL":
        // HIL from post-task chain is an unusual case — treat as NEEDS_REWORK
        // (post-task HIL is not fully specified; conservative handling)
        this.stateManager.transition(taskId, "NEEDS_REWORK", {
          rework_feedback: decision.feedback ?? "Post-task overlay requested HIL review",
        });
        this.emitter.emit("task.rework", {
          task_id: taskId,
          iteration,
          feedback: decision.feedback ?? "",
        });
        this.stateManager.transition(taskId, "RUNNING");
        return "NEEDS_REWORK";
      default: {
        const _exhaustive: never = decision.verdict;
        throw new Error(`Unhandled OverlayVerdict: ${String(_exhaustive)}`);
      }
    }
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
