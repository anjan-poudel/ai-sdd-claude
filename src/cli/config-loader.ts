/**
 * Project config loader — merges defaults with project ai-sdd.yaml.
 * Config merge order: CLI flags > project .ai-sdd/ai-sdd.yaml > framework config/defaults.yaml
 */

import yaml from "js-yaml";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { DEFAULT_CONFIG, mergeConfig } from "../config/defaults.ts";
import type { ProjectConfig } from "../types/index.ts";

const ProjectConfigSchema = z.object({
  version: z.string().optional(),
  workflow: z.string().optional(),
  adapter: z.object({
    type: z.enum(["claude_code", "openai", "roo_code", "mock"]).optional(),
    dispatch_mode: z.enum(["direct", "delegation"]).optional(),
  }).passthrough().optional(),
  engine: z.object({
    max_concurrent_tasks: z.number().int().positive().optional(),
    rate_limit_requests_per_minute: z.number().optional(),
    cost_budget_per_run_usd: z.number().optional(),
    cost_enforcement: z.enum(["warn", "pause", "stop"]).optional(),
    context_warning_threshold_pct: z.number().optional(),
    context_hil_threshold_pct: z.number().optional(),
  }).optional(),
  overlays: z.object({
    hil: z.object({
      enabled: z.boolean().optional(),
      queue_path: z.string().optional(),
      poll_interval_seconds: z.number().optional(),
      notify: z.object({
        on_created: z.array(z.string()).optional(),
        on_t2_gate: z.array(z.string()).optional(),
      }).optional(),
    }).optional(),
  }).optional(),
  security: z.object({
    secret_patterns: z.array(z.string()).optional(),
    injection_detection_level: z.enum(["pass", "warn", "quarantine"]).optional(),
  }).optional(),
  constitution: z.object({
    strict_parse: z.boolean().optional(),
  }).optional(),
  observability: z.object({
    log_level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).optional(),
  }).optional(),
}).passthrough();

export function loadProjectConfig(
  projectPath: string,
  overrides?: Partial<ProjectConfig>,
): ProjectConfig {
  const configPath = join(projectPath, ".ai-sdd", "ai-sdd.yaml");

  let projectConfig: Partial<ProjectConfig> = {};

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = yaml.load(raw) as unknown;
    const result = ProjectConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Config validation error in ${configPath}:\n${result.error.errors
          .map((e) => `  ${e.path.join(".")}: ${e.message}`)
          .join("\n")}`,
      );
    }

    // Version check
    if (result.data.version && result.data.version !== "1") {
      throw new Error(
        `schema version mismatch: expected '1', got '${result.data.version}'; run ai-sdd migrate`,
      );
    }

    projectConfig = result.data as Partial<ProjectConfig>;
  }

  let config = mergeConfig(DEFAULT_CONFIG, projectConfig);
  if (overrides) {
    config = mergeConfig(config, overrides);
  }
  return config;
}
