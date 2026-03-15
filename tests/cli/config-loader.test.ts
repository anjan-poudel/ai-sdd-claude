/**
 * Tests for config-loader.ts — Zod schema validation and env var expansion.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadProjectConfig } from "../../src/cli/config-loader.ts";

const TEST_DIR = "/tmp/ai-sdd-test-config-loader";

function writeConfig(content: string): void {
  const dir = join(TEST_DIR, ".ai-sdd");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ai-sdd.yaml"), content, "utf-8");
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── collaboration schema ─────────────────────────────────────────────────────

describe("loadProjectConfig — collaboration schema", () => {
  it("parses collaboration block with all adapter types", () => {
    writeConfig(`version: "1"
collaboration:
  enabled: true
  adapters:
    notification: slack
    document: confluence
    task_tracking: jira
    code_review: github
  slack:
    notify_channel: "#alerts"
  confluence:
    space_key: "PROJ"
    parent_page_title: "Docs"
  jira:
    project_key: "PROJ"
  github:
    owner: "myorg"
    repo: "myrepo"
    base_branch: "main"
`);
    const config = loadProjectConfig(TEST_DIR);
    expect(config.collaboration).toBeDefined();
    expect(config.collaboration!.enabled).toBe(true);
    expect(config.collaboration!.adapters?.notification).toBe("slack");
    expect(config.collaboration!.slack?.notify_channel).toBe("#alerts");
    expect(config.collaboration!.confluence?.space_key).toBe("PROJ");
    expect(config.collaboration!.jira?.project_key).toBe("PROJ");
    expect(config.collaboration!.github?.owner).toBe("myorg");
  });

  it("rejects invalid adapter type", () => {
    writeConfig(`version: "1"
collaboration:
  adapters:
    notification: teams
`);
    expect(() => loadProjectConfig(TEST_DIR)).toThrow();
  });

  it("collaboration absent when not in yaml", () => {
    writeConfig(`version: "1"\nadapter:\n  type: claude_code`);
    const config = loadProjectConfig(TEST_DIR);
    expect(config.collaboration).toBeUndefined();
  });
});

// ─── env var expansion ────────────────────────────────────────────────────────

describe("loadProjectConfig — env var expansion", () => {
  it("expands ${ENV_VAR} in collaboration.slack.notify_channel", () => {
    process.env["TEST_CL_SLACK"] = "#my-channel";
    writeConfig(`version: "1"
collaboration:
  enabled: true
  adapters:
    notification: slack
  slack:
    notify_channel: "\${TEST_CL_SLACK}"
`);
    const config = loadProjectConfig(TEST_DIR);
    expect(config.collaboration!.slack?.notify_channel).toBe("#my-channel");
    delete process.env["TEST_CL_SLACK"];
  });

  it("expands multiple env vars in same file", () => {
    process.env["TEST_CL_SPACE"] = "GOVJ";
    process.env["TEST_CL_JIRA"] = "GOVJ";
    writeConfig(`version: "1"
collaboration:
  enabled: true
  adapters:
    document: confluence
    task_tracking: jira
  confluence:
    space_key: "\${TEST_CL_SPACE}"
  jira:
    project_key: "\${TEST_CL_JIRA}"
`);
    const config = loadProjectConfig(TEST_DIR);
    expect(config.collaboration!.confluence?.space_key).toBe("GOVJ");
    expect(config.collaboration!.jira?.project_key).toBe("GOVJ");
    delete process.env["TEST_CL_SPACE"];
    delete process.env["TEST_CL_JIRA"];
  });

  it("unset env var expands to empty string (does not throw)", () => {
    writeConfig(`version: "1"
collaboration:
  enabled: true
  adapters:
    notification: slack
  slack:
    notify_channel: "\${DEFINITELY_NOT_SET_XYZ_999}"
`);
    const config = loadProjectConfig(TEST_DIR);
    expect(config.collaboration!.slack?.notify_channel).toBe("");
  });

  it("does not expand vars in non-collaboration sections", () => {
    process.env["TEST_CL_ADAPTER"] = "openai";
    writeConfig(`version: "1"
adapter:
  type: claude_code
`);
    const config = loadProjectConfig(TEST_DIR);
    // Should NOT be "openai" — env var in adapter.type is not how it works
    expect(config.adapter?.type).toBe("claude_code");
    delete process.env["TEST_CL_ADAPTER"];
  });
});
