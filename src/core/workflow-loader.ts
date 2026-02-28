/**
 * WorkflowLoader — loads workflow YAML, builds DAG, detects cycles.
 * Uses Kahn's algorithm for topological sort + parallel group detection.
 */
import { z } from "zod";
import yaml from "js-yaml";
import { readFileSync } from "fs";
import type { TaskDefinition, WorkflowConfig, ExecutionPlan, ParallelGroup } from "../types/index.ts";

// ─── Zod Schema ──────────────────────────────────────────────────────────────

const TaskOutputSchema = z.object({
  path: z.string(),
  contract: z.string().optional(),
});

const TaskOverlayHilSchema = z.object({
  enabled: z.boolean().optional(),
  risk_tier: z.enum(["T0", "T1", "T2"]).optional(),
});

const TaskOverlayPolicyGateSchema = z.object({
  risk_tier: z.enum(["T0", "T1", "T2"]).optional(),
  enabled: z.boolean().optional(),
});

const TaskOverlayConfidenceSchema = z.object({
  enabled: z.boolean().optional(),
  threshold: z.number().min(0).max(1).optional(),
});

const TaskOverlayPairedSchema = z.object({
  enabled: z.boolean().optional(),
});

const TaskOverlayReviewSchema = z.object({
  enabled: z.boolean().optional(),
});

const TaskDefinitionSchema = z.object({
  agent: z.string().min(1, "agent is required"),
  description: z.string().min(1, "description is required"),
  depends_on: z.array(z.string()).optional(),
  outputs: z.array(TaskOutputSchema).optional(),
  exit_conditions: z.array(z.string()).optional(),
  overlays: z.object({
    hil: TaskOverlayHilSchema.optional(),
    policy_gate: TaskOverlayPolicyGateSchema.optional(),
    confidence: TaskOverlayConfidenceSchema.optional(),
    paired: TaskOverlayPairedSchema.optional(),
    review: TaskOverlayReviewSchema.optional(),
  }).optional(),
  max_rework_iterations: z.number().int().positive().optional(),
}).passthrough();

const WorkflowConfigSchema = z.object({
  version: z.string(),
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  tasks: z.record(z.string(), TaskDefinitionSchema),
});

// ─── WorkflowGraph ────────────────────────────────────────────────────────────

export class WorkflowGraph {
  readonly tasks: Map<string, TaskDefinition>;
  readonly adjacency: Map<string, Set<string>>;  // task → dependents
  readonly dependencies: Map<string, Set<string>>; // task → dependencies

  constructor(
    public readonly config: WorkflowConfig,
    public readonly execution_plan: ExecutionPlan,
  ) {
    this.tasks = new Map();
    this.adjacency = new Map();
    this.dependencies = new Map();

    for (const [id, def] of Object.entries(config.tasks)) {
      this.tasks.set(id, { ...def, id });
      this.dependencies.set(id, new Set(def.depends_on ?? []));
    }

    // Build reverse adjacency (who depends on whom)
    for (const [id, deps] of this.dependencies) {
      if (!this.adjacency.has(id)) this.adjacency.set(id, new Set());
      for (const dep of deps) {
        if (!this.adjacency.has(dep)) this.adjacency.set(dep, new Set());
        this.adjacency.get(dep)!.add(id);
      }
    }
  }

  getTask(id: string): TaskDefinition {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task '${id}' not found in workflow`);
    return task;
  }

  /**
   * Get tasks that are ready to run (all deps complete).
   */
  getReadyTasks(completedTasks: Set<string>): string[] {
    const ready: string[] = [];
    for (const [id, deps] of this.dependencies) {
      if (completedTasks.has(id)) continue;
      if ([...deps].every((d) => completedTasks.has(d))) {
        ready.push(id);
      }
    }
    return ready;
  }

  /**
   * Get downstream tasks (transitive dependents) of a task.
   */
  getDownstream(taskId: string): Set<string> {
    const result = new Set<string>();
    const queue = [taskId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dep of this.adjacency.get(current) ?? []) {
        if (!result.has(dep)) {
          result.add(dep);
          queue.push(dep);
        }
      }
    }
    return result;
  }
}

// ─── WorkflowLoader ───────────────────────────────────────────────────────────

export class WorkflowLoader {
  /**
   * Load a workflow from a YAML file.
   * Validates schema, parses DSL expressions, detects cycles.
   */
  static loadFile(filePath: string): WorkflowGraph {
    const raw = readFileSync(filePath, "utf-8");
    return WorkflowLoader.loadYAML(raw);
  }

  /**
   * Load a workflow from a YAML string.
   */
  static loadYAML(content: string): WorkflowGraph {
    const parsed = yaml.load(content) as unknown;
    const result = WorkflowConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Workflow validation error:\n${result.error.errors
          .map((e) => `  ${e.path.join(".")}: ${e.message}`)
          .join("\n")}`,
      );
    }

    const config = result.data as WorkflowConfig;

    // Validate DSL expressions in exit_conditions
    WorkflowLoader.validateDSLExpressions(config);

    // Validate that all dependencies reference existing tasks
    WorkflowLoader.validateDependencies(config);

    // Detect cycles using Kahn's algorithm; also compute parallel groups
    const plan = WorkflowLoader.buildExecutionPlan(config);

    return new WorkflowGraph(config, plan);
  }

  private static validateDSLExpressions(config: WorkflowConfig): void {
    const { validate } = require("../dsl/parser.ts");
    for (const [taskId, task] of Object.entries(config.tasks)) {
      for (const expr of task.exit_conditions ?? []) {
        try {
          validate(expr);
        } catch (err) {
          throw new Error(
            `DSL parse error in task '${taskId}' exit_condition: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  private static validateDependencies(config: WorkflowConfig): void {
    const taskIds = new Set(Object.keys(config.tasks));
    for (const [taskId, task] of Object.entries(config.tasks)) {
      for (const dep of task.depends_on ?? []) {
        if (!taskIds.has(dep)) {
          throw new Error(
            `Task '${taskId}' depends on '${dep}' which does not exist in the workflow`,
          );
        }
      }
    }
  }

  /**
   * Kahn's topological sort — detects cycles and builds parallel groups.
   */
  private static buildExecutionPlan(config: WorkflowConfig): ExecutionPlan {
    const taskIds = Object.keys(config.tasks);
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>(); // task → who depends on it

    for (const id of taskIds) {
      inDegree.set(id, 0);
      dependents.set(id, []);
    }

    for (const [id, task] of Object.entries(config.tasks)) {
      for (const dep of task.depends_on ?? []) {
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
        dependents.get(dep)!.push(id);
      }
    }

    const groups: ParallelGroup[] = [];
    let level = 0;
    let processedCount = 0;

    let currentLevel = taskIds.filter((id) => (inDegree.get(id) ?? 0) === 0);

    while (currentLevel.length > 0) {
      groups.push({ tasks: [...currentLevel], level });
      processedCount += currentLevel.length;

      const nextLevel: string[] = [];
      for (const id of currentLevel) {
        for (const dependent of dependents.get(id) ?? []) {
          const newDeg = (inDegree.get(dependent) ?? 0) - 1;
          inDegree.set(dependent, newDeg);
          if (newDeg === 0) {
            nextLevel.push(dependent);
          }
        }
      }

      currentLevel = nextLevel;
      level++;
    }

    if (processedCount !== taskIds.length) {
      // Find the cycle for a useful error message
      const remaining = taskIds.filter((id) => (inDegree.get(id) ?? 0) > 0);
      throw new Error(
        `Workflow contains a dependency cycle involving tasks: ${remaining.join(", ")}`,
      );
    }

    const allTasks = groups.flatMap((g) => g.tasks);
    return { groups, all_tasks: allTasks };
  }
}
