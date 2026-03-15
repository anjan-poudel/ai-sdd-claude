/**
 * JiraHierarchySync — Epic/Story/Subtask hierarchy management for ai-sdd workflows.
 *
 * Hierarchy:
 *   Feature workflow → 1 Epic
 *   Top-level tasks (no group) → Story/Task under Epic
 *   Tasks with group parent → Subtask under the Story
 *   3rd level+ (deeply nested) → Subtask with a Jira issue link to the group Story
 *
 * Status mapping:
 *   TaskStatus → Jira status name (configurable, sane defaults provided).
 *
 * All operations are idempotent — re-running a workflow syncs but never duplicates.
 * Mappings are persisted to .ai-sdd/sessions/<session>/jira-hierarchy-mappings.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { dirname } from "path";
import type { WorkflowConfig, TaskStatus } from "../../types/index.ts";
import type { TaskTrackingAdapter } from "../adapters/task-tracking-adapter.ts";
import type { IssueRef, AdapterError } from "../types.ts";

// ─── Status Mapping ───────────────────────────────────────────────────────────

export const DEFAULT_STATUS_MAP: Record<string, string> = {
  PENDING:            "To Do",
  RUNNING:            "In Progress",
  HIL_PENDING:        "In Review",
  AWAITING_APPROVAL:  "In Review",
  APPROVED:           "In Review",
  DOING:              "In Progress",
  NEEDS_REWORK:       "In Progress",
  COMPLETED:          "Done",
  FAILED:             "Blocked",
  CANCELLED:          "Cancelled",
};

// ─── Mapping Types ────────────────────────────────────────────────────────────

export interface JiraIssueMapping {
  task_id: string;
  issue_key: string;
  issue_type: "Epic" | "Story" | "Task" | "Subtask";
  parent_key?: string;
  created_at: string;
  updated_at: string;
}

const SCHEMA_VERSION = "1" as const;

interface JiraHierarchyMappingFile {
  schema_version: "1";
  project_key: string;
  epic_key?: string;
  saved_at: string;
  mappings: JiraIssueMapping[];
}

function atomicWrite(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, filePath);
}

// ─── JiraHierarchySync ────────────────────────────────────────────────────────

export class JiraHierarchySync {
  private mappings: Map<string, JiraIssueMapping> = new Map();
  private epicRef: IssueRef | null = null;
  private readonly statusMap: Record<string, string>;

  constructor(
    private readonly projectKey: string,
    statusMap?: Record<string, string>,
  ) {
    this.statusMap = statusMap ?? DEFAULT_STATUS_MAP;
  }

  /**
   * Ensures an Epic exists for the workflow. If already mapped, returns the cached ref.
   * @param workflowName Human-readable workflow name (used as Epic summary).
   * @param description  Optional Epic description.
   */
  async ensureEpic(
    adapter: TaskTrackingAdapter,
    workflowName: string,
    description: string = "",
  ): Promise<IssueRef> {
    if (this.epicRef) return this.epicRef;

    const epicResult = await adapter.createEpic(
      this.projectKey,
      `ai-sdd: ${workflowName}`,
      description || `AI-SDD workflow: ${workflowName}`,
      ["ai-sdd"],
    );

    if (!epicResult.ok) {
      throw new Error(`Failed to create Jira epic for workflow '${workflowName}': ${epicResult.error.message}`);
    }

    this.epicRef = epicResult.value;
    return this.epicRef;
  }

  /**
   * Sync workflow task definitions to Jira hierarchy.
   * Creates Stories for top-level tasks, Subtasks for children.
   * Idempotent — already-mapped tasks are skipped.
   *
   * @param workflow   Loaded WorkflowConfig.
   * @param epicRef    The Epic to attach Stories to.
   */
  async syncWorkflow(
    adapter: TaskTrackingAdapter,
    workflow: WorkflowConfig,
    epicRef: IssueRef,
  ): Promise<{ created: number; skipped: number; errors: Array<{ task_id: string; error: AdapterError }> }> {
    const result = { created: 0, skipped: 0, errors: [] as Array<{ task_id: string; error: AdapterError }> };

    const tasks = Object.entries(workflow.tasks);

    // First pass: create Stories for top-level tasks (no group / group is a top-level task)
    for (const [taskId, taskDef] of tasks) {
      if (this.mappings.has(taskId)) {
        result.skipped++;
        continue;
      }

      // Determine if this is a child task (has depends_on pointing to a group task)
      // For hierarchy: tasks without any parent grouping are Stories; others are Subtasks.
      const parentTaskId = this.resolveParentTaskId(taskId, taskDef, workflow);

      if (parentTaskId === null) {
        // Top-level task → Story under Epic
        const createResult = await adapter.createTask(
          this.projectKey,
          epicRef,
          taskId,
          (taskDef.description as string | undefined) ?? `Task: ${taskId}`,
          { labels: ["ai-sdd"], summary: taskId, issue_type: "Story", parent_key: epicRef.key },
        );

        if (!createResult.ok) {
          result.errors.push({ task_id: taskId, error: createResult.error });
          continue;
        }

        this.mappings.set(taskId, {
          task_id: taskId,
          issue_key: createResult.value.key,
          issue_type: "Story",
          parent_key: epicRef.key,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        result.created++;
      }
    }

    // Second pass: create Subtasks for child tasks (parent must exist at this point)
    for (const [taskId, taskDef] of tasks) {
      if (this.mappings.has(taskId)) continue;

      const parentTaskId = this.resolveParentTaskId(taskId, taskDef, workflow);
      if (parentTaskId === null) continue;

      const parentMapping = this.mappings.get(parentTaskId);
      const parentRef: IssueRef | null = parentMapping
        ? { provider: adapter.provider, key: parentMapping.issue_key, id: parentMapping.issue_key, url: "" }
        : epicRef; // fallback to Epic if parent isn't mapped

      const createResult = await adapter.createTask(
        this.projectKey,
        epicRef,
        taskId,
        (taskDef.description as string | undefined) ?? `Task: ${taskId}`,
        {
          labels: ["ai-sdd"],
          summary: taskId,
          issue_type: "Subtask",
          parent_key: parentRef.key,
        },
      );

      if (!createResult.ok) {
        result.errors.push({ task_id: taskId, error: createResult.error });
        continue;
      }

      this.mappings.set(taskId, {
        task_id: taskId,
        issue_key: createResult.value.key,
        issue_type: "Subtask",
        parent_key: parentRef.key,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      result.created++;
    }

    return result;
  }

  /**
   * Transition a Jira issue to the status corresponding to the given TaskStatus.
   * No-ops if no mapping exists for the task or the status maps to the same Jira status.
   */
  async transitionForStatus(
    adapter: TaskTrackingAdapter,
    taskId: string,
    taskStatus: TaskStatus,
  ): Promise<void> {
    const mapping = this.mappings.get(taskId);
    if (!mapping) return;

    const targetStatus = this.statusMap[taskStatus];
    if (!targetStatus) return;

    const ref: IssueRef = {
      provider: adapter.provider,
      key: mapping.issue_key,
      id: mapping.issue_key,
      url: "",
    };

    const transResult = await adapter.transitionTask(ref, targetStatus);
    if (!transResult.ok) {
      console.warn(
        `[JiraHierarchySync] Failed to transition ${mapping.issue_key} (task: ${taskId}) ` +
        `to '${targetStatus}': ${transResult.error.message}`,
      );
    }
  }

  /** Returns all current mappings as an array. */
  getMappings(): JiraIssueMapping[] {
    return Array.from(this.mappings.values());
  }

  /** Returns the issue mapping for a specific task. */
  getMapping(taskId: string): JiraIssueMapping | undefined {
    return this.mappings.get(taskId);
  }

  /** Returns the cached epic ref (null if ensureEpic hasn't been called). */
  getEpicRef(): IssueRef | null {
    return this.epicRef;
  }

  /** Load persisted mappings from disk. No-op if file doesn't exist. */
  async loadMappings(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      this.mappings = new Map();
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch (e) {
      throw new Error(`Failed to read Jira hierarchy mapping file '${filePath}': ${String(e)}`);
    }

    let parsed: JiraHierarchyMappingFile;
    try {
      parsed = JSON.parse(raw) as JiraHierarchyMappingFile;
    } catch {
      throw new Error(`Jira hierarchy mapping file '${filePath}' is not valid JSON`);
    }

    if (parsed.schema_version !== SCHEMA_VERSION) {
      throw new Error(
        `Jira hierarchy mapping file schema version mismatch at '${filePath}': ` +
        `expected '${SCHEMA_VERSION}', got '${parsed.schema_version}'`,
      );
    }

    this.mappings = new Map(parsed.mappings.map(m => [m.task_id, m]));
    if (parsed.epic_key) {
      this.epicRef = {
        provider: "jira",
        key: parsed.epic_key,
        id: parsed.epic_key,
        url: "",
      };
    }
  }

  /** Atomically persist mappings + epic ref to disk. */
  async saveMappings(filePath: string): Promise<void> {
    const data: JiraHierarchyMappingFile = {
      schema_version: SCHEMA_VERSION,
      project_key: this.projectKey,
      ...(this.epicRef !== null && { epic_key: this.epicRef.key }),
      saved_at: new Date().toISOString(),
      mappings: Array.from(this.mappings.values()),
    };
    atomicWrite(filePath, JSON.stringify(data, null, 2));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Determine the parent task ID for a given task.
   * Returns null if it's a top-level task (no group parent / no task-level parent).
   *
   * Strategy: a task is a "child" if its depends_on references tasks that appear
   * to be a group (i.e., they are not leaf tasks — they have their own dependents).
   * For simplicity, we use the `group` field if present, or falls back to
   * checking `depends_on` for a single parent that itself has dependents.
   */
  private resolveParentTaskId(
    taskId: string,
    taskDef: Record<string, unknown>,
    workflow: WorkflowConfig,
  ): string | null {
    // Explicit group field (task library pattern)
    const group = taskDef["group"] as string | undefined;
    if (group && workflow.tasks[group]) return group;

    // Infer from depends_on: if exactly one dependency and it's the only dependency
    // of the current task, treat it as a group parent only if that dependency
    // has other dependents (i.e., acts as a parent/group node).
    const dependsOn = taskDef["depends_on"] as string[] | string | undefined;
    if (!dependsOn) return null;

    const deps = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
    if (deps.length !== 1) return null;

    const candidateParent = deps[0];
    if (!candidateParent || !workflow.tasks[candidateParent]) return null;

    // Check if candidateParent is itself depended upon by multiple tasks (group node)
    const dependentCount = Object.values(workflow.tasks).filter((t) => {
      const d = (t as Record<string, unknown>)["depends_on"] as string[] | string | undefined;
      if (!d) return false;
      const arr = Array.isArray(d) ? d : [d];
      return arr.includes(candidateParent);
    }).length;

    // Only treat as a group/parent if 2+ tasks depend on it (it's a coordination node)
    return dependentCount >= 2 ? candidateParent : null;
  }
}
