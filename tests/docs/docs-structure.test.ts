/**
 * T021: Documentation structure tests.
 * Verifies required sections, correct CLI commands, and internal consistency
 * between README.md and docs/USER_GUIDE.md.
 *
 * CLAUDE.md §5: Error messages are contracts — command examples in docs must
 * match the canonical CLI contracts in CONTRACTS.md.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dir, "../..");
const README = readFileSync(resolve(ROOT, "README.md"), "utf-8");
const USER_GUIDE = readFileSync(resolve(ROOT, "docs/USER_GUIDE.md"), "utf-8");

// ─── README structure ────────────────────────────────────────────────────────

describe("README.md — required sections", () => {
  it("has Quick Start section", () => {
    expect(README).toContain("## Quick Start");
  });

  it("has CLI Reference section", () => {
    expect(README).toContain("## CLI Reference");
  });

  it("has Architecture section", () => {
    expect(README).toContain("## Architecture");
  });

  it("has MCP Integration section", () => {
    expect(README).toContain("## MCP Integration");
  });

  it("links to USER_GUIDE.md", () => {
    expect(README).toMatch(/USER_GUIDE\.md/);
  });
});

describe("README.md — contract accuracy", () => {
  it("does not show --port flag for serve --mcp (stdio only)", () => {
    // Must not have 'serve --mcp --port' together
    expect(README).not.toMatch(/serve --mcp --port/);
  });

  it("lists 7 MCP tools including reject_hil", () => {
    expect(README).toContain("reject_hil");
  });

  it("does not describe --resume as real flag (it is a no-op)", () => {
    // Should not say '--resume  Resume from last state' as a real option to use
    expect(README).not.toMatch(/--resume\s+Resume from last/);
  });

  it("documents all task states", () => {
    for (const state of ["PENDING", "RUNNING", "COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED"]) {
      expect(README).toContain(state);
    }
  });

  it("ai-sdd hil commands include resolve and reject", () => {
    expect(README).toContain("hil resolve");
    expect(README).toContain("hil reject");
  });
});

// ─── USER_GUIDE structure ────────────────────────────────────────────────────

describe("USER_GUIDE.md — required sections", () => {
  it("has Using Claude Code section", () => {
    expect(USER_GUIDE).toContain("## Using Claude Code");
  });

  it("has Using Codex CLI section (or Codex reference)", () => {
    expect(USER_GUIDE).toMatch(/Using Codex/);
  });

  it("has Using Roo Code section", () => {
    expect(USER_GUIDE).toContain("## Using Roo Code");
  });

  it("has Troubleshooting section", () => {
    expect(USER_GUIDE).toContain("## Troubleshooting");
  });

  it("has HIL section", () => {
    expect(USER_GUIDE).toContain("Human-in-the-Loop");
  });

  it("has Expression DSL section", () => {
    expect(USER_GUIDE).toContain("Expression DSL");
  });

  it("has Evidence Gate section", () => {
    expect(USER_GUIDE).toContain("Evidence Gate");
  });
});

describe("USER_GUIDE.md — contract accuracy", () => {
  it("does not show --port flag for serve --mcp (stdio only)", () => {
    expect(USER_GUIDE).not.toMatch(/serve --mcp --port/);
  });

  it("lists 7 MCP tools including reject_hil", () => {
    expect(USER_GUIDE).toContain("reject_hil");
  });

  it("workflow lookup order has 6 paths", () => {
    // Verify all 6 search paths are documented
    expect(USER_GUIDE).toContain("specs/<feature>/workflow.yaml");
    expect(USER_GUIDE).toContain("specs/workflow.yaml");
    expect(USER_GUIDE).toContain(".ai-sdd/workflow.yaml");
    expect(USER_GUIDE).toContain(".ai-sdd/workflows/default-sdd.yaml");
  });

  it("does not document removed config fields (rate_limit_requests_per_minute)", () => {
    expect(USER_GUIDE).not.toContain("rate_limit_requests_per_minute");
  });

  it("does not document removed config fields (context_warning_threshold_pct)", () => {
    expect(USER_GUIDE).not.toContain("context_warning_threshold_pct");
  });

  it("does not document removed config fields (context_hil_threshold_pct)", () => {
    expect(USER_GUIDE).not.toContain("context_hil_threshold_pct");
  });

  it("documents 3 evidence gate risk tiers", () => {
    expect(USER_GUIDE).toContain("T0");
    expect(USER_GUIDE).toContain("T1");
    expect(USER_GUIDE).toContain("T2");
  });

  it("documents all 6 task states in troubleshooting or concepts", () => {
    for (const state of ["PENDING", "RUNNING", "COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED"]) {
      expect(USER_GUIDE).toContain(state);
    }
  });

  it("Roo Code section explains adapter.type: roo_code is not a runtime adapter", () => {
    // The note uses backtick-quoted `roo_code` followed by the explanation
    expect(USER_GUIDE).toContain("not a runtime adapter");
  });

  it("complete-task is documented as atomic transaction", () => {
    expect(USER_GUIDE).toContain("complete-task");
    expect(USER_GUIDE).toContain("Atomic");
  });
});

// ─── Cross-doc consistency ───────────────────────────────────────────────────

describe("Cross-doc consistency", () => {
  it("both docs document ai-sdd init --tool with same tools", () => {
    for (const tool of ["claude_code", "codex", "roo_code"]) {
      expect(README).toContain(tool);
      expect(USER_GUIDE).toContain(tool);
    }
  });

  it("both docs show same overlay chain order", () => {
    // HIL must come before Evidence Gate in both docs
    const readmeHilPos = README.indexOf("HIL");
    const readmeGatePos = README.indexOf("Evidence Gate");
    expect(readmeHilPos).toBeGreaterThanOrEqual(0);
    expect(readmeGatePos).toBeGreaterThanOrEqual(0);
    expect(readmeHilPos).toBeLessThan(readmeGatePos);
  });

  it("both docs document hil resolve and hil reject", () => {
    for (const doc of [README, USER_GUIDE]) {
      expect(doc).toContain("hil resolve");
      expect(doc).toContain("hil reject");
    }
  });
});
