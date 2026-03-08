/**
 * Tests for `ai-sdd status --next --json` DAG-awareness.
 * CLAUDE.md §1: config-to-behaviour — DAG dependency state changes which tasks are returned.
 * CLAUDE.md §7: One integration test per CLI command.
 *
 * Fixes gap reported in docs/deep-gap-analysis-opus.md §4:
 *   "status --next --json returns blocked tasks" (severity High/Correctness)
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = "/tmp/ai-sdd-test-status-next-dag";
const CLI = "src/cli/index.ts";
const CWD = "/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude";

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
});

function setupProject(workflowYaml: string, stateJson: object): string {
  const stateDir = join(TEST_DIR, ".ai-sdd", "state");
  const specsDir = join(TEST_DIR, "specs");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(specsDir, { recursive: true });

  writeFileSync(join(specsDir, "workflow.yaml"), workflowYaml, "utf-8");
  writeFileSync(join(stateDir, "workflow-state.json"), JSON.stringify(stateJson), "utf-8");
  return TEST_DIR;
}

function runStatus(projectPath: string): { exitCode: number; output: string } {
  const proc = Bun.spawnSync(
    ["bun", "run", CLI, "status", "--next", "--json", "--project", projectPath],
    { cwd: CWD, env: { ...process.env } },
  );
  const stdout = new TextDecoder().decode(proc.stdout);
  const stderr = new TextDecoder().decode(proc.stderr);
  return { exitCode: proc.exitCode ?? 0, output: stdout + stderr };
}

describe("status --next --json: DAG dependency filtering", () => {
  it("returns only unblocked PENDING tasks when dependencies are not yet COMPLETED", () => {
    const workflow = `
version: "1"
name: test-wf
tasks:
  task-a:
    agent: dev
    description: First task
  task-b:
    agent: dev
    description: Depends on A
    depends_on: [task-a]
  task-c:
    agent: dev
    description: Depends on B
    depends_on: [task-b]
`;
    const state = {
      schema_version: "1",
      workflow: "test-wf",
      project: TEST_DIR,
      started_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:01Z",
      tasks: {
        "task-a": {
          status: "PENDING",
          started_at: null,
          completed_at: null,
          outputs: [],
          iterations: 0,
        },
        "task-b": {
          status: "PENDING",
          started_at: null,
          completed_at: null,
          outputs: [],
          iterations: 0,
        },
        "task-c": {
          status: "PENDING",
          started_at: null,
          completed_at: null,
          outputs: [],
          iterations: 0,
        },
      },
    };

    setupProject(workflow, state);
    const { output } = runStatus(TEST_DIR);
    const parsed = JSON.parse(output.trim());
    const ids = parsed.ready_tasks.map((t: { id: string }) => t.id);

    // Only task-a has no dependencies → should be the only ready task
    expect(ids).toContain("task-a");
    expect(ids).not.toContain("task-b");
    expect(ids).not.toContain("task-c");
  });

  it("returns task-b when task-a is COMPLETED but task-b still PENDING", () => {
    const workflow = `
version: "1"
name: test-wf
tasks:
  task-a:
    agent: dev
    description: First
  task-b:
    agent: dev
    description: Depends on A
    depends_on: [task-a]
`;
    const state = {
      schema_version: "1",
      workflow: "test-wf",
      project: TEST_DIR,
      started_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:01Z",
      tasks: {
        "task-a": {
          status: "COMPLETED",
          started_at: "2024-01-01T00:00:00Z",
          completed_at: "2024-01-01T00:00:01Z",
          outputs: [],
          iterations: 1,
        },
        "task-b": {
          status: "PENDING",
          started_at: null,
          completed_at: null,
          outputs: [],
          iterations: 0,
        },
      },
    };

    setupProject(workflow, state);
    const { output } = runStatus(TEST_DIR);
    const parsed = JSON.parse(output.trim());
    const ids = parsed.ready_tasks.map((t: { id: string }) => t.id);

    expect(ids).toContain("task-b");
    expect(ids).not.toContain("task-a");
  });

  it("returns no ready tasks when all PENDING tasks are blocked", () => {
    const workflow = `
version: "1"
name: test-wf
tasks:
  task-a:
    agent: dev
    description: Running
  task-b:
    agent: dev
    description: Depends on running A
    depends_on: [task-a]
`;
    const state = {
      schema_version: "1",
      workflow: "test-wf",
      project: TEST_DIR,
      started_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:01Z",
      tasks: {
        "task-a": {
          status: "RUNNING",
          started_at: "2024-01-01T00:00:00Z",
          completed_at: null,
          outputs: [],
          iterations: 1,
        },
        "task-b": {
          status: "PENDING",
          started_at: null,
          completed_at: null,
          outputs: [],
          iterations: 0,
        },
      },
    };

    setupProject(workflow, state);
    const { output } = runStatus(TEST_DIR);
    const parsed = JSON.parse(output.trim());
    const ids = parsed.ready_tasks.map((t: { id: string }) => t.id);

    // task-b depends on task-a which is RUNNING (not COMPLETED) → blocked
    expect(ids).toHaveLength(0);
  });

  it("returns tasks with no depends_on declared when workflow file is absent (graceful fallback)", () => {
    // When no workflow file found, dependsOn = {} means all PENDING tasks are treated as ready
    const stateDir = join(TEST_DIR, ".ai-sdd", "state");
    mkdirSync(stateDir, { recursive: true });
    // No workflow file — just state
    const state = {
      schema_version: "1",
      workflow: "test-wf",
      project: TEST_DIR,
      started_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:01Z",
      tasks: {
        "task-a": {
          status: "PENDING",
          started_at: null,
          completed_at: null,
          outputs: [],
          iterations: 0,
        },
      },
    };
    writeFileSync(join(stateDir, "workflow-state.json"), JSON.stringify(state), "utf-8");

    const { output } = runStatus(TEST_DIR);
    const parsed = JSON.parse(output.trim());
    const ids = parsed.ready_tasks.map((t: { id: string }) => t.id);

    // Without workflow file, no deps known → task-a (PENDING, no known deps) is returned
    expect(ids).toContain("task-a");
  });
});
