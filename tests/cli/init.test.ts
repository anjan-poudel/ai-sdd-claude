/**
 * Integration tests for `ai-sdd init` — verifies generated files match expectations.
 * CLAUDE.md §7: One integration test per CLI command.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const TEST_DIR = "/tmp/ai-sdd-test-init";
const CLI = "src/cli/index.ts";
const CWD = "/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude";

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
});

function runInit(tool: string): { exitCode: number; output: string } {
  mkdirSync(TEST_DIR, { recursive: true });
  const proc = Bun.spawnSync(
    ["bun", "run", CLI, "init", "--tool", tool, "--project", TEST_DIR],
    { cwd: CWD, env: { ...process.env } },
  );
  const stdout = new TextDecoder().decode(proc.stdout);
  const stderr = new TextDecoder().decode(proc.stderr);
  return { exitCode: proc.exitCode ?? 0, output: stdout + stderr };
}

describe("ai-sdd init --tool roo_code", () => {
  it("exits 0", () => {
    const { exitCode } = runInit("roo_code");
    expect(exitCode).toBe(0);
  });

  it("creates .roomodes with 6 modes", () => {
    runInit("roo_code");
    const roomodesPath = join(TEST_DIR, ".roomodes");
    expect(existsSync(roomodesPath)).toBe(true);
    const content = JSON.parse(readFileSync(roomodesPath, "utf-8")) as {
      customModes: Array<{ slug: string; groups: string[] }>;
    };
    expect(content.customModes).toHaveLength(6);
  });

  it("each mode includes 'mcp' in groups", () => {
    runInit("roo_code");
    const content = JSON.parse(readFileSync(join(TEST_DIR, ".roomodes"), "utf-8")) as {
      customModes: Array<{ slug: string; groups: string[] }>;
    };
    for (const mode of content.customModes) {
      expect(mode.groups).toContain("mcp");
    }
  });

  it("each mode has customInstructions with MCP tool sequence", () => {
    runInit("roo_code");
    const content = JSON.parse(readFileSync(join(TEST_DIR, ".roomodes"), "utf-8")) as {
      customModes: Array<{ slug: string; customInstructions?: string }>;
    };
    for (const mode of content.customModes) {
      expect(typeof mode.customInstructions).toBe("string");
      expect(mode.customInstructions!.length).toBeGreaterThan(0);
      // Must mention the key MCP tools
      expect(mode.customInstructions).toContain("get_next_task");
      expect(mode.customInstructions).toContain("complete_task");
      expect(mode.customInstructions).toContain("get_constitution");
    }
  });

  it("creates .roo/mcp.json pointing to ai-sdd serve --mcp", () => {
    runInit("roo_code");
    const mcpPath = join(TEST_DIR, ".roo", "mcp.json");
    expect(existsSync(mcpPath)).toBe(true);
    const config = JSON.parse(readFileSync(mcpPath, "utf-8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(config.mcpServers["ai-sdd"]).toBeDefined();
    expect(config.mcpServers["ai-sdd"].args).toContain("--mcp");
  });

  it("creates .ai-sdd/ai-sdd.yaml with adapter.type roo_code", () => {
    runInit("roo_code");
    const configPath = join(TEST_DIR, ".ai-sdd", "ai-sdd.yaml");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("type: roo_code");
  });
});

describe("ai-sdd init --tool claude_code", () => {
  it("exits 0", () => {
    const { exitCode } = runInit("claude_code");
    expect(exitCode).toBe(0);
  });

  it("creates .claude/agents/ directory with agent files", () => {
    runInit("claude_code");
    const agentsDir = join(TEST_DIR, ".claude", "agents");
    expect(existsSync(agentsDir)).toBe(true);
  });

  it("creates .claude/skills/ directory with skill files", () => {
    runInit("claude_code");
    const skillsDir = join(TEST_DIR, ".claude", "skills");
    expect(existsSync(skillsDir)).toBe(true);
  });

  it("creates CLAUDE.md with ai-sdd section", () => {
    runInit("claude_code");
    const claudeMdPath = join(TEST_DIR, "CLAUDE.md");
    expect(existsSync(claudeMdPath)).toBe(true);
    const content = readFileSync(claudeMdPath, "utf-8");
    expect(content).toContain("ai-sdd: Specification-Driven Development");
  });

  it("creates constitution.md", () => {
    runInit("claude_code");
    expect(existsSync(join(TEST_DIR, "constitution.md"))).toBe(true);
  });

  it("creates .ai-sdd/ai-sdd.yaml with adapter.type claude_code", () => {
    runInit("claude_code");
    const configPath = join(TEST_DIR, ".ai-sdd", "ai-sdd.yaml");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("type: claude_code");
  });
});

describe("ai-sdd init: unknown tool", () => {
  it("exits non-zero for unknown tool", () => {
    const { exitCode } = runInit("unknown-tool");
    expect(exitCode).not.toBe(0);
  });
});
