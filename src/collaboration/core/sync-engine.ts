/**
 * AsCodeSyncEngine — bidirectional (code-wins) sync between workflow YAML tasks
 * and external issue trackers (Jira MVP1, GitHub Issues MVP2).
 * Parameterized by TaskTrackingAdapter — same engine, different backends.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { dirname, join } from "path";
import type { WorkflowConfig } from "../../types/index.ts";
import type { TaskTrackingAdapter } from "../adapters/task-tracking-adapter.ts";
import type { SyncMappingFile, SyncReport, TaskToIssueMapping, AdapterError } from "../types.ts";

// Fields excluded from hash (runtime-only, not synced to tracker).
const NON_SYNC_FIELDS = new Set([
  "status",
  "run_id",
  "attempt",
  "timestamps",
  "collaboration_refs",
  "hil_item_id",
  "overlay_evidence",
  "tokens_used",
  "cost_usd",
  "async_state",
]);

const SCHEMA_VERSION = "1" as const;

function sortKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  if (obj !== null && typeof obj === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[k] = sortKeysDeep((obj as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return obj;
}

function stripNonSyncFields(taskDef: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(taskDef)) {
    if (!NON_SYNC_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

export function computeContentHash(taskDef: Record<string, unknown>): string {
  const normalized = JSON.stringify(sortKeysDeep(stripNonSyncFields(taskDef)));
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `sha256:${hash}`;
}

function atomicWrite(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, filePath);
}

export interface AsCodeSyncEngine {
  sync(workflow: WorkflowConfig, adapter: TaskTrackingAdapter): Promise<SyncReport>;
  getMappings(): TaskToIssueMapping[];
  loadMappings(path: string): Promise<void>;
  saveMappings(path: string): Promise<void>;
}

export class DefaultAsCodeSyncEngine implements AsCodeSyncEngine {
  private mappings: Map<string, TaskToIssueMapping> = new Map();

  constructor(private readonly projectKey: string) {}

  /**
   * Sync workflow tasks to the external tracker.
   * Code always wins — if a task definition changed, the tracker issue is updated.
   * Never deletes issues; orphaned mappings are labeled "orphaned" in the tracker.
   */
  async sync(workflow: WorkflowConfig, adapter: TaskTrackingAdapter): Promise<SyncReport> {
    // Health check before starting batch.
    const healthResult = await adapter.healthCheck();
    if (!healthResult.ok) {
      throw new Error(
        `Adapter health check failed before sync: ${healthResult.error.message}`,
      );
    }

    const report: SyncReport = {
      created: 0,
      updated: 0,
      orphaned: 0,
      unchanged: 0,
      errors: [],
    };

    const workflowTaskIds = new Set(Object.keys(workflow.tasks));

    // Process each task in the workflow.
    const entries = Object.entries(workflow.tasks);
    const results = await Promise.allSettled(
      entries.map(async ([taskId, taskDef]) => {
        const hash = computeContentHash(taskDef as Record<string, unknown>);
        const existing = this.mappings.get(taskId);

        if (!existing) {
          // Create new issue.
          const createResult = await adapter.createTask(
            this.projectKey,
            null,
            taskId,
            taskDef.description ?? `Task: ${taskId}`,
            { labels: ["ai-sdd"], summary: taskId },
          );

          if (!createResult.ok) {
            report.errors.push({ task_id: taskId, error: createResult.error });
            return;
          }

          const mapping: TaskToIssueMapping = {
            task_id: taskId,
            issue_key: createResult.value.key,
            issue_type: "task",
            content_hash: hash,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            orphaned: false,
          };
          this.mappings.set(taskId, mapping);
          report.created++;
        } else if (existing.content_hash !== hash) {
          // Update existing issue.
          const updateResult = await adapter.updateTask(
            { provider: adapter.provider, key: existing.issue_key, id: existing.issue_key, url: "" },
            {
              summary: taskId,
              description: taskDef.description ?? `Task: ${taskId}`,
            },
          );

          if (!updateResult.ok) {
            report.errors.push({ task_id: taskId, error: updateResult.error });
            return;
          }

          this.mappings.set(taskId, {
            ...existing,
            content_hash: hash,
            updated_at: new Date().toISOString(),
            orphaned: false,
          });
          report.updated++;
        } else {
          // No change.
          report.unchanged++;
        }
      }),
    );

    // Check for settled rejections (unexpected errors).
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn("[AsCodeSyncEngine] Unexpected error in sync batch:", r.reason);
      }
    }

    // Mark orphaned mappings (tasks removed from workflow YAML).
    for (const [taskId, mapping] of this.mappings) {
      if (!workflowTaskIds.has(taskId) && !mapping.orphaned) {
        const labelResult = await adapter.addLabel(
          { provider: adapter.provider, key: mapping.issue_key, id: mapping.issue_key, url: "" },
          "ai-sdd:orphaned",
        );
        if (!labelResult.ok) {
          console.warn(
            `[AsCodeSyncEngine] Failed to label orphaned task '${taskId}': ` +
            labelResult.error.message,
          );
        }
        this.mappings.set(taskId, { ...mapping, orphaned: true });
        report.orphaned++;
      }
    }

    return report;
  }

  getMappings(): TaskToIssueMapping[] {
    return Array.from(this.mappings.values());
  }

  async loadMappings(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      // First sync — treat as empty.
      this.mappings = new Map();
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch (e) {
      throw new Error(`Failed to read mapping file '${filePath}': ${String(e)}`);
    }

    let parsed: SyncMappingFile;
    try {
      parsed = JSON.parse(raw) as SyncMappingFile;
    } catch {
      throw new Error(`Mapping file '${filePath}' is not valid JSON`);
    }

    if (parsed.schema_version !== SCHEMA_VERSION) {
      throw new Error(
        `Mapping file schema version mismatch at '${filePath}': ` +
        `expected '${SCHEMA_VERSION}', got '${parsed.schema_version}'`,
      );
    }

    this.mappings = new Map(parsed.mappings.map(m => [m.task_id, m]));
  }

  async saveMappings(filePath: string): Promise<void> {
    const data: SyncMappingFile = {
      schema_version: SCHEMA_VERSION,
      adapter_type: "unknown",
      project_key: this.projectKey,
      synced_at: new Date().toISOString(),
      mappings: Array.from(this.mappings.values()),
    };
    atomicWrite(filePath, JSON.stringify(data, null, 2));
  }
}
