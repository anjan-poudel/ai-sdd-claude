/**
 * HIL queue — file-based CRUD + notification hooks.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import type { HilItem, HilStatus } from "../../types/index.ts";

export class HilQueue {
  private readonly queuePath: string;

  constructor(queuePath: string) {
    this.queuePath = queuePath;
    if (!existsSync(queuePath)) {
      mkdirSync(queuePath, { recursive: true });
    }
  }

  private filePath(id: string): string {
    return join(this.queuePath, `${id}.json`);
  }

  private atomicWrite(path: string, data: unknown): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmp, path);
  }

  /**
   * Create a new HIL item.
   */
  create(item: HilItem): void {
    this.atomicWrite(this.filePath(item.id), item);
  }

  /**
   * Get a HIL item by ID.
   */
  get(id: string): HilItem | null {
    const path = this.filePath(id);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as HilItem;
  }

  /**
   * Update HIL item status.
   */
  updateStatus(
    id: string,
    status: HilStatus,
    updates?: Partial<HilItem>,
  ): HilItem {
    const item = this.get(id);
    if (!item) throw new Error(`HIL item '${id}' not found`);

    const now = new Date().toISOString();
    const updated: HilItem = {
      ...item,
      ...updates,
      status,
      ...(status === "ACKED" ? { acked_at: now } : {}),
      ...(status === "RESOLVED" ? { resolved_at: now } : {}),
      ...(status === "REJECTED" ? { rejected_at: now } : {}),
    };
    this.atomicWrite(this.filePath(id), updated);
    return updated;
  }

  /**
   * List HIL items, optionally filtered by status.
   */
  list(filterStatus?: HilStatus): HilItem[] {
    if (!existsSync(this.queuePath)) return [];

    const items: HilItem[] = [];
    for (const file of readdirSync(this.queuePath)) {
      if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
      try {
        const item = JSON.parse(
          readFileSync(join(this.queuePath, file), "utf-8"),
        ) as HilItem;
        if (!filterStatus || item.status === filterStatus) {
          items.push(item);
        }
      } catch {
        // Skip corrupted files
      }
    }
    return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /**
   * Acknowledge a HIL item.
   */
  ack(id: string): HilItem {
    return this.updateStatus(id, "ACKED");
  }

  /**
   * Resolve a HIL item (human approved).
   */
  resolve(id: string, notes?: string): HilItem {
    return this.updateStatus(
      id,
      "RESOLVED",
      notes !== undefined ? { notes } : undefined,
    );
  }

  /**
   * Reject a HIL item (human rejected).
   */
  reject(id: string, reason?: string): HilItem {
    return this.updateStatus(
      id,
      "REJECTED",
      reason !== undefined ? { rejection_reason: reason } : undefined,
    );
  }

  /**
   * Wait for a HIL item to be resolved or rejected (polling).
   */
  async waitForResolution(
    id: string,
    pollIntervalMs = 5000,
    timeoutMs = 3600000,
  ): Promise<HilItem> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const item = this.get(id);
      if (!item) throw new Error(`HIL item '${id}' not found`);
      if (item.status === "RESOLVED" || item.status === "REJECTED") {
        return item;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`HIL item '${id}' timed out after ${timeoutMs}ms`);
  }
}
