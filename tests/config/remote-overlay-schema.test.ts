/**
 * T007: Remote overlay config schema validation tests.
 * CLAUDE.md §1: Config-to-behavior — each test changes a field and asserts different outcome.
 * CLAUDE.md §5: Error messages are contracts — verified by assertion.
 * CLAUDE.md §7: One integration test per CLI command — validate-config integration tests below.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  parseRemoteOverlayConfig,
  OverlayBackendConfigSchema,
  RemoteOverlayConfigSchema,
} from "../../src/config/remote-overlay-schema.ts";
import { loadRemoteOverlayConfig } from "../../src/cli/config-loader.ts";

const TEST_PROJECT_DIR = "/tmp/ai-sdd-test-remote-overlay-config";

afterEach(() => {
  try { rmSync(TEST_PROJECT_DIR, { recursive: true }); } catch { /* ignore */ }
});

function setupProject(yamlContent: string): string {
  const configDir = join(TEST_PROJECT_DIR, ".ai-sdd");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "ai-sdd.yaml"), yamlContent, "utf-8");
  return TEST_PROJECT_DIR;
}

// ─── Schema validation tests ───────────────────────────────────────────────────

describe("parseRemoteOverlayConfig: valid inputs", () => {
  it("1. valid MCP backend + remote overlay config accepted — returns typed object", () => {
    const raw = {
      overlay_backends: {
        "coding-standards": {
          runtime: "mcp",
          command: ["bun", "run", "server.ts"],
          tool: "overlay.invoke",
        },
      },
      remote_overlays: {
        "coding-standards-pre": {
          backend: "coding-standards",
          hooks: ["pre_task"],
        },
      },
    };
    const result = parseRemoteOverlayConfig(raw);
    expect(result).not.toBeUndefined();
    expect(result?.overlay_backends?.["coding-standards"]).not.toBeUndefined();
    expect(result?.overlay_backends?.["coding-standards"]?.runtime).toBe("mcp");
    expect(result?.overlay_backends?.["coding-standards"]?.tool).toBe("overlay.invoke");
    expect(result?.remote_overlays?.["coding-standards-pre"]?.backend).toBe("coding-standards");
  });

  it("8. absent section (input undefined) → returns undefined", () => {
    const result = parseRemoteOverlayConfig(undefined);
    expect(result).toBeUndefined();
  });

  it("9. absent section — no behavior change (existing config loads without error)", () => {
    // An existing config without new keys should produce undefined — no ZodError thrown
    expect(() => parseRemoteOverlayConfig(undefined)).not.toThrow();
    expect(() => parseRemoteOverlayConfig({})).not.toThrow();
  });

  it("CLI backend (non-mcp) is valid without tool field", () => {
    const raw = {
      overlay_backends: {
        "my-cli-overlay": {
          runtime: "cli",
          command: ["./check.sh"],
        },
      },
    };
    const result = parseRemoteOverlayConfig(raw);
    expect(result?.overlay_backends?.["my-cli-overlay"]?.runtime).toBe("cli");
  });
});

describe("parseRemoteOverlayConfig: default values", () => {
  it("4. timeout_ms defaults to 5000 when omitted", () => {
    const result = OverlayBackendConfigSchema.parse({
      runtime: "mcp",
      command: ["server"],
      tool: "invoke",
    });
    expect(result.timeout_ms).toBe(5000);
  });

  it("5. failure_policy defaults to 'warn' when omitted", () => {
    const result = OverlayBackendConfigSchema.parse({
      runtime: "mcp",
      command: ["server"],
      tool: "invoke",
    });
    expect(result.failure_policy).toBe("warn");
  });

  it("transport defaults to 'stdio' when omitted", () => {
    const result = OverlayBackendConfigSchema.parse({
      runtime: "mcp",
      command: ["server"],
      tool: "invoke",
    });
    expect(result.transport).toBe("stdio");
  });

  it("6. enabled defaults to true when omitted", () => {
    const result = RemoteOverlayConfigSchema.parse({
      backend: "my-backend",
      hooks: ["pre_task"],
    });
    expect(result.enabled).toBe(true);
  });

  it("7. blocking defaults to true when omitted", () => {
    const result = RemoteOverlayConfigSchema.parse({
      backend: "my-backend",
      hooks: ["pre_task"],
    });
    expect(result.blocking).toBe(true);
  });
});

describe("parseRemoteOverlayConfig: validation errors", () => {
  it("2. MCP backend without tool field → valid (auto-discovery handles it at runtime)", () => {
    // tool: is now optional — ai-sdd discovers the overlay tool via tools/list fingerprint.
    const raw = {
      overlay_backends: {
        "no-tool-backend": {
          runtime: "mcp",
          command: ["server"],
          // tool intentionally absent — auto-discovery will resolve it
        },
      },
    };
    let caught: unknown;
    try {
      parseRemoteOverlayConfig(raw);
    } catch (err) {
      caught = err;
    }
    // No error expected — MCP backend without tool: is valid
    expect(caught).toBeUndefined();
  });

  it("14. MCP backend without tool: parses successfully — tool is optional since auto-discovery", () => {
    const result = OverlayBackendConfigSchema.safeParse({
      runtime: "mcp",
      command: ["server"],
      // no tool — valid; resolved at runtime via tools/list fingerprint
    });
    expect(result.success).toBe(true);
  });

  it("3. hooks: [] (empty array) → ZodError with message naming hooks and minimum constraint", () => {
    const result = RemoteOverlayConfigSchema.safeParse({
      backend: "my-backend",
      hooks: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.errors.map((e) => e.message).join(" ");
      expect(messages.toLowerCase()).toContain("hooks");
    }
  });

  it("failure_policy 'fail_closed' is accepted", () => {
    const result = OverlayBackendConfigSchema.safeParse({
      runtime: "cli",
      command: ["./check.sh"],
      failure_policy: "fail_closed",
    });
    expect(result.success).toBe(true);
  });

  it("unknown failure_policy is rejected", () => {
    const result = OverlayBackendConfigSchema.safeParse({
      runtime: "cli",
      command: ["./check.sh"],
      failure_policy: "ignore",
    });
    expect(result.success).toBe(false);
  });

  it("empty command array is rejected", () => {
    const result = OverlayBackendConfigSchema.safeParse({
      runtime: "cli",
      command: [],
    });
    expect(result.success).toBe(false);
  });

  it("invalid runtime is rejected", () => {
    const result = OverlayBackendConfigSchema.safeParse({
      runtime: "http",
      command: ["server"],
    });
    expect(result.success).toBe(false);
  });
});

// ─── Config-to-behavior tests (CLAUDE.md §1) ──────────────────────────────────

describe("parseRemoteOverlayConfig: config-to-behavior", () => {
  it("5. failure_policy: 'fail_closed' vs 'warn' → different field values after parse", () => {
    const failClosed = OverlayBackendConfigSchema.parse({
      runtime: "cli",
      command: ["./check.sh"],
      failure_policy: "fail_closed",
    });
    const warn = OverlayBackendConfigSchema.parse({
      runtime: "cli",
      command: ["./check.sh"],
      failure_policy: "warn",
    });
    // Assert different outcomes
    expect(failClosed.failure_policy).toBe("fail_closed");
    expect(warn.failure_policy).toBe("warn");
    expect(failClosed.failure_policy).not.toBe(warn.failure_policy);
  });

  it("timeout_ms: 100 vs 2000 → different parsed values", () => {
    const short = OverlayBackendConfigSchema.parse({
      runtime: "cli",
      command: ["./check.sh"],
      timeout_ms: 100,
    });
    const long = OverlayBackendConfigSchema.parse({
      runtime: "cli",
      command: ["./check.sh"],
      timeout_ms: 2000,
    });
    expect(short.timeout_ms).toBe(100);
    expect(long.timeout_ms).toBe(2000);
    expect(short.timeout_ms).not.toBe(long.timeout_ms);
  });

  it("governance.requirements_lock: 'off' vs 'enforce' → different parsed values", () => {
    const off = parseRemoteOverlayConfig({ governance: { requirements_lock: "off" } });
    const enforce = parseRemoteOverlayConfig({ governance: { requirements_lock: "enforce" } });
    expect(off?.governance?.requirements_lock).toBe("off");
    expect(enforce?.governance?.requirements_lock).toBe("enforce");
    expect(off?.governance?.requirements_lock).not.toBe(enforce?.governance?.requirements_lock);
  });
});

// ─── loadRemoteOverlayConfig (file-based) ─────────────────────────────────────

describe("loadRemoteOverlayConfig: file-based loading", () => {
  it("returns undefined when config file does not exist", () => {
    const result = loadRemoteOverlayConfig("/tmp/nonexistent-project-xyz");
    expect(result).toBeUndefined();
  });

  it("returns undefined when config has no remote overlay keys", () => {
    setupProject("version: '1'\nadapter:\n  type: mock\n");
    const result = loadRemoteOverlayConfig(TEST_PROJECT_DIR);
    expect(result).toBeUndefined();
  });

  it("returns config when overlay_backends is present", () => {
    setupProject(`version: '1'
overlay_backends:
  coding-std:
    runtime: mcp
    command: [bun, run, server.ts]
    tool: overlay.invoke
`);
    const result = loadRemoteOverlayConfig(TEST_PROJECT_DIR);
    expect(result).not.toBeUndefined();
    expect(result?.overlay_backends?.["coding-std"]?.runtime).toBe("mcp");
  });

  it("returns config when governance key is present", () => {
    setupProject(`version: '1'
governance:
  requirements_lock: enforce
`);
    const result = loadRemoteOverlayConfig(TEST_PROJECT_DIR);
    expect(result).not.toBeUndefined();
    expect(result?.governance?.requirements_lock).toBe("enforce");
  });

  it("returns config when remote_overlays key is present", () => {
    setupProject(`version: '1'
remote_overlays:
  my-overlay:
    backend: my-backend
    hooks: [pre_task]
`);
    const result = loadRemoteOverlayConfig(TEST_PROJECT_DIR);
    expect(result).not.toBeUndefined();
    expect(result?.remote_overlays?.["my-overlay"]?.backend).toBe("my-backend");
  });
});

// ─── CLI integration tests (CLAUDE.md §7) ─────────────────────────────────────

describe("validate-config CLI: remote overlay config integration", () => {
  it("12. invalid remote overlay config → exits non-zero; output includes error details", async () => {
    // Set up a project with invalid remote overlay config (unknown runtime value)
    setupProject(`version: '1'
overlay_backends:
  bad-backend:
    runtime: unknown_runtime
    command: [server]
`);

    const proc = Bun.spawnSync(
      ["bun", "run", "src/cli/index.ts", "validate-config", "--project", TEST_PROJECT_DIR],
      {
        cwd: "/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude",
        env: { ...process.env },
      }
    );

    const stdout = new TextDecoder().decode(proc.stdout);
    const stderr = new TextDecoder().decode(proc.stderr);
    const output = stdout + stderr;

    // Must exit non-zero
    expect(proc.exitCode).not.toBe(0);
    // Must mention the error
    expect(output).toContain("remote overlay config");
  });

  it("13. validate-config with no remote overlay config → exits zero; no false errors", async () => {
    // Set up a minimal valid config without any remote overlay keys
    setupProject(`version: '1'
adapter:
  type: mock
`);

    const proc = Bun.spawnSync(
      ["bun", "run", "src/cli/index.ts", "validate-config", "--project", TEST_PROJECT_DIR],
      {
        cwd: "/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude",
        env: { ...process.env },
      }
    );

    const stdout = new TextDecoder().decode(proc.stdout);
    const stderr = new TextDecoder().decode(proc.stderr);
    const output = stdout + stderr;

    // Must exit zero
    expect(proc.exitCode).toBe(0);
    // Must not emit false remote overlay errors
    expect(output).not.toContain("✗ remote overlay");
  });

  it("validate-config with valid remote overlay config → exits zero and reports success", async () => {
    setupProject(`version: '1'
overlay_backends:
  coding-std:
    runtime: mcp
    command: [bun, run, server.ts]
    tool: overlay.invoke
remote_overlays:
  coding-std-pre:
    backend: coding-std
    hooks: [pre_task]
`);

    const proc = Bun.spawnSync(
      ["bun", "run", "src/cli/index.ts", "validate-config", "--project", TEST_PROJECT_DIR],
      {
        cwd: "/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude",
        env: { ...process.env },
      }
    );

    const stdout = new TextDecoder().decode(proc.stdout);
    const stderr = new TextDecoder().decode(proc.stderr);
    const output = stdout + stderr;

    expect(proc.exitCode).toBe(0);
    expect(output).toContain("remote overlay config");
    expect(output).toContain("✓");
  });
});

// ─── Governance config (RemoteOverlayConfig — live path) ─────────────────────
// governance.requirements_lock lives in the remote overlay config schema, not in
// ProjectConfig. The separate loadRemoteOverlayConfig() path handles it.

describe("governance config in RemoteOverlayConfig", () => {
  it("governance field (off) is accepted by parseRemoteOverlayConfig", () => {
    const result = parseRemoteOverlayConfig({ governance: { requirements_lock: "off" } });
    expect(result?.governance?.requirements_lock).toBe("off");
  });

  it("loadProjectConfig does not break when governance key absent from ai-sdd.yaml", () => {
    setupProject("version: '1'\n");
    const { loadProjectConfig } = require("../../src/cli/config-loader.ts");
    // Should not throw
    expect(() => loadProjectConfig(TEST_PROJECT_DIR)).not.toThrow();
  });
});
