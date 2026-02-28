/**
 * AgentRegistry — loads and resolves agent YAML files.
 * Supports extends-based inheritance with deep merge.
 */
import { z } from "zod";
import yaml from "js-yaml";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { AgentConfig } from "../types/index.ts";

// ─── Zod Schema ──────────────────────────────────────────────────────────────

const AgentLLMSchema = z.object({
  provider: z.string(),
  model: z.string(),
  hyperparameters: z.object({
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().positive().optional(),
    top_p: z.number().min(0).max(1).optional(),
  }).passthrough().optional(),
});

const AgentRoleSchema = z.object({
  description: z.string().min(1, "role.description is required"),
  expertise: z.array(z.string()).optional(),
  responsibilities: z.array(z.string()).optional(),
});

export const AgentConfigSchema = z.object({
  name: z.string().min(1, "name is required"),
  display_name: z.string().min(1, "display_name is required"),
  version: z.string(),
  extends: z.string().nullable().optional(),
  llm: AgentLLMSchema,
  role: AgentRoleSchema,
  commands: z.record(z.string(), z.string()).optional(),
});

// ─── Deep merge utility ───────────────────────────────────────────────────────

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base } as T;
  for (const [key, val] of Object.entries(override)) {
    const k = key as keyof T;
    if (
      val !== null &&
      val !== undefined &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof (base as Record<string, unknown>)[key] === "object" &&
      (base as Record<string, unknown>)[key] !== null
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        (base as Record<string, unknown>)[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else if (val !== undefined) {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

// ─── AgentRegistry ────────────────────────────────────────────────────────────

export class AgentRegistry {
  private agents = new Map<string, AgentConfig>();
  private rawConfigs = new Map<string, AgentConfig>();
  private defaultsDir: string;

  constructor(defaultsDir: string) {
    this.defaultsDir = defaultsDir;
  }

  /**
   * Load all default agents from the defaults directory.
   * Throws if any required file is missing or fails validation.
   */
  loadDefaults(): void {
    const requiredAgents = ["ba", "architect", "pe", "le", "dev", "reviewer"];
    for (const name of requiredAgents) {
      const filePath = join(this.defaultsDir, `${name}.yaml`);
      if (!existsSync(filePath)) {
        throw new Error(`Required default agent file missing: ${filePath}`);
      }
      this.loadFile(filePath);
    }
  }

  /**
   * Load a single agent YAML file into the registry.
   */
  loadFile(filePath: string): AgentConfig {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = yaml.load(raw) as unknown;
    const result = AgentConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Agent validation error in ${filePath}:\n${result.error.errors
          .map((e) => `  ${e.path.join(".")}: ${e.message}`)
          .join("\n")}`,
      );
    }
    this.rawConfigs.set(result.data.name, result.data);
    return result.data;
  }

  /**
   * Load from a project agents directory (.ai-sdd/agents/).
   * Project agents override defaults by the same name.
   */
  loadProjectAgents(projectAgentsDir: string): void {
    if (!existsSync(projectAgentsDir)) return;
    const { readdirSync } = require("fs");
    for (const file of readdirSync(projectAgentsDir) as string[]) {
      if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        this.loadFile(join(projectAgentsDir, file));
      }
    }
  }

  /**
   * Resolve an agent by name, applying extends inheritance.
   * Caches resolved agents.
   */
  resolve(name: string, useDefaults = false): AgentConfig {
    if (this.agents.has(name)) {
      return this.agents.get(name)!;
    }

    const raw = this.rawConfigs.get(name);
    if (!raw) {
      if (useDefaults) {
        throw new Error(`Agent '${name}' not found and use_defaults is true but no default available`);
      }
      throw new Error(`Agent '${name}' not found in registry`);
    }

    let resolved: AgentConfig;
    if (raw.extends) {
      const base = this.resolve(raw.extends, useDefaults);
      resolved = deepMerge(base as Record<string, unknown>, raw as unknown as Record<string, unknown>) as unknown as AgentConfig;
      // Always use the extending agent's name, not the base name
      resolved = { ...resolved, name: raw.name, display_name: raw.display_name };
    } else {
      resolved = { ...raw };
    }

    this.agents.set(name, resolved);
    return resolved;
  }

  /**
   * Get all agent names in the registry.
   */
  getAgentNames(): string[] {
    return Array.from(this.rawConfigs.keys());
  }

  /**
   * Check if an agent exists.
   */
  has(name: string): boolean {
    return this.rawConfigs.has(name);
  }
}

/**
 * Create and populate an AgentRegistry from the framework defaults dir
 * and optionally a project agents dir.
 */
export function createAgentRegistry(options: {
  defaultsDir: string;
  projectAgentsDir?: string;
}): AgentRegistry {
  const registry = new AgentRegistry(options.defaultsDir);
  registry.loadDefaults();
  if (options.projectAgentsDir) {
    registry.loadProjectAgents(options.projectAgentsDir);
  }
  return registry;
}
