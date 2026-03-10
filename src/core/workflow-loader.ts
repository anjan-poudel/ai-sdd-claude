/**
 * WorkflowLoader — loads workflow YAML, builds DAG, detects cycles.
 * Uses Kahn's algorithm for topological sort + parallel group detection.
 */
import { z } from "zod";
import yaml from "js-yaml";
import { readFileSync, existsSync } from "fs";
import type {
  TaskConfig,
  TaskDefinition,
  TaskOutput,
  TaskOverlays,
  WorkflowConfig,
  WorkflowDefaults,
  ExecutionPlan,
  ParallelGroup,
  ResolvedTaskConfig,
} from "../types/index.ts";
import { ENGINE_TASK_DEFAULTS } from "../types/index.ts";
import { validate as validateDslExpression } from "../dsl/parser.ts";

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

const TaskOverlayConfidenceMetricSchema = z.object({
  type: z.string(),
  weight: z.number().min(0).max(1).optional(),
  evaluator_agent: z.string().optional(),
});

const TaskOverlayConfidenceSchema = z.object({
  enabled: z.boolean().optional(),
  threshold: z.number().min(0).max(1).optional(),
  metrics: z.array(TaskOverlayConfidenceMetricSchema).optional(),
});

const TaskOverlayPairedSchema = z.object({
  enabled: z.boolean().optional(),
  driver_agent: z.string().optional(),
  challenger_agent: z.string().optional(),
  role_switch: z.enum(["session", "subtask", "checkpoint"]).optional(),
  max_iterations: z.number().int().positive().optional(),
});

const TaskOverlayReviewSchema = z.object({
  enabled: z.boolean().optional(),
  coder_agent: z.string().optional(),
  reviewer_agent: z.string().optional(),
  max_iterations: z.number().int().positive().optional(),
});

const TaskOverlayTraceabilitySchema = z.object({
  enabled: z.boolean().optional(),
  lock_file: z.string().optional(),
  evaluator_agent: z.string().optional(),
});

const TaskOverlaysSchema = z.object({
  hil: TaskOverlayHilSchema.optional(),
  policy_gate: TaskOverlayPolicyGateSchema.optional(),
  confidence: TaskOverlayConfidenceSchema.optional(),
  paired: TaskOverlayPairedSchema.optional(),
  review: TaskOverlayReviewSchema.optional(),
  traceability: TaskOverlayTraceabilitySchema.optional(),
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
  phase: z.string().optional(),
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
  const result: Partial<TaskOverlays> = { ...base };
  for (const key of Object.keys(override) as (keyof TaskOverlays)[]) {
    if (override[key] !== undefined) {
      result[key] = { ...(base[key] ?? {}), ...(override[key] ?? {}) } as never;
    }
  }
  return result as TaskOverlays;
}

function normalizeTaskOutputs(
  outputs: Array<{ path: string; contract?: string | undefined }>,
): TaskOutput[] {
  return outputs.map((output) => ({
    path: output.path,
    ...(output.contract !== undefined && { contract: output.contract }),
  }));
}

type LooseTaskOverlays = {
  hil?: { enabled?: boolean | undefined; risk_tier?: "T0" | "T1" | "T2" | undefined } | undefined;
  policy_gate?: { enabled?: boolean | undefined; risk_tier?: "T0" | "T1" | "T2" | undefined } | undefined;
  confidence?: { enabled?: boolean | undefined; threshold?: number | undefined; metrics?: Array<{ type: string; weight?: number; evaluator_agent?: string }> | undefined } | undefined;
  paired?: { enabled?: boolean | undefined; driver_agent?: string | undefined; challenger_agent?: string | undefined; role_switch?: "session" | "subtask" | "checkpoint" | undefined; max_iterations?: number | undefined } | undefined;
  review?: { enabled?: boolean | undefined; coder_agent?: string | undefined; reviewer_agent?: string | undefined; max_iterations?: number | undefined } | undefined;
  traceability?: { enabled?: boolean | undefined; lock_file?: string | undefined; evaluator_agent?: string | undefined } | undefined;
};

function normalizeTaskOverlays(
  overlays: LooseTaskOverlays | undefined,
): TaskOverlays | undefined {
  if (!overlays) return undefined;

  const normalized: Partial<TaskOverlays> = {};
  if (overlays.hil !== undefined) {
    normalized.hil = {
      ...(overlays.hil.enabled !== undefined && { enabled: overlays.hil.enabled }),
      ...(overlays.hil.risk_tier !== undefined && { risk_tier: overlays.hil.risk_tier }),
    };
  }
  if (overlays.policy_gate !== undefined) {
    normalized.policy_gate = {
      ...(overlays.policy_gate.enabled !== undefined && { enabled: overlays.policy_gate.enabled }),
      ...(overlays.policy_gate.risk_tier !== undefined && { risk_tier: overlays.policy_gate.risk_tier }),
    };
  }
  if (overlays.confidence !== undefined) {
    normalized.confidence = {
      ...(overlays.confidence.enabled !== undefined && { enabled: overlays.confidence.enabled }),
      ...(overlays.confidence.threshold !== undefined && { threshold: overlays.confidence.threshold }),
      ...(overlays.confidence.metrics !== undefined && { metrics: overlays.confidence.metrics }),
    };
  }
  if (overlays.paired !== undefined) {
    normalized.paired = {
      ...(overlays.paired.enabled !== undefined && { enabled: overlays.paired.enabled }),
      ...(overlays.paired.driver_agent !== undefined && { driver_agent: overlays.paired.driver_agent }),
      ...(overlays.paired.challenger_agent !== undefined && { challenger_agent: overlays.paired.challenger_agent }),
      ...(overlays.paired.role_switch !== undefined && { role_switch: overlays.paired.role_switch }),
      ...(overlays.paired.max_iterations !== undefined && { max_iterations: overlays.paired.max_iterations }),
    };
  }
  if (overlays.review !== undefined) {
    normalized.review = {
      ...(overlays.review.enabled !== undefined && { enabled: overlays.review.enabled }),
      ...(overlays.review.coder_agent !== undefined && { coder_agent: overlays.review.coder_agent }),
      ...(overlays.review.reviewer_agent !== undefined && { reviewer_agent: overlays.review.reviewer_agent }),
      ...(overlays.review.max_iterations !== undefined && { max_iterations: overlays.review.max_iterations }),
    };
  }
  if (overlays.traceability !== undefined) {
    normalized.traceability = {
      ...(overlays.traceability.enabled !== undefined && { enabled: overlays.traceability.enabled }),
      ...(overlays.traceability.lock_file !== undefined && { lock_file: overlays.traceability.lock_file }),
      ...(overlays.traceability.evaluator_agent !== undefined && { evaluator_agent: overlays.traceability.evaluator_agent }),
    };
  }

  return Object.keys(normalized).length > 0 ? normalized as TaskOverlays : undefined;
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

    const raw = result.data as {
      version: string;
      name: string;
      description?: string;
      defaults?: WorkflowDefaults;
      tasks: Record<string, TaskConfig>;
    };

    // Resolve each task: engine defaults → workflow defaults → library template → inline
    const resolvedTaskMap: Record<string, ResolvedTaskConfig> = {};
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

    // Validate overlay constraints (llm_judge independence, paired reviewer independence)
    WorkflowLoader.validateOverlayConstraints(config);

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
    inline: TaskConfig,
    workflowDefaults: WorkflowDefaults | undefined,
    libraryDir: string,
  ): ResolvedTaskConfig {
    // Layer 1: engine built-in defaults
    const resolved: Partial<ResolvedTaskConfig> = {};
    if (ENGINE_TASK_DEFAULTS.overlays) {
      resolved.overlays = deepMergeOverlays({}, ENGINE_TASK_DEFAULTS.overlays);
    }
    if (ENGINE_TASK_DEFAULTS.max_rework_iterations !== undefined) {
      resolved.max_rework_iterations = ENGINE_TASK_DEFAULTS.max_rework_iterations;
    }

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
      if (template.phase) resolved.phase = template.phase;
      if (template.description) resolved.description = template.description;
      if (template.outputs) resolved.outputs = normalizeTaskOutputs(template.outputs);
      if (template.exit_conditions?.length) {
        resolved.exit_conditions = [
          ...(resolved.exit_conditions ?? []),
          ...template.exit_conditions,
        ];
      }
      if (template.overlays) {
        resolved.overlays = deepMergeOverlays(
          resolved.overlays ?? {},
          normalizeTaskOverlays(template.overlays as LooseTaskOverlays) ?? {},
        );
      }
      if (template.max_rework_iterations !== undefined) {
        resolved.max_rework_iterations = template.max_rework_iterations;
      }
    }

    // Layer 4: task inline definition (always wins)
    if (inline.agent) resolved.agent = inline.agent;
    if (inline.phase) resolved.phase = inline.phase;
    if (inline.description) resolved.description = inline.description;
    if (inline.depends_on) resolved.depends_on = inline.depends_on;
    if (inline.outputs) resolved.outputs = normalizeTaskOutputs(inline.outputs);
    if (inline.exit_conditions?.length) {
      resolved.exit_conditions = [
        ...(resolved.exit_conditions ?? []),
        ...inline.exit_conditions,
      ];
    }
    if (inline.overlays) {
      resolved.overlays = deepMergeOverlays(
        resolved.overlays ?? {},
        normalizeTaskOverlays(inline.overlays) ?? {},
      );
    }
    if (inline.max_rework_iterations !== undefined) {
      resolved.max_rework_iterations = inline.max_rework_iterations;
    }

    // Substitute {{task_id}} in output paths
    if (resolved.outputs) {
      resolved.outputs = resolved.outputs.map((o) => ({
        path: o.path.replace(/\{\{task_id\}\}/g, taskId),
        ...(o.contract !== undefined && { contract: o.contract }),
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

    return resolved as ResolvedTaskConfig;
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
    for (const [taskId, task] of Object.entries(config.tasks)) {
      for (const expr of task.exit_conditions ?? []) {
        try {
          validateDslExpression(expr);
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
   * Validate overlay constraints:
   * - llm_judge metrics require evaluator_agent ≠ task agent
   * - paired overlay: challenger_agent must differ from task agent
   */
  private static validateOverlayConstraints(config: WorkflowConfig): void {
    for (const [taskId, task] of Object.entries(config.tasks)) {
      // llm_judge validation
      for (const metric of task.overlays?.confidence?.metrics ?? []) {
        if (metric.type === "llm_judge") {
          if (!metric.evaluator_agent) {
            throw new Error(
              `Task '${taskId}': llm_judge metric requires evaluator_agent to be set`,
            );
          }
          if (metric.evaluator_agent === task.agent) {
            throw new Error(
              `Task '${taskId}': llm_judge evaluator_agent ('${metric.evaluator_agent}') must differ from task agent ('${task.agent}'). An agent cannot judge its own output.`,
            );
          }
        }
      }

      // Review overlay: if reviewer_agent is set, it must differ from coder_agent/task agent
      if (task.overlays?.review?.enabled) {
        const reviewerAgent = task.overlays.review.reviewer_agent;
        const coderAgent = task.overlays.review.coder_agent ?? task.agent;
        if (reviewerAgent && reviewerAgent === coderAgent) {
          throw new Error(
            `Task '${taskId}': review overlay reviewer_agent ('${reviewerAgent}') must differ from coder_agent ('${coderAgent}'). Reviewer independence required.`,
          );
        }
      }

      // Traceability overlay: if evaluator_agent is explicitly set, it must differ from task agent.
      // If omitted, auto-resolves to "reviewer" at runtime (TraceabilityOverlay.resolveEvaluator).
      if (task.overlays?.traceability?.enabled && task.overlays.traceability.evaluator_agent) {
        if (task.overlays.traceability.evaluator_agent === task.agent) {
          throw new Error(
            `Task '${taskId}': traceability evaluator_agent ('${task.overlays.traceability.evaluator_agent}') must differ from task agent ('${task.agent}'). An agent cannot evaluate its own output scope.`,
          );
        }
      }

      // Paired overlay: challenger must differ from driver/task agent
      if (task.overlays?.paired?.enabled) {
        const challengerAgent = task.overlays.paired.challenger_agent;
        const driverAgent = task.overlays.paired.driver_agent ?? task.agent;
        if (challengerAgent && challengerAgent === driverAgent) {
          throw new Error(
            `Task '${taskId}': paired overlay challenger_agent ('${challengerAgent}') must differ from driver agent ('${driverAgent}'). Reviewer independence required.`,
          );
        }
        if (!challengerAgent) {
          throw new Error(
            `Task '${taskId}': paired overlay enabled but challenger_agent is not set`,
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
