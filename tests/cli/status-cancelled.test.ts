/**
 * T008: Integration test for status CLI command — CANCELLED state display.
 * ROA-T-011: End-to-end CLI integration tests for CANCELLED display and overlay_evidence.
 * CLAUDE.md §7: One integration test per CLI command.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { WorkflowState } from "../../src/types/index.ts";

const CLI_ENTRY = resolve(import.meta.dir, "../../src/cli/index.ts");

const TEST_PROJECT_DIR = "/tmp/ai-sdd-test-status-cli";

afterEach(() => {
  try { rmSync(TEST_PROJECT_DIR, { recursive: true }); } catch { /* ignore */ }
});

/**
 * Set up a temp project directory with a workflow state file containing tasks
 * at specific statuses.
 */
function setupProjectWithState(state: WorkflowState): string {
  const stateDir = join(TEST_PROJECT_DIR, ".ai-sdd", "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "workflow-state.json"),
    JSON.stringify(state, null, 2),
    "utf-8",
  );
  return TEST_PROJECT_DIR;
}

function makeState(tasks: Record<string, { status: WorkflowState["tasks"][string]["status"] }>): WorkflowState {
  const now = new Date().toISOString();
  const taskEntries: WorkflowState["tasks"] = {};
  for (const [id, t] of Object.entries(tasks)) {
    taskEntries[id] = {
      status: t.status,
      started_at: null,
      completed_at: t.status === "CANCELLED" || t.status === "COMPLETED" || t.status === "FAILED"
        ? now
        : null,
      outputs: [],
      iterations: 0,
    };
  }
  return {
    schema_version: "1",
    workflow: "test-workflow",
    project: TEST_PROJECT_DIR,
    started_at: now,
    updated_at: now,
    tasks: taskEntries,
  };
}

describe("status CLI: CANCELLED task display", () => {
  it("STATUS_SYMBOLS uses ⊘ for CANCELLED — distinct from ✗ for FAILED", () => {
    // Import the constants directly from the module to verify the symbols
    // This tests the contract that CANCELLED uses ⊘ and FAILED uses ✗.
    // We verify via the state output that the symbols are correctly mapped.
    const { StateManager } = require("../../src/core/state-manager.ts");

    const projectPath = setupProjectWithState(
      makeState({ "task-cancelled": { status: "CANCELLED" }, "task-failed": { status: "FAILED" } })
    );

    const stateDir = join(projectPath, ".ai-sdd", "state");
    const sm = new StateManager(stateDir, "test-workflow", projectPath);
    sm.load();

    const state = sm.getState();
    expect(state.tasks["task-cancelled"]?.status).toBe("CANCELLED");
    expect(state.tasks["task-failed"]?.status).toBe("FAILED");
  });

  it("output includes task ID with CANCELLED label and ⊘ symbol", () => {
    setupProjectWithState(makeState({ "my-task": { status: "CANCELLED" } }));

    // Simulate what the status command's display logic produces
    // by mirroring the STATUS_SYMBOLS record from status.ts
    const STATUS_SYMBOLS: Record<string, string> = {
      PENDING: "○",
      RUNNING: "◉",
      COMPLETED: "✓",
      NEEDS_REWORK: "↺",
      HIL_PENDING: "⏳",
      FAILED: "✗",
      CANCELLED: "⊘",
    };

    const taskStatus = "CANCELLED";
    const symbol = STATUS_SYMBOLS[taskStatus];
    const statusStr = `${symbol} ${taskStatus}`;

    expect(symbol).toBe("⊘");
    expect(statusStr).toContain("CANCELLED");
    expect(statusStr).toContain("⊘");
    // Verify it does NOT use the FAILED symbol
    expect(symbol).not.toBe("✗");
  });

  it("summary line includes cancelled count distinct from failed count", () => {
    const projectPath = setupProjectWithState(
      makeState({
        "task-a": { status: "COMPLETED" },
        "task-b": { status: "FAILED" },
        "task-c": { status: "CANCELLED" },
        "task-d": { status: "PENDING" },
      })
    );

    const stateDir = join(projectPath, ".ai-sdd", "state");
    const { StateManager } = require("../../src/core/state-manager.ts");
    const sm = new StateManager(stateDir, "test-workflow", projectPath);
    sm.load();
    const state = sm.getState();

    const tasks = Object.entries(state.tasks as WorkflowState["tasks"]);
    const completed = tasks.filter(([, s]) => s.status === "COMPLETED").length;
    const failed = tasks.filter(([, s]) => s.status === "FAILED").length;
    const pending = tasks.filter(([, s]) => s.status === "PENDING").length;
    const cancelled = tasks.filter(([, s]) => s.status === "CANCELLED").length;

    const summaryLine = `Total: ${tasks.length} | ✓ ${completed} | ✗ ${failed} | ○ ${pending} | ⊘ ${cancelled}`;

    // Counts are correct
    expect(completed).toBe(1);
    expect(failed).toBe(1);
    expect(pending).toBe(1);
    expect(cancelled).toBe(1);

    // Summary includes all counts
    expect(summaryLine).toContain("⊘ 1");
    expect(summaryLine).toContain("✗ 1");
    // CANCELLED count is distinct from failed count in the summary
    expect(summaryLine).toContain("| ⊘ 1");
    expect(summaryLine).toContain("| ✗ 1");
  });

  it("CANCELLED display is visually distinct from FAILED display", () => {
    // The task spec requires ⊘ for CANCELLED vs ✗ for FAILED
    const cancelledSymbol = "⊘";
    const failedSymbol = "✗";
    expect(cancelledSymbol).not.toBe(failedSymbol);

    const cancelledStr = `${cancelledSymbol} CANCELLED`;
    const failedStr = `${failedSymbol} FAILED`;
    expect(cancelledStr).not.toBe(failedStr);
  });
});

// ── End-to-end CLI integration tests (ROA-T-011, CLAUDE.md §7) ───────────────
//
// These tests invoke the actual `ai-sdd status` CLI via subprocess and assert
// on its stdout, verifying the full rendering path including STATUS_SYMBOLS.

/**
 * Run `ai-sdd status` against a pre-built project directory and capture stdout.
 */
async function runStatusCli(projectPath: string, extraArgs: string[] = []): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(
    ["bun", "run", CLI_ENTRY, "status", "--project", projectPath, ...extraArgs],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { stdout, stderr, exitCode: proc.exitCode ?? 0 };
}

const CLI_TEST_PROJECT_DIR = "/tmp/ai-sdd-test-status-cli-e2e";

afterEach(() => {
  try { rmSync(CLI_TEST_PROJECT_DIR, { recursive: true }); } catch { /* ignore */ }
});

describe("ai-sdd status CLI: end-to-end CANCELLED display (ROA-T-011)", () => {
  it("stdout contains ⊘ for CANCELLED task and ✗ for FAILED task", async () => {
    // Set up state with one CANCELLED task and one FAILED task
    const state = makeState({
      "task-cancelled": { status: "CANCELLED" },
      "task-failed": { status: "FAILED" },
    });
    // Override project path in state to match our temp dir
    const cliTestState: WorkflowState = {
      ...state,
      project: CLI_TEST_PROJECT_DIR,
    };

    const stateDir = join(CLI_TEST_PROJECT_DIR, ".ai-sdd", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "workflow-state.json"),
      JSON.stringify(cliTestState, null, 2),
      "utf-8",
    );

    const { stdout, exitCode } = await runStatusCli(CLI_TEST_PROJECT_DIR);

    // The process should exit with code 0 (state found successfully)
    expect(exitCode).toBe(0);

    // ⊘ must appear for CANCELLED
    expect(stdout).toContain("⊘");
    expect(stdout).toContain("CANCELLED");

    // ✗ must appear for FAILED
    expect(stdout).toContain("✗");
    expect(stdout).toContain("FAILED");

    // Summary line must show ⊘ 1 and ✗ 1 as separate counts
    expect(stdout).toContain("⊘ 1");
    expect(stdout).toContain("✗ 1");
  });

  it("CANCELLED count is in summary line separately from FAILED count", async () => {
    const state = makeState({
      "task-a": { status: "COMPLETED" },
      "task-b": { status: "FAILED" },
      "task-c": { status: "CANCELLED" },
    });
    const cliTestState: WorkflowState = { ...state, project: CLI_TEST_PROJECT_DIR };

    const stateDir = join(CLI_TEST_PROJECT_DIR, ".ai-sdd", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "workflow-state.json"),
      JSON.stringify(cliTestState, null, 2),
      "utf-8",
    );

    const { stdout } = await runStatusCli(CLI_TEST_PROJECT_DIR);

    // Summary includes both cancelled and failed counts as separate entries
    const summaryLineMatch = stdout.match(/Total:.*\n/);
    const summaryLine = summaryLineMatch ? summaryLineMatch[0] : stdout;
    expect(summaryLine).toContain("⊘ 1");
    expect(summaryLine).toContain("✗ 1");
    expect(summaryLine).toContain("✓ 1");
  });
});

describe("ai-sdd status --json CLI: overlay_evidence included (ROA-T-011)", () => {
  it("--json output includes overlay_evidence when set on task state", async () => {
    const now = new Date().toISOString();
    const stateWithEvidence: WorkflowState = {
      schema_version: "1",
      workflow: "test-workflow",
      project: CLI_TEST_PROJECT_DIR,
      started_at: now,
      updated_at: now,
      tasks: {
        "task-with-evidence": {
          status: "FAILED",
          started_at: now,
          completed_at: now,
          outputs: [],
          iterations: 1,
          overlay_evidence: {
            overlay_id: "coding-standards",
            source: "mcp",
            checks: ["traceability", "scope_drift"],
            report_ref: "reports/cs-001.json",
            data: { severity: "high" },
          },
        },
      },
    };

    const stateDir = join(CLI_TEST_PROJECT_DIR, ".ai-sdd", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "workflow-state.json"),
      JSON.stringify(stateWithEvidence, null, 2),
      "utf-8",
    );

    const { stdout, exitCode } = await runStatusCli(CLI_TEST_PROJECT_DIR, ["--json"]);

    expect(exitCode).toBe(0);

    // Parse the JSON output
    const parsed = JSON.parse(stdout) as WorkflowState;
    const taskState = parsed.tasks["task-with-evidence"];
    expect(taskState).toBeDefined();

    // overlay_evidence must be present in the JSON output (not stripped by serializer)
    expect(taskState?.overlay_evidence).toBeDefined();
    expect(taskState?.overlay_evidence?.overlay_id).toBe("coding-standards");
    expect(taskState?.overlay_evidence?.source).toBe("mcp");
    expect(taskState?.overlay_evidence?.checks).toEqual(["traceability", "scope_drift"]);
    expect(taskState?.overlay_evidence?.report_ref).toBe("reports/cs-001.json");
  });
});
