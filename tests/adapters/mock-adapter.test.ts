/**
 * Mock adapter tests
 */

import { describe, it, expect } from "bun:test";
import { MockAdapter } from "../../src/adapters/mock-adapter.ts";
import type { AgentContext } from "../../src/types/index.ts";

const MOCK_CONTEXT: AgentContext = {
  constitution: "# Test",
  handover_state: {},
  task_definition: {
    id: "test-task",
    agent: "dev",
    description: "Test task",
  },
  dispatch_mode: "direct",
};

describe("MockAdapter", () => {
  it("records dispatch calls", async () => {
    const adapter = new MockAdapter();
    await adapter.dispatch("task-1", MOCK_CONTEXT, {
      operation_id: "op:task-1:run-1",
      attempt_id: "op:task-1:run-1:attempt_1",
    });
    expect(adapter.dispatchCount()).toBe(1);
    expect(adapter.wasDispatched("task-1")).toBe(true);
  });

  it("returns COMPLETED by default", async () => {
    const adapter = new MockAdapter();
    const result = await adapter.dispatch("t", MOCK_CONTEXT, {
      operation_id: "op",
      attempt_id: "op:a1",
    });
    expect(result.status).toBe("COMPLETED");
  });

  it("custom result factory controls output", async () => {
    const adapter = new MockAdapter(() => ({
      status: "FAILED" as const,
      error: "Simulated",
      error_type: "network_error" as const,
    }));
    const result = await adapter.dispatch("t", MOCK_CONTEXT, {
      operation_id: "op",
      attempt_id: "op:a1",
    });
    expect(result.status).toBe("FAILED");
  });

  it("clearRecords() empties the record list", async () => {
    const adapter = new MockAdapter();
    await adapter.dispatch("t1", MOCK_CONTEXT, { operation_id: "o", attempt_id: "a" });
    adapter.clearRecords();
    expect(adapter.dispatchCount()).toBe(0);
  });

  it("getLastRecord() returns most recent dispatch", async () => {
    const adapter = new MockAdapter();
    await adapter.dispatch("t1", MOCK_CONTEXT, { operation_id: "o1", attempt_id: "a1" });
    await adapter.dispatch("t2", MOCK_CONTEXT, { operation_id: "o2", attempt_id: "a2" });
    expect(adapter.getLastRecord()!.task_id).toBe("t2");
  });

  it("dispatchWithRetry retries on FAILED + retryable error", async () => {
    let calls = 0;
    const adapter = new MockAdapter(() => {
      calls++;
      if (calls < 3) {
        return { status: "FAILED" as const, error: "retry", error_type: "rate_limit" as const };
      }
      return { status: "COMPLETED" as const };
    });
    adapter["retry_policy"] = {
      max_attempts: 3,
      retryable_errors: ["rate_limit"],
      backoff_base_ms: 1,
      backoff_max_ms: 10,
    };

    const result = await adapter.dispatchWithRetry("t", MOCK_CONTEXT, {
      operation_id: "op",
      attempt_id: "a",
    });
    expect(result.status).toBe("COMPLETED");
    expect(calls).toBe(3);
  });
});
