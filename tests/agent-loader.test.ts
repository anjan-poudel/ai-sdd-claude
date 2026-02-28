/**
 * T001: Agent system tests
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { AgentRegistry, AgentConfigSchema } from "../src/core/agent-loader.ts";
import { resolve } from "path";

const DEFAULTS_DIR = resolve(import.meta.dir, "../data/agents/defaults");

describe("AgentRegistry: load defaults", () => {
  let registry: AgentRegistry;

  beforeAll(() => {
    registry = new AgentRegistry(DEFAULTS_DIR);
    registry.loadDefaults();
  });

  it("loads all 6 default agents", () => {
    const agents = registry.getAgentNames();
    expect(agents).toContain("ba");
    expect(agents).toContain("architect");
    expect(agents).toContain("pe");
    expect(agents).toContain("le");
    expect(agents).toContain("dev");
    expect(agents).toContain("reviewer");
    expect(agents.length).toBeGreaterThanOrEqual(6);
  });

  it("BA agent has correct model", () => {
    const ba = registry.resolve("ba");
    expect(ba.llm.model).toBe("claude-sonnet-4-6");
    expect(ba.llm.provider).toBe("anthropic");
  });

  it("architect uses opus model", () => {
    const arch = registry.resolve("architect");
    expect(arch.llm.model).toBe("claude-opus-4-6");
  });

  it("all agents have required role.description", () => {
    for (const name of ["ba", "architect", "pe", "le", "dev", "reviewer"]) {
      const agent = registry.resolve(name);
      expect(agent.role.description.length).toBeGreaterThan(0);
    }
  });

  it("has() returns correct boolean", () => {
    expect(registry.has("ba")).toBe(true);
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("resolve nonexistent agent throws", () => {
    expect(() => registry.resolve("nonexistent")).toThrow("not found");
  });
});

describe("AgentRegistry: extends inheritance", () => {
  it("custom agent inherits from base", () => {
    const registry = new AgentRegistry(DEFAULTS_DIR);
    registry.loadDefaults();

    // Manually inject a raw config that extends ba
    const { rawConfigs } = registry as unknown as { rawConfigs: Map<string, unknown> };
    rawConfigs.set("custom-ba", {
      name: "custom-ba",
      display_name: "Custom BA",
      version: "1",
      extends: "ba",
      llm: {
        provider: "anthropic",
        model: "claude-opus-4-6",  // override model
        hyperparameters: { temperature: 0.5 },
      },
      role: {
        description: "Custom BA with different model",
      },
    });

    const custom = registry.resolve("custom-ba");
    expect(custom.llm.model).toBe("claude-opus-4-6");
    expect(custom.name).toBe("custom-ba");
    // Inherits responsibilities from ba
    expect(custom.role.responsibilities).toBeDefined();
  });
});

describe("AgentConfigSchema: validation", () => {
  it("rejects missing role.description", () => {
    const result = AgentConfigSchema.safeParse({
      name: "test",
      display_name: "Test",
      version: "1",
      llm: { provider: "anthropic", model: "claude-sonnet-4-6" },
      role: {},  // missing description
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing llm.model", () => {
    const result = AgentConfigSchema.safeParse({
      name: "test",
      display_name: "Test",
      version: "1",
      llm: { provider: "anthropic" },  // missing model
      role: { description: "test" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid agent config", () => {
    const result = AgentConfigSchema.safeParse({
      name: "test",
      display_name: "Test Agent",
      version: "1",
      llm: { provider: "anthropic", model: "claude-sonnet-4-6" },
      role: { description: "A test agent" },
    });
    expect(result.success).toBe(true);
  });
});
