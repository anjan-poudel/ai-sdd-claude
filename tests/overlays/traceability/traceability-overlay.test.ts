/**
 * Traceability overlay tests — LLM-judge scope verification.
 * CLAUDE.md §1: Config-to-behavior — each test changes config and asserts different runtime behavior.
 * CLAUDE.md §5: Error messages are contracts — event fields asserted match actual emitted data.
 */

import { describe, it, expect } from "bun:test";
import { TraceabilityOverlay } from "../../../src/overlays/traceability/traceability-overlay.ts";
import type { OverlayContext } from "../../../src/overlays/base-overlay.ts";
import type { TaskResult } from "../../../src/types/index.ts";
import type { RuntimeAdapter, DispatchOptions } from "../../../src/adapters/base-adapter.ts";
import type { AgentContext } from "../../../src/types/index.ts";
import { ObservabilityEmitter } from "../../../src/observability/emitter.ts";
import type { AnyEvent } from "../../../src/observability/events.ts";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEmitter(): { emitter: ObservabilityEmitter; events: AnyEvent[] } {
  const events: AnyEvent[] = [];
  const emitter = new ObservabilityEmitter({
    run_id: "run-001",
    workflow_id: "test-workflow",
    log_level: "ERROR",
  });
  emitter.on((ev) => { events.push(ev); });
  return { emitter, events };
}

function makeCtx(overrides: { phase?: string; agent?: string } = {}): OverlayContext {
  const taskDef = {
    id: "test-task",
    agent: overrides.agent ?? "developer",
    description: "Test task",
    phase: overrides.phase ?? "implement",
  };
  const agentCtx: AgentContext = {
    constitution: "test constitution",
    handover_state: {},
    task_definition: taskDef,
    dispatch_mode: "direct" as const,
  };
  return {
    task_id: "test-task",
    workflow_id: "test-workflow",
    run_id: "run-001",
    task_definition: taskDef,
    agent_context: agentCtx,
  };
}

function makeResult(): TaskResult {
  return {
    status: "COMPLETED",
    outputs: [{ path: "specs/design-l1.md" }],
    handover_state: {},
  };
}

/** Mock adapter that returns configurable handover_state or fails */
function makeMockAdapter(opts: {
  handover_state?: Record<string, unknown>;
  fail?: boolean;
  failError?: string;
  onDispatch?: (taskId: string, ctx: AgentContext, opts: DispatchOptions) => void;
}): RuntimeAdapter {
  return {
    dispatch_mode: "direct",
    adapter_type: "mock",
    dispatch: async (taskId: string, ctx: AgentContext, dispatchOpts: DispatchOptions): Promise<TaskResult> => {
      opts.onDispatch?.(taskId, ctx, dispatchOpts);
      if (opts.fail) {
        return { status: "FAILED", error: opts.failError ?? "Judge failed" };
      }
      return {
        status: "COMPLETED",
        handover_state: opts.handover_state ?? { in_scope: true, findings: [] },
      };
    },
  } as unknown as RuntimeAdapter;
}

/** Create a temp lock file and return its path */
function createTempLockFile(): { dir: string; lockPath: string } {
  const dir = join(tmpdir(), `traceability-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const lockPath = join(dir, "requirements.lock.yaml");
  writeFileSync(lockPath, "spec_hash: abc123\nrequirements:\n  - FR-001: User login\n  - FR-002: User logout\n");
  return { dir, lockPath };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TraceabilityOverlay: enabled/disabled", () => {
  it("enabled defaults to true", () => {
    const { emitter } = makeEmitter();
    const overlay = new TraceabilityOverlay(emitter);
    expect(overlay.enabled).toBe(true);
  });

  it("enabled: false → overlay disabled", () => {
    const { emitter } = makeEmitter();
    const overlay = new TraceabilityOverlay(emitter, { enabled: false });
    expect(overlay.enabled).toBe(false);
  });
});

describe("TraceabilityOverlay: lock file handling", () => {
  it("no lock file → accept: true with traceability.skipped event", async () => {
    const { emitter, events } = makeEmitter();
    const adapter = makeMockAdapter({ handover_state: { in_scope: true, findings: [] } });
    const overlay = new TraceabilityOverlay(emitter, {
      lockFilePath: "/nonexistent/path/requirements.lock.yaml",
      evaluator_agent: "reviewer",
    }, adapter);

    const result = await overlay.postTask(makeCtx(), makeResult());
    expect(result.accept).toBe(true);
    expect(result.new_status).toBe("COMPLETED");

    const skippedEvent = events.find((e) => e.type === "traceability.skipped");
    expect(skippedEvent).toBeDefined();
    expect(skippedEvent?.data["reason"]).toBe("no lock file");
  });
});

describe("TraceabilityOverlay: no adapter", () => {
  it("no adapter → accept: true (skip silently) with traceability.skipped event", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter, events } = makeEmitter();
      const overlay = new TraceabilityOverlay(emitter, {
        lockFilePath: lockPath,
        evaluator_agent: "reviewer",
      }); // no adapter

      const result = await overlay.postTask(makeCtx(), makeResult());
      expect(result.accept).toBe(true);

      const skippedEvent = events.find((e) => e.type === "traceability.skipped");
      expect(skippedEvent).toBeDefined();
      expect(skippedEvent?.data["reason"]).toBe("no adapter available");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TraceabilityOverlay: task-level config", () => {
  it("task-level enabled:false skips traceability", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter } = makeEmitter();
      const overlay = new TraceabilityOverlay(
        emitter,
        { lockFilePath: lockPath },
        makeMockAdapter({
          handover_state: { in_scope: false, findings: ["should not run"] },
        }),
      );

      const baseCtx = makeCtx();
      const result = await overlay.postTask(
        {
          ...baseCtx,
          task_definition: {
            ...baseCtx.task_definition,
            overlays: { traceability: { enabled: false, lock_file: lockPath, evaluator_agent: "reviewer" } },
          },
        },
        makeResult(),
      );

      expect(result.accept).toBe(true);
      expect(result.new_status).toBe("COMPLETED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("task overlay config supplies evaluator_agent and lock_file at runtime", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter, events } = makeEmitter();
      const overlay = new TraceabilityOverlay(
        emitter,
        {},
        makeMockAdapter({
          handover_state: { in_scope: true, findings: [] },
          onDispatch: (_taskId, ctx) => {
            expect(ctx.task_definition.agent).toBe("architect");
            expect(ctx.constitution).toContain("FR-001: User login");
          },
        }),
      );

      const baseCtx = makeCtx({ agent: "developer" });
      const result = await overlay.postTask(
        {
          ...baseCtx,
          task_definition: {
            ...baseCtx.task_definition,
            overlays: { traceability: { enabled: true, lock_file: lockPath, evaluator_agent: "architect" } },
          },
        },
        makeResult(),
      );

      expect(result.accept).toBe(true);
      const evalEvent = events.find((e) => e.type === "traceability.evaluated");
      expect(evalEvent?.data["evaluator_agent"]).toBe("architect");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TraceabilityOverlay: auto-resolve evaluator_agent", () => {
  it("no evaluator_agent set → auto-resolves to 'reviewer'", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter, events } = makeEmitter();
      const adapter = makeMockAdapter({
        handover_state: { in_scope: true, findings: [] },
      });
      // No evaluator_agent — should auto-resolve to "reviewer"
      const overlay = new TraceabilityOverlay(emitter, {
        lockFilePath: lockPath,
      }, adapter);

      const result = await overlay.postTask(makeCtx({ agent: "developer" }), makeResult());
      expect(result.accept).toBe(true);

      const evalEvent = events.find((e) => e.type === "traceability.evaluated");
      expect(evalEvent).toBeDefined();
      expect(evalEvent?.data["evaluator_agent"]).toBe("reviewer");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("task agent is 'reviewer' + no explicit evaluator → skips self-evaluation", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter, events } = makeEmitter();
      const adapter = makeMockAdapter({
        handover_state: { in_scope: true, findings: [] },
      });
      const overlay = new TraceabilityOverlay(emitter, {
        lockFilePath: lockPath,
      }, adapter);

      // Task agent is "reviewer" — auto-resolved evaluator would also be "reviewer" → skip
      const result = await overlay.postTask(makeCtx({ agent: "reviewer", phase: "implement" }), makeResult());
      expect(result.accept).toBe(true);

      const skippedEvent = events.find((e) => e.type === "traceability.skipped");
      expect(skippedEvent).toBeDefined();
      expect(String(skippedEvent?.data["reason"])).toContain("same as task agent");

      // Should NOT have dispatched the judge
      const evalEvent = events.find((e) => e.type === "traceability.evaluated");
      expect(evalEvent).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explicit evaluator_agent overrides auto-resolve", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter, events } = makeEmitter();
      const adapter = makeMockAdapter({
        handover_state: { in_scope: true, findings: [] },
      });
      const overlay = new TraceabilityOverlay(emitter, {
        lockFilePath: lockPath,
        evaluator_agent: "architect",
      }, adapter);

      const result = await overlay.postTask(makeCtx({ agent: "developer" }), makeResult());
      expect(result.accept).toBe(true);

      const evalEvent = events.find((e) => e.type === "traceability.evaluated");
      expect(evalEvent).toBeDefined();
      expect(evalEvent?.data["evaluator_agent"]).toBe("architect");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TraceabilityOverlay: LLM judge results", () => {
  it("in_scope: true → accept: true with evidence", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter, events } = makeEmitter();
      const adapter = makeMockAdapter({
        handover_state: { in_scope: true, findings: ["All outputs traced to FR-001"] },
      });
      const overlay = new TraceabilityOverlay(emitter, {
        lockFilePath: lockPath,
        evaluator_agent: "reviewer",
      }, adapter);

      const result = await overlay.postTask(makeCtx(), makeResult());
      expect(result.accept).toBe(true);
      expect(result.new_status).toBe("COMPLETED");
      expect((result.data as Record<string, unknown>)?.["traceability"]).toBeDefined();

      const evalEvent = events.find((e) => e.type === "traceability.evaluated");
      expect(evalEvent).toBeDefined();
      expect(evalEvent?.data["in_scope"]).toBe(true);
      expect(evalEvent?.data["evaluator_agent"]).toBe("reviewer");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("in_scope: false → accept: false, NEEDS_REWORK with findings", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter, events } = makeEmitter();
      const adapter = makeMockAdapter({
        handover_state: {
          in_scope: false,
          findings: ["Introduced caching layer not in requirements", "Added analytics endpoint"],
        },
      });
      const overlay = new TraceabilityOverlay(emitter, {
        lockFilePath: lockPath,
        evaluator_agent: "reviewer",
      }, adapter);

      const result = await overlay.postTask(makeCtx(), makeResult());
      expect(result.accept).toBe(false);
      expect(result.new_status).toBe("NEEDS_REWORK");
      expect(result.feedback).toContain("Traceability check failed");
      expect(result.feedback).toContain("caching layer");

      const evalEvent = events.find((e) => e.type === "traceability.evaluated");
      expect(evalEvent).toBeDefined();
      expect(evalEvent?.data["in_scope"]).toBe(false);
      expect((evalEvent?.data["findings"] as string[]).length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TraceabilityOverlay: judge failure handling", () => {
  it("LLM judge dispatch failure → accept: true with traceability.failed event", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter, events } = makeEmitter();
      const adapter = makeMockAdapter({ fail: true, failError: "Judge agent crashed" });
      const overlay = new TraceabilityOverlay(emitter, {
        lockFilePath: lockPath,
        evaluator_agent: "reviewer",
      }, adapter);

      const result = await overlay.postTask(makeCtx(), makeResult());
      expect(result.accept).toBe(true);
      expect(result.new_status).toBe("COMPLETED");

      const failedEvent = events.find((e) => e.type === "traceability.failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent?.data["error"]).toContain("FAILED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TraceabilityOverlay: phase filtering", () => {
  it("phase: review → accept: true (skip — only design/implement)", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter } = makeEmitter();
      const adapter = makeMockAdapter({
        handover_state: { in_scope: false, findings: ["Should not reach judge"] },
      });
      const overlay = new TraceabilityOverlay(emitter, {
        lockFilePath: lockPath,
        evaluator_agent: "reviewer",
      }, adapter);

      const result = await overlay.postTask(makeCtx({ phase: "review" }), makeResult());
      expect(result.accept).toBe(true);
      expect(result.new_status).toBe("COMPLETED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("phase: design → runs judge (not skipped)", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter, events } = makeEmitter();
      const adapter = makeMockAdapter({
        handover_state: { in_scope: true, findings: [] },
      });
      const overlay = new TraceabilityOverlay(emitter, {
        lockFilePath: lockPath,
        evaluator_agent: "reviewer",
      }, adapter);

      const result = await overlay.postTask(makeCtx({ phase: "design" }), makeResult());
      expect(result.accept).toBe(true);

      const evalEvent = events.find((e) => e.type === "traceability.evaluated");
      expect(evalEvent).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TraceabilityOverlay: workflow-loader validation", () => {
  it("explicit evaluator_agent same as task agent → workflow-loader rejects", async () => {
    const { WorkflowLoader } = await import("../../../src/core/workflow-loader.ts");
    const yamlStr = `
version: "1"
name: test-wf
tasks:
  design-l1:
    agent: developer
    description: Design architecture
    overlays:
      traceability:
        enabled: true
        evaluator_agent: developer
`;
    expect(() => WorkflowLoader.loadYAML(yamlStr)).toThrow(
      /traceability evaluator_agent.*must differ from task agent/
    );
  });

  it("no evaluator_agent → workflow-loader accepts (auto-resolved at runtime)", async () => {
    const { WorkflowLoader } = await import("../../../src/core/workflow-loader.ts");
    const yamlStr = `
version: "1"
name: test-wf
tasks:
  design-l1:
    agent: developer
    description: Design architecture
    overlays:
      traceability:
        enabled: true
`;
    // Should not throw — evaluator_agent is optional, auto-resolved to "reviewer" at runtime
    expect(() => WorkflowLoader.loadYAML(yamlStr)).not.toThrow();
  });
});
