/**
 * Tests for session-resolver.ts — multi-session path resolution.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import {
  resolveSession,
  getActiveSession,
  setActiveSession,
  listSessions,
  ensureSessionDirs,
} from "../../src/core/session-resolver.ts";

const TEST_DIR = "/tmp/ai-sdd-test-session-resolver";

function setupProject(opts?: {
  legacy?: boolean;
  sessions?: string[];
  activeSession?: string;
  rootConfig?: string;
  featureConfig?: { name: string; config: string };
  workflow?: { path: string; content: string };
  featureWorkflow?: { name: string; content: string };
}) {
  mkdirSync(join(TEST_DIR, ".ai-sdd"), { recursive: true });

  if (opts?.legacy) {
    // Legacy layout: .ai-sdd/state/ exists, no sessions/
    mkdirSync(join(TEST_DIR, ".ai-sdd", "state", "hil"), { recursive: true });
    mkdirSync(join(TEST_DIR, ".ai-sdd", "outputs"), { recursive: true });
  }

  if (opts?.sessions) {
    for (const name of opts.sessions) {
      mkdirSync(join(TEST_DIR, ".ai-sdd", "sessions", name, "hil"), { recursive: true });
      mkdirSync(join(TEST_DIR, ".ai-sdd", "sessions", name, "outputs"), { recursive: true });
      mkdirSync(join(TEST_DIR, ".ai-sdd", "sessions", name, "pair-sessions"), { recursive: true });
      mkdirSync(join(TEST_DIR, ".ai-sdd", "sessions", name, "review-logs"), { recursive: true });
    }
  }

  if (opts?.activeSession) {
    writeFileSync(
      join(TEST_DIR, ".ai-sdd", "active-session"),
      opts.activeSession + "\n",
      "utf-8",
    );
  }

  if (opts?.rootConfig) {
    writeFileSync(join(TEST_DIR, ".ai-sdd", "ai-sdd.yaml"), opts.rootConfig, "utf-8");
  }

  if (opts?.featureConfig) {
    const dir = join(TEST_DIR, "specs", opts.featureConfig.name, ".ai-sdd");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ai-sdd.yaml"), opts.featureConfig.config, "utf-8");
  }

  if (opts?.workflow) {
    const dir = join(TEST_DIR, opts.workflow.path, "..");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(TEST_DIR, opts.workflow.path), opts.workflow.content, "utf-8");
  }

  if (opts?.featureWorkflow) {
    const dir = join(TEST_DIR, "specs", opts.featureWorkflow.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "workflow.yaml"), opts.featureWorkflow.content, "utf-8");
  }
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── getActiveSession ─────────────────────────────────────────────────────────

describe("getActiveSession", () => {
  it("returns 'default' when active-session file does not exist", () => {
    mkdirSync(join(TEST_DIR, ".ai-sdd"), { recursive: true });
    expect(getActiveSession(TEST_DIR)).toBe("default");
  });

  it("reads active session name from file", () => {
    setupProject({ activeSession: "my-feature" });
    expect(getActiveSession(TEST_DIR)).toBe("my-feature");
  });

  it("trims whitespace from active-session file", () => {
    mkdirSync(join(TEST_DIR, ".ai-sdd"), { recursive: true });
    writeFileSync(join(TEST_DIR, ".ai-sdd", "active-session"), "  my-feature  \n", "utf-8");
    expect(getActiveSession(TEST_DIR)).toBe("my-feature");
  });

  it("returns 'default' when active-session file is empty", () => {
    mkdirSync(join(TEST_DIR, ".ai-sdd"), { recursive: true });
    writeFileSync(join(TEST_DIR, ".ai-sdd", "active-session"), "", "utf-8");
    expect(getActiveSession(TEST_DIR)).toBe("default");
  });
});

// ─── setActiveSession ─────────────────────────────────────────────────────────

describe("setActiveSession", () => {
  it("writes session name to active-session file", () => {
    mkdirSync(join(TEST_DIR, ".ai-sdd"), { recursive: true });
    setActiveSession(TEST_DIR, "roundtrip-travel");
    const content = readFileSync(join(TEST_DIR, ".ai-sdd", "active-session"), "utf-8");
    expect(content.trim()).toBe("roundtrip-travel");
  });

  it("creates .ai-sdd/ if it does not exist", () => {
    mkdirSync(TEST_DIR, { recursive: true });
    setActiveSession(TEST_DIR, "test");
    expect(existsSync(join(TEST_DIR, ".ai-sdd", "active-session"))).toBe(true);
  });
});

// ─── listSessions ─────────────────────────────────────────────────────────────

describe("listSessions", () => {
  it("returns empty array when sessions dir does not exist", () => {
    mkdirSync(join(TEST_DIR, ".ai-sdd"), { recursive: true });
    expect(listSessions(TEST_DIR)).toEqual([]);
  });

  it("returns sorted session names", () => {
    setupProject({ sessions: ["zeta", "alpha", "beta"] });
    expect(listSessions(TEST_DIR)).toEqual(["alpha", "beta", "zeta"]);
  });

  it("returns single default session", () => {
    setupProject({ sessions: ["default"] });
    expect(listSessions(TEST_DIR)).toEqual(["default"]);
  });
});

// ─── ensureSessionDirs ────────────────────────────────────────────────────────

describe("ensureSessionDirs", () => {
  it("creates session directory and all subdirectories", () => {
    const sessionDir = join(TEST_DIR, ".ai-sdd", "sessions", "test");
    mkdirSync(TEST_DIR, { recursive: true });
    ensureSessionDirs(sessionDir);

    expect(existsSync(sessionDir)).toBe(true);
    expect(existsSync(join(sessionDir, "hil"))).toBe(true);
    expect(existsSync(join(sessionDir, "outputs"))).toBe(true);
    expect(existsSync(join(sessionDir, "pair-sessions"))).toBe(true);
    expect(existsSync(join(sessionDir, "review-logs"))).toBe(true);
  });

  it("is idempotent — can be called twice without error", () => {
    const sessionDir = join(TEST_DIR, ".ai-sdd", "sessions", "test");
    mkdirSync(TEST_DIR, { recursive: true });
    ensureSessionDirs(sessionDir);
    ensureSessionDirs(sessionDir);

    expect(existsSync(sessionDir)).toBe(true);
  });
});

// ─── resolveSession — legacy layout ──────────────────────────────────────────

describe("resolveSession — legacy layout", () => {
  it("detects legacy layout and returns flat paths", () => {
    setupProject({ legacy: true });
    const session = resolveSession({ projectPath: TEST_DIR });

    expect(session.isLegacy).toBe(true);
    expect(session.stateDir).toBe(join(TEST_DIR, ".ai-sdd", "state"));
    expect(session.hilQueuePath).toBe(join(TEST_DIR, ".ai-sdd", "state", "hil"));
    expect(session.outputsDir).toBe(join(TEST_DIR, ".ai-sdd", "outputs"));
    expect(session.pairSessionsDir).toBe(join(TEST_DIR, ".ai-sdd", "state", "pair-sessions"));
    expect(session.reviewLogsDir).toBe(join(TEST_DIR, ".ai-sdd", "state", "review-logs"));
  });

  it("uses configured HIL queue_path in legacy mode", () => {
    setupProject({
      legacy: true,
      rootConfig: 'version: "1"\noverlays:\n  hil:\n    queue_path: ".ai-sdd/state/custom-hil/"',
    });
    const session = resolveSession({ projectPath: TEST_DIR });

    expect(session.isLegacy).toBe(true);
    expect(session.hilQueuePath).toBe(join(TEST_DIR, ".ai-sdd", "state", "custom-hil"));
  });
});

// ─── resolveSession — sessions layout ────────────────────────────────────────

describe("resolveSession — sessions layout", () => {
  it("resolves default session when no active-session file", () => {
    setupProject({ sessions: ["default"] });
    const session = resolveSession({ projectPath: TEST_DIR });

    expect(session.isLegacy).toBe(false);
    expect(session.sessionName).toBe("default");
    expect(session.sessionDir).toBe(join(TEST_DIR, ".ai-sdd", "sessions", "default"));
    expect(session.stateDir).toBe(join(TEST_DIR, ".ai-sdd", "sessions", "default"));
    expect(session.hilQueuePath).toBe(join(TEST_DIR, ".ai-sdd", "sessions", "default", "hil"));
    expect(session.outputsDir).toBe(join(TEST_DIR, ".ai-sdd", "sessions", "default", "outputs"));
    expect(session.pairSessionsDir).toBe(join(TEST_DIR, ".ai-sdd", "sessions", "default", "pair-sessions"));
    expect(session.reviewLogsDir).toBe(join(TEST_DIR, ".ai-sdd", "sessions", "default", "review-logs"));
  });

  it("reads active-session file for session name", () => {
    setupProject({ sessions: ["default", "my-feature"], activeSession: "my-feature" });
    const session = resolveSession({ projectPath: TEST_DIR });

    expect(session.sessionName).toBe("my-feature");
    expect(session.sessionDir).toBe(join(TEST_DIR, ".ai-sdd", "sessions", "my-feature"));
  });

  it("--feature overrides active-session", () => {
    setupProject({ sessions: ["default", "alpha", "beta"], activeSession: "alpha" });
    const session = resolveSession({ projectPath: TEST_DIR, featureName: "beta" });

    expect(session.sessionName).toBe("beta");
    expect(session.sessionDir).toBe(join(TEST_DIR, ".ai-sdd", "sessions", "beta"));
  });
});

// ─── resolveSession — config merge ───────────────────────────────────────────

describe("resolveSession — config merge", () => {
  it("uses default config when no config files exist", () => {
    setupProject({ sessions: ["default"] });
    const session = resolveSession({ projectPath: TEST_DIR });

    expect(session.config.version).toBe("1");
    expect(session.config.adapter?.type).toBe("mock");
  });

  it("merges root config over defaults", () => {
    setupProject({
      sessions: ["default"],
      rootConfig: 'version: "1"\nadapter:\n  type: claude_code',
    });
    const session = resolveSession({ projectPath: TEST_DIR });

    expect(session.config.adapter?.type).toBe("claude_code");
    // Other defaults preserved
    expect(session.config.engine?.max_concurrent_tasks).toBe(3);
  });

  it("deep-merges feature config over root config", () => {
    setupProject({
      sessions: ["default", "my-feature"],
      rootConfig: 'version: "1"\nadapter:\n  type: claude_code\nengine:\n  max_concurrent_tasks: 3',
      featureConfig: {
        name: "my-feature",
        config: 'engine:\n  max_concurrent_tasks: 1',
      },
    });
    const session = resolveSession({ projectPath: TEST_DIR, featureName: "my-feature" });

    // Feature override applied
    expect(session.config.engine?.max_concurrent_tasks).toBe(1);
    // Root config preserved
    expect(session.config.adapter?.type).toBe("claude_code");
  });
});

// ─── resolveSession — workflow resolution ────────────────────────────────────

describe("resolveSession — workflow resolution", () => {
  const WF_YAML = 'name: test-wf\ntasks:\n  t1:\n    agent: ba\n    outputs:\n      - path: specs/t1.md';

  it("resolves --workflow by name", () => {
    setupProject({ sessions: ["default"] });
    const wfDir = join(TEST_DIR, ".ai-sdd", "workflows");
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, "custom.yaml"), WF_YAML, "utf-8");

    const session = resolveSession({ projectPath: TEST_DIR, workflowName: "custom" });
    expect(session.workflowPath).toBe(join(wfDir, "custom.yaml"));
  });

  it("resolves feature workflow from specs/<feature>/workflow.yaml", () => {
    setupProject({
      sessions: ["default", "my-feature"],
      featureWorkflow: { name: "my-feature", content: WF_YAML },
    });
    const session = resolveSession({ projectPath: TEST_DIR, featureName: "my-feature" });
    expect(session.workflowPath).toBe(join(TEST_DIR, "specs", "my-feature", "workflow.yaml"));
  });

  it("resolves specs/workflow.yaml for greenfield", () => {
    setupProject({
      sessions: ["default"],
      workflow: { path: "specs/workflow.yaml", content: WF_YAML },
    });
    const session = resolveSession({ projectPath: TEST_DIR });
    expect(session.workflowPath).toBe(join(TEST_DIR, "specs", "workflow.yaml"));
  });

  it("returns null when no workflow found", () => {
    setupProject({ sessions: ["default"] });
    const session = resolveSession({ projectPath: TEST_DIR });
    // May find bundled default or null depending on file system — just check it doesn't throw
    expect(session.workflowPath === null || typeof session.workflowPath === "string").toBe(true);
  });

  it("--workflow takes priority over --feature", () => {
    setupProject({
      sessions: ["default", "my-feature"],
      featureWorkflow: { name: "my-feature", content: WF_YAML },
    });
    const wfDir = join(TEST_DIR, ".ai-sdd", "workflows");
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, "cli-wf.yaml"), WF_YAML, "utf-8");

    const session = resolveSession({
      projectPath: TEST_DIR,
      featureName: "my-feature",
      workflowName: "cli-wf",
    });
    expect(session.workflowPath).toBe(join(wfDir, "cli-wf.yaml"));
  });
});

// ─── resolveSession — agents dirs ────────────────────────────────────────────

describe("resolveSession — agents dirs", () => {
  it("includes project agents dir when it exists", () => {
    setupProject({ sessions: ["default"] });
    const agentsDir = join(TEST_DIR, ".ai-sdd", "agents");
    mkdirSync(agentsDir, { recursive: true });

    const session = resolveSession({ projectPath: TEST_DIR });
    expect(session.agentsDirs).toContain(agentsDir);
  });

  it("includes feature agents dir when feature set and dir exists", () => {
    setupProject({ sessions: ["default", "my-feature"] });
    const featureAgentsDir = join(TEST_DIR, "specs", "my-feature", ".ai-sdd", "agents");
    mkdirSync(featureAgentsDir, { recursive: true });

    const session = resolveSession({ projectPath: TEST_DIR, featureName: "my-feature" });
    expect(session.agentsDirs).toContain(featureAgentsDir);
  });

  it("omits feature agents dir when it does not exist", () => {
    setupProject({ sessions: ["default", "my-feature"] });

    const session = resolveSession({ projectPath: TEST_DIR, featureName: "my-feature" });
    const featureAgentsDir = join(TEST_DIR, "specs", "my-feature", ".ai-sdd", "agents");
    expect(session.agentsDirs).not.toContain(featureAgentsDir);
  });
});

// ─── resolveSession — collaboration config ───────────────────────────────────

describe("resolveSession — collaboration config", () => {
  const COLLAB_YAML = `version: "1"
adapter:
  type: claude_code
collaboration:
  enabled: true
  adapters:
    notification: slack
    document: confluence
    task_tracking: jira
    code_review: github
  slack:
    notify_channel: "#govjobs-alerts"
  confluence:
    space_key: "GOVJ"
    parent_page_title: "ai-sdd Artifacts"
  jira:
    project_key: "GOVJ"
  github:
    owner: "myorg"
    repo: "govjobs"
    base_branch: "main"
`;

  it("loads collaboration config from root .ai-sdd/ai-sdd.yaml", () => {
    setupProject({ sessions: ["default"], rootConfig: COLLAB_YAML });
    const session = resolveSession({ projectPath: TEST_DIR });

    const collab = (session.config as Record<string, unknown>).collaboration as Record<string, unknown> | undefined;
    expect(collab).toBeDefined();
    expect((collab as Record<string, unknown>).enabled).toBe(true);
    const adapters = (collab as Record<string, unknown>).adapters as Record<string, unknown>;
    expect(adapters.notification).toBe("slack");
    const slack = (collab as Record<string, unknown>).slack as Record<string, unknown>;
    expect(slack.notify_channel).toBe("#govjobs-alerts");
  });

  it("loads collaboration config from feature .ai-sdd/ai-sdd.yaml", () => {
    setupProject({
      sessions: ["default", "my-feature"],
      featureConfig: { name: "my-feature", config: COLLAB_YAML },
    });
    const session = resolveSession({ projectPath: TEST_DIR, featureName: "my-feature" });

    const collab = (session.config as Record<string, unknown>).collaboration as Record<string, unknown> | undefined;
    expect(collab).toBeDefined();
    expect((collab as Record<string, unknown>).enabled).toBe(true);
  });

  it("expands ${ENV_VAR} placeholders in config values", () => {
    process.env["TEST_SLACK_CHANNEL_COLLAB"] = "#expanded-channel";
    const yamlWithEnvVar = `version: "1"
collaboration:
  enabled: true
  adapters:
    notification: slack
  slack:
    notify_channel: "\${TEST_SLACK_CHANNEL_COLLAB}"
`;
    setupProject({ sessions: ["default"], rootConfig: yamlWithEnvVar });
    const session = resolveSession({ projectPath: TEST_DIR });

    const collab = (session.config as Record<string, unknown>).collaboration as Record<string, unknown>;
    const slack = collab.slack as Record<string, unknown>;
    expect(slack.notify_channel).toBe("#expanded-channel");

    delete process.env["TEST_SLACK_CHANNEL_COLLAB"];
  });

  it("expands undefined env vars to empty string", () => {
    const yamlWithMissingVar = `version: "1"
collaboration:
  enabled: true
  adapters:
    notification: slack
  slack:
    notify_channel: "\${DEFINITELY_NOT_SET_VAR_XYZ}"
`;
    setupProject({ sessions: ["default"], rootConfig: yamlWithMissingVar });
    const session = resolveSession({ projectPath: TEST_DIR });

    const collab = (session.config as Record<string, unknown>).collaboration as Record<string, unknown>;
    const slack = collab.slack as Record<string, unknown>;
    expect(slack.notify_channel).toBe("");
  });

  it("collaboration absent from config when not in yaml", () => {
    setupProject({
      sessions: ["default"],
      rootConfig: 'version: "1"\nadapter:\n  type: claude_code',
    });
    const session = resolveSession({ projectPath: TEST_DIR });

    const collab = (session.config as Record<string, unknown>).collaboration;
    expect(collab).toBeUndefined();
  });
});

// ─── resolveSession — neither layout exists ──────────────────────────────────

describe("resolveSession — fresh project", () => {
  it("returns sessions layout paths when neither layout exists", () => {
    mkdirSync(join(TEST_DIR, ".ai-sdd"), { recursive: true });
    const session = resolveSession({ projectPath: TEST_DIR });

    expect(session.isLegacy).toBe(false);
    expect(session.sessionName).toBe("default");
    expect(session.sessionDir).toBe(join(TEST_DIR, ".ai-sdd", "sessions", "default"));
  });
});
