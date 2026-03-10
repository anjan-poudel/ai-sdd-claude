/**
 * ManifestWriter — writes/updates the ## Workflow Artifacts section in constitution.md.
 * Idempotent: replaces existing section on each write.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname, join, relative } from "path";
import type { TaskOutput, WorkflowState } from "../types/index.ts";

const MANIFEST_SECTION_HEADER = "## Workflow Artifacts";
const MANIFEST_SECTION_END_MARKER = "<!-- end:workflow-artifacts -->";

export interface ManifestEntry {
  task_id: string;
  path: string;
  contract?: string;
  status: string;
  completed_at?: string | null;
}

/**
 * Build a manifest entry from a task's outputs.
 */
function buildManifestEntries(
  task_id: string,
  outputs: TaskOutput[],
  status: string,
  completed_at?: string | null,
): ManifestEntry[] {
  return outputs.map((o) => ({
    task_id,
    path: o.path,
    status,
    ...(o.contract !== undefined && { contract: o.contract }),
    ...(completed_at !== undefined && { completed_at }),
  }));
}

/**
 * Render the manifest as a Markdown table.
 */
function renderManifest(entries: ManifestEntry[], projectPath: string): string {
  if (entries.length === 0) {
    return `${MANIFEST_SECTION_HEADER}\n\n_No artifacts produced yet._\n\n${MANIFEST_SECTION_END_MARKER}`;
  }

  const rows = entries.map((e) => {
    const relPath = e.path.startsWith("/")
      ? relative(projectPath, e.path)
      : e.path;
    const contract = e.contract ?? "—";
    const ts = e.completed_at ? e.completed_at.substring(0, 10) : "—";
    return `| ${e.task_id} | \`${relPath}\` | \`${contract}\` | ${e.status} | ${ts} |`;
  });

  return [
    MANIFEST_SECTION_HEADER,
    "",
    "| Task | Path | Contract | Status | Date |",
    "|------|------|----------|--------|------|",
    ...rows,
    "",
    MANIFEST_SECTION_END_MARKER,
  ].join("\n");
}

/**
 * Insert or replace the ## Workflow Artifacts section in a constitution string.
 */
export function upsertManifestSection(constitution: string, newSection: string): string {
  const startIdx = constitution.indexOf(MANIFEST_SECTION_HEADER);
  const endIdx = constitution.indexOf(MANIFEST_SECTION_END_MARKER);

  if (startIdx >= 0 && endIdx >= 0) {
    // Replace existing section
    const before = constitution.substring(0, startIdx);
    const after = constitution.substring(endIdx + MANIFEST_SECTION_END_MARKER.length);
    return before + newSection + after;
  }

  // Append new section
  return constitution.trimEnd() + "\n\n" + newSection + "\n";
}

export class ManifestWriter {
  private constitutionPath: string;
  private projectPath: string;

  constructor(constitutionPath: string, projectPath: string) {
    this.constitutionPath = constitutionPath;
    this.projectPath = projectPath;
  }

  /**
   * Write the artifact manifest to constitution.md.
   * Called after every task completion (post-task hook).
   * Idempotent: replaces the section if it already exists.
   */
  writeArtifactManifest(state: WorkflowState): void {
    const entries: ManifestEntry[] = [];

    for (const [task_id, taskState] of Object.entries(state.tasks)) {
      if (taskState.status === "COMPLETED" && taskState.outputs.length > 0) {
        entries.push(...buildManifestEntries(
          task_id,
          taskState.outputs,
          taskState.status,
          taskState.completed_at,
        ));
      }
    }

    const newSection = renderManifest(entries, this.projectPath);

    let constitution = "";
    if (existsSync(this.constitutionPath)) {
      constitution = readFileSync(this.constitutionPath, "utf-8");
    }

    const updated = upsertManifestSection(constitution, newSection);

    // Atomic write: tmp + rename
    const dir = dirname(this.constitutionPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.constitutionPath}.tmp`;
    writeFileSync(tmpPath, updated, "utf-8");
    renameSync(tmpPath, this.constitutionPath);
  }
}

/**
 * Create a ManifestWriter that writes to .ai-sdd/constitution.md.
 */
export function createManifestWriter(projectPath: string): ManifestWriter {
  const constitutionPath = join(projectPath, ".ai-sdd", "constitution.md");
  return new ManifestWriter(constitutionPath, projectPath);
}
