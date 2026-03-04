/**
 * WorkflowLoader — loads workflow YAML, builds DAG, detects cycles.
 * Uses Kahn's algorithm for topological sort + parallel group detection.
 */
import { z } from "zod";
import yaml from "js-yaml";
import { readFileSync, existsSync } from "fs";
import type { TaskDefinition, TaskOverlays, WorkflowConfig, WorkflowDefaults, ExecutionPlan, ParallelGroup } from "../types/index.ts";
import { ENGINE_TASK_DEFAULTS } from "../types/index.ts";

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

const TaskOverlaysSchema = z.object({
  hil: TaskOverlayHilSchema.optional(),
  policy_gate: TaskOverlayPolicyGateSchema.optional(),
  confidence: TaskOverlayConfidenceSchema.optional(),
  paired: TaskOverlayPairedSchema.optional(),
  review: TaskOverlayReviewSchema.optional(),
});

const WorkflowDefaultsSchema = z.object({
  overlays: TaskOverlaysSchema.optional(),
  max_rework_iterations: z.number().int().positive().optional(),
  exit_conditions: z.array(z.string()).optional(),
});

const TaskDefinitionSchema = z.object({
  use: z.string().optional(),
  agent: z.string().optional(),            // optional here; validated after resolution
  description: z.string().optional(),      // optional here; may come from template; validated after resolution
  depends_on: z.array(z.string()).optional(),
  outputs: z.array(TaskOutputSchema).optional(),
  exit_conditions: z.array(z.string()).optional(),
  overlays: TaskOverlaysSchema.optional(),
  max_rework_iterations: z.number().int().positive().optional(),
}).passthrough();

const WorkflowConfigSchema = z.object({
  version: z.string(),
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  defaults: WorkflowDefaultsSchema.optional(),
  tasks: z.record(z.string(), TaskDefinitionSchema),
});

/** Schema for task library template files. */
const LibraryTemplateSchema = z.object({
  name: z.string(),
  agent: z.string().min(1, "agent is required in library template"),
  description: z.string().optional(),  // optional in template; validated post-merge
  outputs: z.array(TaskOutputSchema).optional(),
  exit_conditions: z.array(z.string()).optional(),
  overlays: TaskOverlaysSchema.optional(),
  max_rework_iterations: z.number().int().positive().optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Per-overlay-key merge: keys from `override` replace matching keys in `base`. */
function deepMergeOverlays(base: TaskOverlays, override: TaskOverlays): TaskOverlays {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof TaskOverlays)[]) {
    if (override[key] !== undefined) {
      result[key] = { ...(base[key] ?? {}), ...(override[key] ?? {}) } as never;
    }
  }
  return result;
}

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
  static loadFile(filePath: string, libraryDir?: string): WorkflowGraph {
    const raw = readFileSync(filePath, "utf-8");
    return WorkflowLoader.loadYAML(raw, libraryDir);
  }

  /**
   * Load a workflow from a YAML string.
   */
  static loadYAML(content: string, libraryDir?: string): WorkflowGraph {
    const parsed = yaml.load(content) as unknown;
    const result = WorkflowConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Workflow validation error:\n${result.error.errors
          .map((e) => `  ${e.path.join(".")}: ${e.message}`)
          .join("\n")}`,
      );
    }

    const raw = result.data as WorkflowConfig;

    // Resolve each task: engine defaults → workflow defaults → library template → inline
    const resolvedTaskMap: Record<string, Omit<TaskDefinition, "id">> = {};
    for (const [taskId, rawTask] of Object.entries(raw.tasks)) {
      resolvedTaskMap[taskId] = WorkflowLoader.resolveTask(
        taskId,
        rawTask,
        raw.defaults,
        libraryDir ?? WorkflowLoader.defaultLibraryDir(),
      );
    }

    const config: WorkflowConfig = { ...raw, tasks: resolvedTaskMap };

    // Validate DSL expressions in exit_conditions
    WorkflowLoader.validateDSLExpressions(config);

    // Validate that all dependencies reference existing tasks
    WorkflowLoader.validateDependencies(config);

    // Detect cycles using Kahn's algorithm; also compute parallel groups
    const plan = WorkflowLoader.buildExecutionPlan(config);

    return new WorkflowGraph(config, plan);
  }

  private static defaultLibraryDir(): string {
    return new URL("../../data/task-library", import.meta.url).pathname;
  }

  /**
   * Merge engine defaults → workflow defaults → library template → task inline.
   * Produces a fully resolved task definition with agent and description guaranteed.
   */
  private static resolveTask(
    taskId: string,
    inline: Omit<TaskDefinition, "id">,
    workflowDefaults: WorkflowDefaults | undefined,
    libraryDir: string,
  ): Omit<TaskDefinition, "id"> {
    // Layer 1: engine built-in defaults
    let resolved: Partial<Omit<TaskDefinition, "id">> = {
      overlays: deepMergeOverlays({}, ENGINE_TASK_DEFAULTS.overlays ?? {}),
      max_rework_iterations: ENGINE_TASK_DEFAULTS.max_rework_iterations,
    };

    // Layer 2: workflow defaults
    if (workflowDefaults) {
      if (workflowDefaults.overlays) {
        resolved.overlays = deepMergeOverlays(resolved.overlays ?? {}, workflowDefaults.overlays);
      }
      if (workflowDefaults.max_rework_iterations !== undefined) {
        resolved.max_rework_iterations = workflowDefaults.max_rework_iterations;
      }
      if (workflowDefaults.exit_conditions?.length) {
        resolved.exit_conditions = [...workflowDefaults.exit_conditions];
      }
    }

    // Layer 3: task library template (if use: present)
    if (inline.use) {
      const template = WorkflowLoader.loadLibraryTemplate(inline.use, libraryDir);
      resolved.agent = template.agent;
      if (template.description) resolved.description = template.description;
      if (template.outputs) resolved.outputs = template.outputs;
      if (template.exit_conditions?.length) {
        resolved.exit_conditions = [
          ...(resolved.exit_conditions ?? []),
          ...template.exit_conditions,
        ];
      }
      if (template.overlays) {
        resolved.overlays = deepMergeOverlays(resolved.overlays ?? {}, template.overlays);
      }
      if (template.max_rework_iterations !== undefined) {
        resolved.max_rework_iterations = template.max_rework_iterations;
      }
    }

    // Layer 4: task inline definition (always wins)
    if (inline.agent) resolved.agent = inline.agent;
    if (inline.description) resolved.description = inline.description;
    if (inline.depends_on) resolved.depends_on = inline.depends_on;
    if (inline.outputs) resolved.outputs = inline.outputs;
    if (inline.exit_conditions?.length) {
      resolved.exit_conditions = [
        ...(resolved.exit_conditions ?? []),
        ...inline.exit_conditions,
      ];
    }
    if (inline.overlays) {
      resolved.overlays = deepMergeOverlays(resolved.overlays ?? {}, inline.overlays);
    }
    if (inline.max_rework_iterations !== undefined) {
      resolved.max_rework_iterations = inline.max_rework_iterations;
    }

    // Substitute {{task_id}} in output paths
    if (resolved.outputs) {
      resolved.outputs = resolved.outputs.map((o) => ({
        ...o,
        path: o.path.replace(/\{\{task_id\}\}/g, taskId),
      }));
    }

    // Validate required fields after full resolution
    if (!resolved.agent) {
      throw new Error(
        `Task '${taskId}': agent is required — specify it inline or via use:`,
      );
    }
    if (!resolved.description) {
      throw new Error(
        `Task '${taskId}': description is required — specify it inline or add it to the library template`,
      );
    }

    return resolved as Omit<TaskDefinition, "id">;
  }

  private static loadLibraryTemplate(name: string, libraryDir: string): z.infer<typeof LibraryTemplateSchema> {
    const filePath = `${libraryDir}/${name}.yaml`;
    if (!existsSync(filePath)) {
      throw new Error(`Task library template '${name}' not found (looked in ${libraryDir})`);
    }
    const raw = yaml.load(readFileSync(filePath, "utf-8")) as unknown;
    const result = LibraryTemplateSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Task library template '${name}' is invalid:\n${result.error.errors
          .map((e) => `  ${e.path.join(".")}: ${e.message}`)
          .join("\n")}`,
      );
    }
    return result.data;
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
