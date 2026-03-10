/**
 * T011: Observability tests
 */

import { describe, it, expect } from "bun:test";
import { ObservabilityEmitter } from "../src/observability/emitter.ts";
import { CostTracker } from "../src/observability/cost-tracker.ts";
import { LogSanitizer } from "../src/observability/sanitizer.ts";
import type { AnyEvent } from "../src/observability/events.ts";

describe("ObservabilityEmitter", () => {
  it("emits events to registered handlers", () => {
    const events: AnyEvent[] = [];
    const emitter = new ObservabilityEmitter({
      run_id: "run-1",
      workflow_id: "test-wf",
      log_level: "ERROR",
    });

    emitter.on((e) => {
      events.push(e);
    });
    emitter.emit("task.started", { task_id: "t1", agent: "dev", operation_id: "op1", attempt_id: "a1", iteration: 1 });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("task.started");
    expect(events[0]!.run_id).toBe("run-1");
  });

  it("sanitizes data before emitting", () => {
    const events: AnyEvent[] = [];
    const emitter = new ObservabilityEmitter({
      run_id: "run-1",
      workflow_id: "test-wf",
      log_level: "ERROR",
    });

    emitter.on((e) => {
      events.push(e);
    });
    emitter.emit("task.started", {
      task_id: "t1",
      key: "AKIAIOSFODNN7EXAMPLE", // should be redacted
    });

    expect(events[0]!.data["key"]).toContain("[REDACTED:AWS_KEY]");
  });

  it("never throws even if handler throws", () => {
    const emitter = new ObservabilityEmitter({
      run_id: "run-1",
      workflow_id: "test-wf",
      log_level: "ERROR",
    });
    emitter.on(() => { throw new Error("handler error"); });
    expect(() => emitter.emit("task.started", {})).not.toThrow();
  });

  it("off() removes handler", () => {
    const events: AnyEvent[] = [];
    const emitter = new ObservabilityEmitter({ run_id: "r", workflow_id: "w", log_level: "ERROR" });
    const handler = (e: AnyEvent): void => {
      events.push(e);
    };
    emitter.on(handler);
    emitter.emit("task.started", {});
    emitter.off(handler);
    emitter.emit("task.completed", {});
    expect(events).toHaveLength(1);
  });
});

describe("CostTracker", () => {
  it("computeCost() calculates correct USD cost", () => {
    const cost = CostTracker.computeCost("claude-sonnet-4-6", 1000, 500);
    // input: 1000 * 0.003/1000 = 0.003, output: 500 * 0.015/1000 = 0.0075
    expect(cost).toBeCloseTo(0.003 + 0.0075, 4);
  });

  it("getTotalCost() sums across tasks", () => {
    const tracker = new CostTracker();
    tracker.recordTask("t1", "claude-sonnet-4-6", { input: 1000, output: 500 });
    tracker.recordTask("t2", "claude-sonnet-4-6", { input: 2000, output: 1000 });
    expect(tracker.getTotalCost()).toBeGreaterThan(0);
  });

  it("isOverBudget() returns true when exceeded", () => {
    const tracker = new CostTracker();
    tracker.recordTask("t1", "claude-opus-4-6", { input: 100000, output: 50000 }); // expensive
    expect(tracker.isOverBudget(0.01)).toBe(true);
  });

  it("isOverBudget() returns false when under budget", () => {
    const tracker = new CostTracker();
    tracker.recordTask("t1", "claude-sonnet-4-6", { input: 100, output: 50 });
    expect(tracker.isOverBudget(10.00)).toBe(false);
  });

  it("getTaskCost() returns 0 for unknown task", () => {
    const tracker = new CostTracker();
    expect(tracker.getTaskCost("unknown")).toBe(0);
  });
});
