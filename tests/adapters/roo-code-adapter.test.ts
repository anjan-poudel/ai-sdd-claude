/**
 * Roo Code adapter integration tests.
 *
 * roo_code is NOT a runtime adapter — it integrates with ai-sdd via the MCP server.
 * The factory must throw an actionable error that tells the user exactly what to do.
 */

import { describe, it, expect } from "bun:test";
import { createAdapter } from "../../src/adapters/factory.ts";

describe("roo_code adapter factory", () => {
  it("throws when type=roo_code", () => {
    expect(() => createAdapter({ type: "roo_code" })).toThrow();
  });

  it("error message explains roo_code is not a runtime adapter", () => {
    let msg = "";
    try {
      createAdapter({ type: "roo_code" });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("roo_code is not a runtime adapter");
  });

  it("error message references MCP server integration", () => {
    let msg = "";
    try {
      createAdapter({ type: "roo_code" });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg.toLowerCase()).toContain("mcp");
  });

  it("error message includes 'ai-sdd serve --mcp' command", () => {
    let msg = "";
    try {
      createAdapter({ type: "roo_code" });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("ai-sdd serve --mcp");
  });

  it("error message includes alternative adapter guidance (claude_code, openai, or mock)", () => {
    let msg = "";
    try {
      createAdapter({ type: "roo_code" });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("claude_code");
    expect(msg).toContain("openai");
    expect(msg).toContain("mock");
  });

  it("error message references ai-sdd.yaml config file", () => {
    let msg = "";
    try {
      createAdapter({ type: "roo_code" });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("ai-sdd.yaml");
  });

  it("factory never returns an object for type=roo_code", () => {
    let returned: unknown = "sentinel";
    try {
      returned = createAdapter({ type: "roo_code" });
    } catch {
      // expected
    }
    // If no throw occurred, returned would be overwritten — it must remain "sentinel"
    expect(returned).toBe("sentinel");
  });
});
