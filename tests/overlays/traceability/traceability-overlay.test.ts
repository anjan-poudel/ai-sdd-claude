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
}): RuntimeAdapter {
  return {
    dispatch_mode: "direct",
    adapter_type: "mock",
    dispatch: async (_agent: string, _ctx: AgentContext, _opts: DispatchOptions): Promise<TaskResult> => {
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
  it("enabled: false → accept: true (skip)", async () => {
    const { emitter } = makeEmitter();
    const overlay = new TraceabilityOverlay(emitter, { enabled: false });
    expect(overlay.enabled).toBe(false);
    // postTask should still work but overlay is flagged as disabled
    // The overlay chain runner checks .enabled before calling postTask
  });
});

describe("TraceabilityOverlay: lock file handling", () => {
  it("no lock file → accept: true with traceability.skipped event", async () => {
    const { emitter, events } = makeEmitter();
    const adapter = makeMockAdapter({ handover_state: { in_scope: true, findings: [] } });
    const overlay = new TraceabilityOverlay(emitter, {
      enabled: true,
      lockFilePath: "/nonexistent/path/requirements.lock.yaml",
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
        enabled: true,
        lockFilePath: lockPath,
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

describe("TraceabilityOverlay: LLM judge results", () => {
  it("in_scope: true → accept: true with evidence", async () => {
    const { dir, lockPath } = createTempLockFile();
    try {
      const { emitter, events } = makeEmitter();
      const adapter = makeMockAdapter({
        handover_state: { in_scope: true, findings: ["All outputs traced to FR-001"] },
      });
      const overlay = new TraceabilityOverlay(emitter, {
        enabled: true,
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
        enabled: true,
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
        enabled: true,
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
        enabled: true,
        lockFilePath: lockPath,
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
        enabled: true,
        lockFilePath: lockPath,
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
  it("evaluator_agent same as task agent → workflow-loader rejects", async () => {
    // This tests the workflow-loader validation, not the overlay itself
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
});
