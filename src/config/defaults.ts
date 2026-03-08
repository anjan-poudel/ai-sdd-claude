/**
 * Default configuration object — mirrors data/config/defaults.yaml.
 * Config merge order: CLI flags > project ai-sdd.yaml > framework defaults
 */

import type { ProjectConfig } from "../types/index.ts";

export const DEFAULT_CONFIG: ProjectConfig = {
  version: "1",
  workflow: "default-sdd",
  adapter: {
    type: "mock",
    dispatch_mode: "direct",
  },
  engine: {
    max_concurrent_tasks: 3,
    cost_budget_per_run_usd: 10.00,
    cost_enforcement: "pause",
    max_context_tokens: 100000,
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
  standards: {
    strict: false,
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
  const resultRecord = result as unknown as Record<string, unknown>;
  const baseRecord = base as unknown as Record<string, unknown>;

  for (const [key, val] of Object.entries(override) as [keyof ProjectConfig, unknown][]) {
    if (
      val !== null &&
      val !== undefined &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof baseRecord[key as string] === "object" &&
      baseRecord[key as string] !== null
    ) {
      resultRecord[key as string] = mergeConfig(
        baseRecord[key as string] as ProjectConfig,
        val as Partial<ProjectConfig>,
      );
    } else if (val !== undefined) {
      resultRecord[key as string] = val;
    }
  }

  return result;
}
