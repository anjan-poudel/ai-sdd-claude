/**
 * Session resolver — centralizes all path resolution for multi-session support.
 *
 * Layout (sessions mode):
 *   .ai-sdd/sessions/<name>/workflow-state.json
 *   .ai-sdd/sessions/<name>/hil/
 *   .ai-sdd/sessions/<name>/outputs/
 *   .ai-sdd/sessions/<name>/pair-sessions/
 *   .ai-sdd/sessions/<name>/review-logs/
 *
 * Legacy layout (flat):
 *   .ai-sdd/state/workflow-state.json
 *   .ai-sdd/state/hil/
 *   .ai-sdd/outputs/
 *   .ai-sdd/state/pair-sessions/
 *   .ai-sdd/state/review-logs/
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, resolve } from "path";
import yaml from "js-yaml";
import { DEFAULT_CONFIG, mergeConfig } from "../config/defaults.ts";
import type { ProjectConfig } from "../types/index.ts";

export interface SessionContext {
  /** Session name: "default" for greenfield, or the feature name */
  sessionName: string;
  /** Absolute path to the session directory (.ai-sdd/sessions/<name>/) */
  sessionDir: string;
  /** Absolute path to the state directory (where workflow-state.json lives) */
  stateDir: string;
  /** Absolute path to the HIL queue directory */
  hilQueuePath: string;
  /** Absolute path to the outputs directory */
  outputsDir: string;
  /** Absolute path to the pair sessions directory */
  pairSessionsDir: string;
  /** Absolute path to the review logs directory */
  reviewLogsDir: string;
  /** Merged config: defaults → root config → feature config */
  config: ProjectConfig;
  /** Resolved workflow file path (first-found-wins), or null */
  workflowPath: string | null;
  /** Agent directories to load, in order (framework defaults, project, feature override) */
  agentsDirs: string[];
  /** True if old flat .ai-sdd/state/ layout detected (no sessions/ dir) */
  isLegacy: boolean;
}

export interface ResolveSessionOpts {
  projectPath: string;
  featureName?: string | undefined;
  workflowName?: string | undefined;
}

const ACTIVE_SESSION_FILE = "active-session";
const SESSIONS_DIR = "sessions";
const DEFAULT_SESSION = "default";

/** Session subdirectories to create */
const SESSION_SUBDIRS = ["hil", "outputs", "pair-sessions", "review-logs"] as const;

/**
 * Read the active session name from .ai-sdd/active-session.
 * Returns "default" if the file doesn't exist or is empty.
 */
export function getActiveSession(projectPath: string): string {
  const filePath = join(projectPath, ".ai-sdd", ACTIVE_SESSION_FILE);
  if (!existsSync(filePath)) return DEFAULT_SESSION;
  const content = readFileSync(filePath, "utf-8").trim();
  return content || DEFAULT_SESSION;
}

/**
 * Write the active session name to .ai-sdd/active-session.
 */
export function setActiveSession(projectPath: string, name: string): void {
  const aiSddDir = join(projectPath, ".ai-sdd");
  if (!existsSync(aiSddDir)) {
    mkdirSync(aiSddDir, { recursive: true });
  }
  writeFileSync(join(aiSddDir, ACTIVE_SESSION_FILE), name + "\n", "utf-8");
}

/**
 * List all session names from .ai-sdd/sessions/.
 * Returns sorted array. Returns empty array if sessions dir doesn't exist.
 */
export function listSessions(projectPath: string): string[] {
  const sessionsDir = join(projectPath, ".ai-sdd", SESSIONS_DIR);
  if (!existsSync(sessionsDir)) return [];

  return readdirSync(sessionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * Ensure all session subdirectories exist.
 */
export function ensureSessionDirs(sessionDir: string): void {
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  for (const sub of SESSION_SUBDIRS) {
    const dir = join(sessionDir, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Detect whether the project uses the legacy flat layout.
 * Legacy = .ai-sdd/state/ exists AND .ai-sdd/sessions/ does NOT exist.
 */
function isLegacyLayout(projectPath: string): boolean {
  const sessionsDir = join(projectPath, ".ai-sdd", SESSIONS_DIR);
  const oldStateDir = join(projectPath, ".ai-sdd", "state");
  return !existsSync(sessionsDir) && existsSync(oldStateDir);
}

/**
 * Load and merge config: defaults → root .ai-sdd/ai-sdd.yaml → feature specs/<name>/.ai-sdd/ai-sdd.yaml
 */
/**
 * Expand ${ENV_VAR} placeholders in a YAML string using process.env.
 * Unset variables are left as empty string "".
 */
function expandEnvVars(raw: string): string {
  return raw.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? "");
}

function loadMergedConfig(projectPath: string, featureName?: string): ProjectConfig {
  let config = { ...DEFAULT_CONFIG };

  // Root config
  const rootConfigPath = join(projectPath, ".ai-sdd", "ai-sdd.yaml");
  if (existsSync(rootConfigPath)) {
    const raw = expandEnvVars(readFileSync(rootConfigPath, "utf-8"));
    const parsed = yaml.load(raw) as Partial<ProjectConfig> | null;
    if (parsed && typeof parsed === "object") {
      config = mergeConfig(config, parsed);
    }
  }

  // Feature config override (deep-merged on top)
  if (featureName) {
    const featureConfigPath = join(projectPath, "specs", featureName, ".ai-sdd", "ai-sdd.yaml");
    if (existsSync(featureConfigPath)) {
      const raw = expandEnvVars(readFileSync(featureConfigPath, "utf-8"));
      const parsed = yaml.load(raw) as Partial<ProjectConfig> | null;
      if (parsed && typeof parsed === "object") {
        config = mergeConfig(config, parsed);
      }
    }
  }

  return config;
}

/**
 * Resolve a workflow file path using the standard search order (first match wins):
 *   0. --workflow <name>                       (CLI flag, highest priority)
 *   1. specs/<feature>/workflow.yaml            (--feature flag)
 *   2. specs/workflow.yaml                      (greenfield)
 *   3. .ai-sdd/workflow.yaml                    (backward compat)
 *   4. .ai-sdd/workflows/<config.workflow>.yaml (config.workflow name)
 *   5. .ai-sdd/workflows/default-sdd.yaml       (init-copied)
 *   6. bundled framework default
 */
function resolveWorkflowPath(
  projectPath: string,
  featureName?: string,
  workflowName?: string,
  configWorkflowName?: string,
): string | null {
  const candidates: string[] = [];

  if (workflowName) {
    candidates.push(resolve(projectPath, ".ai-sdd", "workflows", `${workflowName}.yaml`));
  }
  if (featureName) {
    candidates.push(resolve(projectPath, "specs", featureName, "workflow.yaml"));
  }
  candidates.push(resolve(projectPath, "specs", "workflow.yaml"));
  candidates.push(resolve(projectPath, ".ai-sdd", "workflow.yaml"));
  if (configWorkflowName) {
    candidates.push(resolve(projectPath, ".ai-sdd", "workflows", `${configWorkflowName}.yaml`));
  }
  candidates.push(resolve(projectPath, ".ai-sdd", "workflows", "default-sdd.yaml"));

  // Bundled framework default
  try {
    const bundled = resolve(
      new URL("../../data/workflows/default-sdd.yaml", import.meta.url).pathname,
    );
    candidates.push(bundled);
  } catch {
    // import.meta.url resolution can fail in tests
  }

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }

  return null;
}

/**
 * Build the ordered list of agent directories to load.
 */
function resolveAgentsDirs(projectPath: string, featureName?: string): string[] {
  const dirs: string[] = [];

  // Framework defaults
  try {
    const frameworkDir = resolve(
      new URL("../../data/agents/defaults", import.meta.url).pathname,
    );
    if (existsSync(frameworkDir)) dirs.push(frameworkDir);
  } catch {
    // import.meta.url resolution can fail in tests
  }

  // Project agents
  const projectAgentsDir = resolve(projectPath, ".ai-sdd", "agents");
  if (existsSync(projectAgentsDir)) dirs.push(projectAgentsDir);

  // Feature-specific agent overrides
  if (featureName) {
    const featureAgentsDir = resolve(projectPath, "specs", featureName, ".ai-sdd", "agents");
    if (existsSync(featureAgentsDir)) dirs.push(featureAgentsDir);
  }

  return dirs;
}

/**
 * Resolve all session paths and configuration for a given project and optional feature.
 *
 * Legacy detection: If .ai-sdd/sessions/ doesn't exist but .ai-sdd/state/ does,
 * returns paths matching the old flat layout and sets isLegacy=true.
 */
export function resolveSession(opts: ResolveSessionOpts): SessionContext {
  const { projectPath, featureName, workflowName } = opts;

  // Determine session name
  const sessionName = featureName ?? getActiveSession(projectPath);

  // Load config (supports feature overrides)
  const config = loadMergedConfig(projectPath, featureName);

  // Resolve workflow
  const workflowPath = resolveWorkflowPath(
    projectPath,
    featureName,
    workflowName,
    config.workflow,
  );

  // Resolve agents
  const agentsDirs = resolveAgentsDirs(projectPath, featureName);

  // Legacy detection
  if (isLegacyLayout(projectPath)) {
    const stateDir = resolve(projectPath, ".ai-sdd", "state");
    return {
      sessionName,
      sessionDir: stateDir,
      stateDir,
      hilQueuePath: resolve(
        projectPath,
        config.overlays?.hil?.queue_path ?? ".ai-sdd/state/hil/",
      ),
      outputsDir: resolve(projectPath, ".ai-sdd", "outputs"),
      pairSessionsDir: resolve(projectPath, ".ai-sdd", "state", "pair-sessions"),
      reviewLogsDir: resolve(projectPath, ".ai-sdd", "state", "review-logs"),
      config,
      workflowPath,
      agentsDirs,
      isLegacy: true,
    };
  }

  // Sessions layout
  const sessionDir = resolve(projectPath, ".ai-sdd", SESSIONS_DIR, sessionName);

  return {
    sessionName,
    sessionDir,
    stateDir: sessionDir,
    hilQueuePath: join(sessionDir, "hil"),
    outputsDir: join(sessionDir, "outputs"),
    pairSessionsDir: join(sessionDir, "pair-sessions"),
    reviewLogsDir: join(sessionDir, "review-logs"),
    config,
    workflowPath,
    agentsDirs,
    isLegacy: false,
  };
}
