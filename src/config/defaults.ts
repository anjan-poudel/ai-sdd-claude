/**
 * Default configuration object — mirrors data/config/defaults.yaml.
 * Config merge order: CLI flags > project ai-sdd.yaml > framework defaults
 */

import type { ProjectConfig } from "../types/index.ts";

export const DEFAULT_CONFIG: Required<ProjectConfig> = {
  version: "1",
  workflow: "default-sdd",
  adapter: {
    type: "mock",
    dispatch_mode: "direct",
  },
  engine: {
    max_concurrent_tasks: 3,
    rate_limit_requests_per_minute: 20,
    cost_budget_per_run_usd: 10.00,
    cost_enforcement: "pause",
    context_warning_threshold_pct: 80,
    context_hil_threshold_pct: 95,
  },
  overlays: {
    hil: {
      enabled: true,
      queue_path: ".ai-sdd/state/hil/",
      poll_interval_seconds: 5,
      notify: {
        on_created: [],
        on_t2_gate: [],
      },
    },
  },
  security: {
    secret_patterns: [],
    injection_detection_level: "warn",
  },
  constitution: {
    strict_parse: true,
  },
  observability: {
    log_level: "INFO",
  },
};

/**
 * Deep merge two config objects (project over defaults).
 */
export function mergeConfig(
  base: ProjectConfig,
  override: Partial<ProjectConfig>,
): ProjectConfig {
  const result: ProjectConfig = { ...base };

  for (const [key, val] of Object.entries(override) as [keyof ProjectConfig, unknown][]) {
    if (
      val !== null &&
      val !== undefined &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof base[key] === "object" &&
      base[key] !== null
    ) {
      (result as Record<string, unknown>)[key] = mergeConfig(
        base[key] as ProjectConfig,
        val as Partial<ProjectConfig>,
      );
    } else if (val !== undefined) {
      (result as Record<string, unknown>)[key] = val;
    }
  }

  return result;
}
