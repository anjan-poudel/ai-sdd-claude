/**
 * MockTaskTrackingAdapter — in-memory task tracking adapter for testing.
 */

import type {
  TaskTrackingAdapter,
  TaskFields,
  Transition,
} from "../adapters/task-tracking-adapter.ts";
import type { Result, IssueRef, AdapterError } from "../types.ts";

export interface MockTaskTrackingOptions {
  failOn?: { method: string; error: AdapterError };
  latencyMs?: number;
}

export class MockTaskTrackingAdapter implements TaskTrackingAdapter {
  readonly provider = "mock";

  private issues: Map<string, TaskFields & { ref: IssueRef }> = new Map();
  private nextId = 1;

  /** Status transition map for the mock adapter (simplified Kanban). */
  private transitionMap: Map<string, Transition[]> = new Map([
    ["Backlog",     [{ id: "t1", name: "Start", to_status: "In Progress" }]],
    ["In Progress", [{ id: "t2", name: "Review", to_status: "In Review" }, { id: "t3", name: "Done", to_status: "Done" }]],
    ["In Review",   [{ id: "t4", name: "Approve", to_status: "Done" }, { id: "t5", name: "Reject", to_status: "In Progress" }]],
    ["Done",        []],
  ]);

  constructor(private readonly options: MockTaskTrackingOptions = {}) {}

  async createEpic(project: string, summary: string, description: string, labels?: string[]): Promise<Result<IssueRef>> {
    if (this.options.failOn?.method === "createEpic") {
      return { ok: false, error: this.options.failOn.error };
    }
    const id = `MOCK-${this.nextId++}`;
    const ref: IssueRef = { provider: "mock", key: id, id, url: `http://mock/issues/${id}` };
    this.issues.set(id, {
      ref,
      key: id,
      summary,
      description,
      status: "Backlog",
      issue_type: "Epic",
      labels: labels ?? [],
    });
    return { ok: true, value: ref };
  }

  async createTask(project: string, epicRef: IssueRef | null, summary: string, description: string, metadata?: Partial<TaskFields>): Promise<Result<IssueRef>> {
    if (this.options.failOn?.method === "createTask") {
      return { ok: false, error: this.options.failOn.error };
    }
    const id = `MOCK-${this.nextId++}`;
    const ref: IssueRef = { provider: "mock", key: id, id, url: `http://mock/issues/${id}` };
    const issue: TaskFields & { ref: IssueRef } = {
      ref,
      key: id,
      summary,
      description,
      status: "Backlog",
      issue_type: "Story",
      labels: metadata?.labels ?? [],
      ...metadata,
    };
    if (epicRef?.key !== undefined) issue.parent_key = epicRef.key;
    this.issues.set(id, issue);
    return { ok: true, value: ref };
  }

  async updateTask(ref: IssueRef, fields: Partial<TaskFields>): Promise<Result<IssueRef>> {
    const existing = this.issues.get(ref.key);
    if (!existing) {
      return { ok: false, error: { code: "NOT_FOUND", message: `Issue ${ref.key} not found`, retryable: false } };
    }
    this.issues.set(ref.key, { ...existing, ...fields });
    return { ok: true, value: ref };
  }

  async transitionTask(ref: IssueRef, targetStatus: string): Promise<Result<void>> {
    const existing = this.issues.get(ref.key);
    if (!existing) {
      return { ok: false, error: { code: "NOT_FOUND", message: `Issue ${ref.key} not found`, retryable: false } };
    }
    // BFS path discovery through transition map.
    const path = this.findTransitionPath(existing.status, targetStatus);
    if (!path) {
      return {
        ok: false,
        error: {
          code: "VALIDATION",
          message: `No transition path from '${existing.status}' to '${targetStatus}'`,
          retryable: false,
        },
      };
    }
    // Apply transitions in sequence.
    let current = existing.status;
    for (const targetStep of path) {
      this.issues.set(ref.key, { ...this.issues.get(ref.key)!, status: targetStep });
      current = targetStep;
    }
    return { ok: true, value: undefined };
  }

  async getTask(ref: IssueRef): Promise<Result<TaskFields>> {
    const issue = this.issues.get(ref.key);
    if (!issue) {
      return { ok: false, error: { code: "NOT_FOUND", message: `Issue ${ref.key} not found`, retryable: false } };
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ref: _r, ...fields } = issue;
    return { ok: true, value: fields };
  }

  async listTasks(project: string, filter?: { labels?: string[]; status?: string }): Promise<Result<TaskFields[]>> {
    const all = Array.from(this.issues.values())
      .filter(i => !filter?.status || i.status === filter.status)
      .filter(i => !filter?.labels?.length || filter.labels.every(l => i.labels.includes(l)))
      .map(({ ref: _r, ...fields }) => fields);
    return { ok: true, value: all };
  }

  async addLabel(ref: IssueRef, label: string): Promise<Result<void>> {
    const existing = this.issues.get(ref.key);
    if (!existing) {
      return { ok: false, error: { code: "NOT_FOUND", message: `Issue ${ref.key} not found`, retryable: false } };
    }
    if (!existing.labels.includes(label)) {
      this.issues.set(ref.key, { ...existing, labels: [...existing.labels, label] });
    }
    return { ok: true, value: undefined };
  }

  async getAvailableTransitions(ref: IssueRef): Promise<Result<Transition[]>> {
    const existing = this.issues.get(ref.key);
    if (!existing) {
      return { ok: false, error: { code: "NOT_FOUND", message: `Issue ${ref.key} not found`, retryable: false } };
    }
    const transitions = this.transitionMap.get(existing.status) ?? [];
    return { ok: true, value: transitions };
  }

  async healthCheck(): Promise<Result<void>> {
    if (this.options.failOn?.method === "healthCheck") {
      return { ok: false, error: this.options.failOn.error };
    }
    return { ok: true, value: undefined };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** BFS from fromStatus to toStatus through the transition map. Returns list of target statuses to visit. */
  private findTransitionPath(from: string, to: string): string[] | null {
    if (from === to) return [];
    const visited = new Set<string>([from]);
    const queue: Array<{ status: string; path: string[] }> = [{ status: from, path: [] }];
    while (queue.length > 0) {
      const { status, path } = queue.shift()!;
      const transitions = this.transitionMap.get(status) ?? [];
      for (const t of transitions) {
        if (visited.has(t.to_status)) continue;
        const newPath = [...path, t.to_status];
        if (t.to_status === to) return newPath;
        visited.add(t.to_status);
        queue.push({ status: t.to_status, path: newPath });
      }
    }
    return null;
  }
}
