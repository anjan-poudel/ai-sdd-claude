/**
 * Mock adapter for deterministic testing.
 * Records all dispatch calls and returns configurable results.
 */

import type { AgentContext, TaskResult } from "../types/index.ts";
import type { DispatchOptions } from "./base-adapter.ts";
import { RuntimeAdapter } from "./base-adapter.ts";

export interface MockDispatchRecord {
  task_id: string;
  context: AgentContext;
  options: DispatchOptions;
  timestamp: string;
}

export type MockResultFactory = (
  task_id: string,
  context: AgentContext,
) => TaskResult | Promise<TaskResult>;

export class MockAdapter extends RuntimeAdapter {
  readonly dispatch_mode = "direct" as const;
  readonly adapter_type = "mock";

  private readonly records: MockDispatchRecord[] = [];
  private resultFactory: MockResultFactory;

  constructor(resultFactory?: MockResultFactory) {
    super();
    this.resultFactory = resultFactory ?? (() => ({
      status: "COMPLETED" as const,
      outputs: [],
      handover_state: {},
    }));
  }

  async dispatch(
    task_id: string,
    context: AgentContext,
    options: DispatchOptions,
  ): Promise<TaskResult> {
    this.records.push({
      task_id,
      context,
      options,
      timestamp: new Date().toISOString(),
    });
    return this.resultFactory(task_id, context);
  }

  /** Get all recorded dispatch calls. */
  getRecords(): MockDispatchRecord[] {
    return [...this.records];
  }

  /** Clear dispatch records. */
  clearRecords(): void {
    this.records.length = 0;
  }

  /** Override the result factory at runtime. */
  setResultFactory(factory: MockResultFactory): void {
    this.resultFactory = factory;
  }

  /** Get the last dispatched record. */
  getLastRecord(): MockDispatchRecord | undefined {
    return this.records[this.records.length - 1];
  }

  /** Assert that a specific task was dispatched. */
  wasDispatched(task_id: string): boolean {
    return this.records.some((r) => r.task_id === task_id);
  }

  /** Count how many times a task was dispatched. */
  dispatchCount(task_id?: string): number {
    if (task_id === undefined) return this.records.length;
    return this.records.filter((r) => r.task_id === task_id).length;
  }
}
