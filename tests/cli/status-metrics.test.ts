/**
 * CLI integration test: ai-sdd status --metrics
 *
 * Verifies that persisted tokens_used and cost_usd on TaskState are rendered
 * in the Tokens and Cost columns when --metrics is passed.
 * CLAUDE.md §7: One integration test per CLI command.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { WorkflowState } from "../../src/types/index.ts";

const CLI_ENTRY = resolve(import.meta.dir, "../../src/cli/index.ts");
const TEST_PROJECT_DIR = "/tmp/ai-sdd-test-status-metrics";

afterEach(() => {
  try { rmSync(TEST_PROJECT_DIR, { recursive: true }); } catch { /* ignore */ }
});

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

function setupStateWithMetrics(): string {
  const now = new Date().toISOString();
  const startedAt = new Date(Date.now() - 30_000).toISOString(); // 30s ago

  const state: WorkflowState = {
    schema_version: "1",
    workflow: "test-workflow",
    project: TEST_PROJECT_DIR,
    started_at: now,
    updated_at: now,
    tasks: {
      "task-with-tokens": {
        status: "COMPLETED",
        started_at: startedAt,
        completed_at: now,
        outputs: [],
        iterations: 1,
        tokens_used: { input: 1000, output: 500, total: 1500 },
        cost_usd: 0.0045,
      },
      "task-no-tokens": {
        status: "PENDING",
        started_at: null,
        completed_at: null,
        outputs: [],
        iterations: 0,
      },
    },
  };

  const stateDir = join(TEST_PROJECT_DIR, ".ai-sdd", "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "workflow-state.json"),
    JSON.stringify(state, null, 2),
    "utf-8",
  );
  return TEST_PROJECT_DIR;
}

describe("ai-sdd status --metrics: column headers", () => {
  it("header includes Tokens and Cost columns", async () => {
    setupStateWithMetrics();
    const { stdout, exitCode } = await runStatusCli(TEST_PROJECT_DIR, ["--metrics"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Tokens");
    expect(stdout).toContain("Cost");
  });

  it("header does NOT include Tokens/Cost columns without --metrics", async () => {
    setupStateWithMetrics();
    const { stdout, exitCode } = await runStatusCli(TEST_PROJECT_DIR);

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("Tokens");
    expect(stdout).not.toContain("Cost");
  });
});

describe("ai-sdd status --metrics: per-task token/cost values", () => {
  it("renders token count for task with tokens_used", async () => {
    setupStateWithMetrics();
    const { stdout } = await runStatusCli(TEST_PROJECT_DIR, ["--metrics"]);

    // 1500 total tokens should appear in the row
    expect(stdout).toContain("1500");
  });

  it("renders dollar cost for task with cost_usd", async () => {
    setupStateWithMetrics();
    const { stdout } = await runStatusCli(TEST_PROJECT_DIR, ["--metrics"]);

    // $0.0045 formatted as $0.0045
    expect(stdout).toContain("0.0045");
  });

  it("renders em-dash for task with no tokens_used", async () => {
    setupStateWithMetrics();
    const { stdout } = await runStatusCli(TEST_PROJECT_DIR, ["--metrics"]);

    // task-no-tokens has no tokens_used — em-dash placeholder
    expect(stdout).toContain("—");
  });

  it("renders duration for completed task with started_at and completed_at", async () => {
    setupStateWithMetrics();
    const { stdout } = await runStatusCli(TEST_PROJECT_DIR, ["--metrics"]);

    // Duration ~30s should appear — matches Ns pattern
    expect(stdout).toMatch(/\d+\.\d+s|\d+m\d+s/);
  });
});

describe("ai-sdd status --metrics: footer totals", () => {
  it("footer includes 'tokens:' label", async () => {
    setupStateWithMetrics();
    const { stdout } = await runStatusCli(TEST_PROJECT_DIR, ["--metrics"]);

    expect(stdout).toContain("tokens:");
  });

  it("footer includes 'cost:' label with dollar sign", async () => {
    setupStateWithMetrics();
    const { stdout } = await runStatusCli(TEST_PROJECT_DIR, ["--metrics"]);

    expect(stdout).toContain("cost: $");
  });

  it("footer total tokens sums all tasks", async () => {
    setupStateWithMetrics();
    const { stdout } = await runStatusCli(TEST_PROJECT_DIR, ["--metrics"]);

    // Only task-with-tokens has 1500 tokens; task-no-tokens has 0
    expect(stdout).toContain("tokens: 1500");
  });

  it("footer total cost sums all tasks", async () => {
    setupStateWithMetrics();
    const { stdout } = await runStatusCli(TEST_PROJECT_DIR, ["--metrics"]);

    // Only task-with-tokens has $0.0045
    expect(stdout).toContain("cost: $0.0045");
  });

  it("footer does NOT include tokens/cost without --metrics", async () => {
    setupStateWithMetrics();
    const { stdout } = await runStatusCli(TEST_PROJECT_DIR);

    expect(stdout).not.toContain("tokens:");
    expect(stdout).not.toContain("cost: $");
  });
});

describe("ai-sdd status --metrics: multiple tasks with tokens", () => {
  it("sums total tokens across multiple completed tasks", async () => {
    const now = new Date().toISOString();
    const state: WorkflowState = {
      schema_version: "1",
      workflow: "test-workflow",
      project: TEST_PROJECT_DIR,
      started_at: now,
      updated_at: now,
      tasks: {
        "task-a": {
          status: "COMPLETED",
          started_at: now,
          completed_at: now,
          outputs: [],
          iterations: 1,
          tokens_used: { input: 500, output: 250, total: 750 },
          cost_usd: 0.0020,
        },
        "task-b": {
          status: "COMPLETED",
          started_at: now,
          completed_at: now,
          outputs: [],
          iterations: 1,
          tokens_used: { input: 600, output: 200, total: 800 },
          cost_usd: 0.0030,
        },
      },
    };

    const stateDir = join(TEST_PROJECT_DIR, ".ai-sdd", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "workflow-state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );

    const { stdout, exitCode } = await runStatusCli(TEST_PROJECT_DIR, ["--metrics"]);

    expect(exitCode).toBe(0);
    // 750 + 800 = 1550 total tokens
    expect(stdout).toContain("tokens: 1550");
    // $0.0020 + $0.0030 = $0.0050
    expect(stdout).toContain("cost: $0.0050");
  });
});
