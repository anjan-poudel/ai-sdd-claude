/**
 * Integration tests for `ai-sdd sessions` command.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = "/tmp/ai-sdd-test-sessions";
const CLI = "src/cli/index.ts";
const CWD = "/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude";

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, ".ai-sdd", "sessions"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function runSessions(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(
    ["bun", "run", CLI, "sessions", ...args, "--project", TEST_DIR],
    { cwd: CWD, env: { ...process.env } },
  );
  return {
    exitCode: proc.exitCode ?? 0,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

describe("sessions list", () => {
  it("shows no sessions when empty", () => {
    const { stdout } = runSessions(["list"]);
    expect(stdout).toContain("No sessions found");
  });

  it("lists created sessions", () => {
    // Create two sessions
    runSessions(["create", "alpha"]);
    runSessions(["create", "beta"]);

    const { stdout } = runSessions(["list"]);
    expect(stdout).toContain("alpha");
    expect(stdout).toContain("beta");
  });

  it("marks active session", () => {
    runSessions(["create", "alpha"]);
    runSessions(["create", "beta"]);
    runSessions(["switch", "alpha"]);

    const { stdout } = runSessions(["list"]);
    expect(stdout).toContain("alpha (active)");
  });

  it("outputs JSON with --json", () => {
    runSessions(["create", "test-session"]);

    const { stdout } = runSessions(["list", "--json"]);
    const data = JSON.parse(stdout) as { sessions: Array<{ name: string; active: boolean; tasks: number }> };
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0]!.name).toBe("test-session");
    expect(data.sessions[0]!.tasks).toBe(0);
  });
});

describe("sessions active", () => {
  it("defaults to 'default' when no active-session file", () => {
    const { stdout } = runSessions(["active"]);
    expect(stdout.trim()).toBe("default");
  });

  it("returns active session name after switch", () => {
    runSessions(["create", "my-feature"]);
    runSessions(["switch", "my-feature"]);

    const { stdout } = runSessions(["active"]);
    expect(stdout.trim()).toBe("my-feature");
  });

  it("outputs JSON with --json", () => {
    const { stdout } = runSessions(["active", "--json"]);
    const data = JSON.parse(stdout) as { active_session: string };
    expect(data.active_session).toBe("default");
  });
});

describe("sessions create", () => {
  it("creates session directory with subdirs", () => {
    const { exitCode } = runSessions(["create", "new-feature"]);
    expect(exitCode).toBe(0);

    const sessionDir = join(TEST_DIR, ".ai-sdd", "sessions", "new-feature");
    expect(existsSync(sessionDir)).toBe(true);
    expect(existsSync(join(sessionDir, "hil"))).toBe(true);
    expect(existsSync(join(sessionDir, "outputs"))).toBe(true);
    expect(existsSync(join(sessionDir, "pair-sessions"))).toBe(true);
    expect(existsSync(join(sessionDir, "review-logs"))).toBe(true);
  });

  it("is idempotent — does not error on existing session", () => {
    runSessions(["create", "existing"]);
    const { exitCode, stdout } = runSessions(["create", "existing"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("already exists");
  });
});

describe("sessions switch", () => {
  it("sets active session", () => {
    runSessions(["create", "target"]);
    runSessions(["switch", "target"]);

    const content = readFileSync(
      join(TEST_DIR, ".ai-sdd", "active-session"),
      "utf-8",
    );
    expect(content.trim()).toBe("target");
  });

  it("auto-creates session if it does not exist", () => {
    const { stdout } = runSessions(["switch", "auto-created"]);
    expect(stdout).toContain("does not exist");
    expect(stdout).toContain("Creating");

    const sessionDir = join(TEST_DIR, ".ai-sdd", "sessions", "auto-created");
    expect(existsSync(sessionDir)).toBe(true);
  });
});
