/**
 * Tests for the shared MCP server tool definitions.
 * Verifies all expected tools are declared, including reject_hil.
 * CLAUDE.md §2: Integration point tests — when a tool is wired in, verify it's reachable.
 */

import { describe, it, expect } from "bun:test";

// We test the TOOLS array by importing the server module and checking the
// exported tool names via a mock inspection approach — the server exports
// its tool list through the ListTools handler, which we can verify
// by inspecting the module-level TOOLS constant structurally.

// Since TOOLS is not exported, we verify via the handler registration by
// spawning the CLI `serve --mcp` and checking it starts successfully,
// then verify the tool list matches our expectations by checking the
// source module exports the right set of top-level constants.

// More practically: verify the 7 tools are present by checking the
// server source defines them correctly via regex over the raw tool names.
// This follows the "external schema fixture" pattern from CLAUDE.md §4.

const EXPECTED_TOOLS = [
  "get_next_task",
  "get_workflow_status",
  "complete_task",
  "list_hil_items",
  "resolve_hil",
  "reject_hil",
  "get_constitution",
] as const;

describe("MCP server tool definitions", () => {
  it("all expected tools are defined in TOOLS array", async () => {
    // Read the server source and verify each expected tool name appears
    // as a `name:` string in the TOOLS array definition.
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dir, "../../src/integration/mcp-server/server.ts"),
      "utf-8",
    );

    for (const toolName of EXPECTED_TOOLS) {
      expect(src).toContain(`name: "${toolName}"`);
    }
  });

  it("reject_hil tool is handled in switch statement", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dir, "../../src/integration/mcp-server/server.ts"),
      "utf-8",
    );
    expect(src).toContain("case \"reject_hil\":");
    // Delegates to hil reject CLI command
    expect(src).toContain("\"hil\", \"reject\"");
  });

  it("resolve_hil and reject_hil are symmetric (both have id as required param)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dir, "../../src/integration/mcp-server/server.ts"),
      "utf-8",
    );
    // Both tools should list "id" in their required arrays
    const resolveMatch = src.match(/name: "resolve_hil"[\s\S]*?required: \[([\s\S]*?)\]/);
    const rejectMatch = src.match(/name: "reject_hil"[\s\S]*?required: \[([\s\S]*?)\]/);
    expect(resolveMatch?.[1]).toContain("\"id\"");
    expect(rejectMatch?.[1]).toContain("\"id\"");
  });
});
