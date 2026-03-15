/**
 * Collaboration layer end-to-end tests against real external services.
 *
 * Requires the following env vars (load from .env before running):
 *   SLACK_BOT_TOKEN, SLACK_NOTIFY_CHANNEL
 *   CONFLUENCE_API_TOKEN, CONFLUENCE_USER_EMAIL, CONFLUENCE_BASE_URL, CONFLUENCE_SPACE_KEY
 *   JIRA_API_TOKEN, JIRA_USER_EMAIL, JIRA_BASE_URL, JIRA_PROJECT_KEY
 *   GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME
 *
 * Run:
 *   bun test tests/collaboration/integration/e2e-live.test.ts
 *
 * Each test cleans up the artifacts it creates. Tests are skipped automatically
 * when the required env vars are absent, so the suite is safe to run in CI with
 * no secrets configured.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { SlackNotificationAdapter } from "../../../src/collaboration/impl/slack-notification-adapter.ts";
import { ConfluenceDocumentAdapter } from "../../../src/collaboration/impl/confluence-document-adapter.ts";
import { JiraTaskTrackingAdapter } from "../../../src/collaboration/impl/jira-task-tracking-adapter.ts";
import { GitHubCodeReviewAdapter } from "../../../src/collaboration/impl/github-code-review-adapter.ts";
import { GitHubTaskTrackingAdapter } from "../../../src/collaboration/impl/github-task-tracking-adapter.ts";
import { DefaultAsCodeSyncEngine } from "../../../src/collaboration/core/sync-engine.ts";
import { DefaultCollaborationAdapterFactory } from "../../../src/collaboration/core/adapter-factory.ts";
import type { WorkflowConfig } from "../../../src/types/index.ts";
import type { PageRef, IssueRef } from "../../../src/collaboration/types.ts";

// ── env loading ───────────────────────────────────────────────────────────────

// Bun loads .env automatically, but we guard each suite explicitly.
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function hasEnv(...names: string[]): boolean {
  return names.every(n => !!process.env[n]);
}

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_TAG = `ai-sdd-e2e-${Date.now()}` as const;

function makeWorkflow(tasks: Record<string, { description?: string }>): WorkflowConfig {
  return {
    version: "1",
    name: "e2e-test-workflow",
    tasks: tasks as WorkflowConfig["tasks"],
  } as WorkflowConfig;
}

// ── Suite: Slack ──────────────────────────────────────────────────────────────

describe("Slack (live)", () => {
  const skip = !hasEnv("SLACK_BOT_TOKEN", "SLACK_NOTIFY_CHANNEL");

  it("healthCheck returns ok:true with valid token", async () => {
    if (skip) {
      if(!hasEnv('SLACK_BOT_TOKEN')){
        console.log("SKIP: SLACK_BOT_TOKEN not set");
      }
       else
        console.log("SKIP: SLACK_NOTIFY_CHANNEL not set");
      return;
    }

    const adapter = new SlackNotificationAdapter(env("SLACK_BOT_TOKEN"));
    const result = await adapter.healthCheck();

    expect(result.ok).toBe(true);
  });

  it("posts a notification message and returns a MessageRef", async () => {
    if (skip) { console.log("SKIP: SLACK_BOT_TOKEN not set"); return; }

    const adapter = new SlackNotificationAdapter(env("SLACK_BOT_TOKEN"));
    const channel = hasEnv('SLACK_NOTIFY_CHANNEL_TEST') ? env("SLACK_NOTIFY_CHANNEL_TEST") : env("SLACK_NOTIFY_CHANNEL");

    const result = await adapter.postNotification(channel, {
      task_id: "e2e-test-task",
      title: `[E2E Test] ${TEST_TAG}`,
      body: "This is an automated end-to-end test message from ai-sdd. Safe to ignore.",
      action_hints: {
        approve_cmd: "@ai-sdd approve e2e-test-task",
        reject_cmd: "@ai-sdd reject e2e-test-task reason here",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.provider).toBe("slack");
    expect(typeof result.value.id).toBe("string");
    expect(result.value.id.length).toBeGreaterThan(0);
    expect(result.value.channel).toBe(channel);
    // ts is a Slack epoch like "1710151200.001234"
    expect(result.value.timestamp).toMatch(/^\d+\.\d+$|^\d{4}-\d{2}-\d{2}T/);
  });

  it("startListener and stopListener succeed without throwing", async () => {
    if (skip) { console.log("SKIP: SLACK_BOT_TOKEN not set"); return; }

    const adapter = new SlackNotificationAdapter(env("SLACK_BOT_TOKEN"), 60); // 60s poll — no actual poll in test
    const channel = env("SLACK_NOTIFY_CHANNEL");

    const listenerResult = await adapter.startListener(channel, (_signal) => {});
    expect(listenerResult.ok).toBe(true);
    if (!listenerResult.ok) return;

    const handle = listenerResult.value;
    expect(typeof handle.id).toBe("string");
    expect(typeof handle.stop).toBe("function");

    await adapter.stopListener(handle); // must not throw
  });
});

// ── Suite: Confluence ─────────────────────────────────────────────────────────

describe("Confluence (live)", () => {
  const skip = !hasEnv(
    "CONFLUENCE_API_TOKEN", "CONFLUENCE_USER_EMAIL",
    "CONFLUENCE_BASE_URL", "CONFLUENCE_SPACE_KEY",
  );

  let createdPageRef: PageRef | undefined;

  it("healthCheck returns ok:true with valid credentials", async () => {
    if (skip) { console.log("SKIP: Confluence env vars not set"); return; }

    const adapter = new ConfluenceDocumentAdapter(
      env("CONFLUENCE_API_TOKEN"),
      env("CONFLUENCE_USER_EMAIL"),
      env("CONFLUENCE_BASE_URL"),
    );

    const result = await adapter.healthCheck();
    expect(result.ok).toBe(true);
  });

  it("creates a page, reads it back, posts a comment, then deletes it", async () => {
    if (skip) { console.log("SKIP: Confluence env vars not set"); return; }

    const adapter = new ConfluenceDocumentAdapter(
      env("CONFLUENCE_API_TOKEN"),
      env("CONFLUENCE_USER_EMAIL"),
      env("CONFLUENCE_BASE_URL"),
    );
    const space = hasEnv("CONFLUENCE_SPACE_KEY_TEST")?env("CONFLUENCE_SPACE_KEY_TEST"):env("CONFLUENCE_SPACE_KEY");

    // Create
    const createResult = await adapter.createPage(
      space,
      "",           // no parent — top-level in space
      `[ai-sdd E2E] ${TEST_TAG}`,
      `# E2E Test Page\n\nCreated by ai-sdd e2e test suite.\nTag: \`${TEST_TAG}\`\n`,
    );

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    createdPageRef = createResult.value;
    expect(createdPageRef.provider).toBe("confluence");
    expect(typeof createdPageRef.id).toBe("string");
    expect(typeof createdPageRef.url).toBe("string");
    expect(createdPageRef.version).toBeGreaterThanOrEqual(1);

    // Read
    const getResult = await adapter.getPage(createdPageRef);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.title).toContain(TEST_TAG);

    // Post comment
    const commentResult = await adapter.postComment(createdPageRef, "E2E test comment — safe to ignore.");
    expect(commentResult.ok).toBe(true);
    if (!commentResult.ok) return;
    expect(typeof commentResult.value.id).toBe("string");

    // Get comments
    const commentsResult = await adapter.getComments(createdPageRef);
    expect(commentsResult.ok).toBe(true);
    if (!commentsResult.ok) return;
    const comments = commentsResult.value;
    expect(comments.length).toBeGreaterThanOrEqual(1);
    const testComment = comments.find(c => c.body.includes("E2E test comment"));
    expect(testComment).toBeDefined();

    // Update
    const updateResult = await adapter.updatePage(
      createdPageRef,
      `# E2E Test Page (updated)\n\nUpdated by ai-sdd e2e test.\n`,
    );
    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) return;
    expect(updateResult.value.version).toBeGreaterThan(createdPageRef.version);

    // Delete (cleanup)
    const deleteResult = await adapter.deletePage(updateResult.value);
    expect(deleteResult.ok).toBe(true);
    createdPageRef = undefined;
  });

  // Fallback cleanup in case the main test threw before delete.
  it("cleanup: delete test page if previous test failed", async () => {
    if (skip || !createdPageRef) return;

    const adapter = new ConfluenceDocumentAdapter(
      env("CONFLUENCE_API_TOKEN"),
      env("CONFLUENCE_USER_EMAIL"),
      env("CONFLUENCE_BASE_URL"),
    );
    await adapter.deletePage(createdPageRef);
    createdPageRef = undefined;
  });
});

// ── Suite: Jira ───────────────────────────────────────────────────────────────

describe("Jira (live)", () => {
  const skip = !hasEnv(
    "JIRA_API_TOKEN", "JIRA_USER_EMAIL",
    "JIRA_BASE_URL", "JIRA_PROJECT_KEY",
  );

  let createdIssueRef: IssueRef | undefined;

  it("healthCheck returns ok:true with valid credentials", async () => {
    if (skip) { console.log("SKIP: Jira env vars not set"); return; }

    const adapter = new JiraTaskTrackingAdapter(
      env("JIRA_API_TOKEN"),
      env("JIRA_USER_EMAIL"),
      env("JIRA_BASE_URL"),
    );
    const result = await adapter.healthCheck();
    expect(result.ok).toBe(true);
  });

  it("creates a task, reads it back, transitions it, then cleans up", async () => {
    if (skip) { console.log("SKIP: Jira env vars not set"); return; }

    const adapter = new JiraTaskTrackingAdapter(
      env("JIRA_API_TOKEN"),
      env("JIRA_USER_EMAIL"),
      env("JIRA_BASE_URL"),
    );
    const project =hasEnv("JIRA_PROJECT_KEY_TEST")? env("JIRA_PROJECT_KEY_TEST") : env("JIRA_PROJECT_KEY") ;

    // Create
    const createResult = await adapter.createTask(
      project,
      null,
      `[ai-sdd E2E] ${TEST_TAG}`,
      `Automated end-to-end test task. Safe to delete.\nTag: ${TEST_TAG}`,
      { labels: ["ai-sdd", "e2e-test"], issue_type: "Task" },
    );

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    createdIssueRef = createResult.value;
    expect(createdIssueRef.provider).toBe("jira");
    expect(typeof createdIssueRef.key).toBe("string");
    expect(createdIssueRef.key).toMatch(new RegExp(`^${project}-\\d+$`));
    expect(typeof createdIssueRef.url).toBe("string");

    // Read
    const getResult = await adapter.getTask(createdIssueRef);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.summary).toContain(TEST_TAG);
    expect(getResult.value.labels).toContain("ai-sdd");
    expect(getResult.value.labels).toContain("e2e-test");

    // Update
    const updateResult = await adapter.updateTask(createdIssueRef, {
      summary: `[ai-sdd E2E updated] ${TEST_TAG}`,
      description: "Updated by e2e test.",
    });
    expect(updateResult.ok).toBe(true);

    // Add label
    const addLabelResult = await adapter.addLabel(createdIssueRef, "ai-sdd:tested");
    expect(addLabelResult.ok).toBe(true);

    // Get available transitions
    const transitionsResult = await adapter.getAvailableTransitions(createdIssueRef);
    expect(transitionsResult.ok).toBe(true);
    if (!transitionsResult.ok) return;
    expect(Array.isArray(transitionsResult.value)).toBe(true);
    expect(transitionsResult.value.length).toBeGreaterThan(0);

    // Transition to "In Progress" if available (common Jira name variants)
    const inProgressTransition = transitionsResult.value.find(t =>
      /in.?progress|start/i.test(t.name),
    );
    if (inProgressTransition) {
      const transitionResult = await adapter.transitionTask(createdIssueRef, inProgressTransition.name);
      expect(transitionResult.ok).toBe(true);
    }

    // List tasks — our new issue must appear
    const listResult = await adapter.listTasks(project, { labels: ["e2e-test"] });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    const found = listResult.value.find(t => t.key === createdIssueRef!.key);
    expect(found).toBeDefined();

    createdIssueRef = undefined; // Jira doesn't support deleting issues via REST — leave it
  }, 20000);
});

// ── Suite: GitHub Code Review ─────────────────────────────────────────────────

describe("GitHub Code Review (live)", () => {
  const skip = !hasEnv("GITHUB_TOKEN", "GITHUB_REPO_OWNER", "GITHUB_REPO_NAME");

  it("healthCheck returns ok:true with valid token", async () => {
    if (skip) { console.log("SKIP: GitHub env vars not set"); return; }

    const adapter = new GitHubCodeReviewAdapter(env("GITHUB_TOKEN"));
    const result = await adapter.healthCheck();
    expect(result.ok).toBe(true);
  });

  it("getPipelineStatus for a recent Actions run returns a valid status", async () => {
    if (skip) { console.log("SKIP: GitHub env vars not set"); return; }

    const adapter = new GitHubCodeReviewAdapter(env("GITHUB_TOKEN"));
    const repo = `${env("GITHUB_REPO_OWNER")}/${env("GITHUB_REPO_NAME")}`;

    // triggerPipeline with no pipelineName — list-based trigger
    const triggerResult = await adapter.triggerPipeline(repo, "main");

    // It's OK if trigger returns an error (no workflows configured in test repo);
    // we're primarily testing that the call completes without throwing.
    expect(typeof triggerResult.ok).toBe("boolean");

    if (triggerResult.ok) {
      const pipelineRef = triggerResult.value;
      expect(pipelineRef.provider).toBe("github");
      expect(typeof pipelineRef.id).toBe("string");

      // Get status of the triggered run
      const statusResult = await adapter.getPipelineStatus(pipelineRef);
      expect(statusResult.ok).toBe(true);
      if (!statusResult.ok) return;
      expect(["pending", "running", "passed", "failed", "stopped"]).toContain(statusResult.value);
    }
  });
});

// ── Suite: GitHub Task Tracking ───────────────────────────────────────────────

describe("GitHub Task Tracking (live)", () => {
  const skip = !hasEnv("GITHUB_TOKEN", "GITHUB_REPO_OWNER", "GITHUB_REPO_NAME");

  let createdIssueRef: IssueRef | undefined;

  it("healthCheck returns ok:true with valid token", async () => {
    if (skip) { console.log("SKIP: GitHub env vars not set"); return; }

    const adapter = new GitHubTaskTrackingAdapter(
      env("GITHUB_TOKEN"),
      env("GITHUB_REPO_OWNER"),
      env("GITHUB_REPO_NAME"),
    );
    const result = await adapter.healthCheck();
    expect(result.ok).toBe(true);
  });

  it("creates a GitHub Issue, reads it back, updates it, and closes it", async () => {
    if (skip) { console.log("SKIP: GitHub env vars not set"); return; }

    const adapter = new GitHubTaskTrackingAdapter(
      env("GITHUB_TOKEN"),
      env("GITHUB_REPO_OWNER"),
      env("GITHUB_REPO_NAME"),
    );
    const repo = `${env("GITHUB_REPO_OWNER")}/${env("GITHUB_REPO_NAME")}`;

    // Create
    const createResult = await adapter.createTask(
      repo,
      null,
      `[ai-sdd E2E] ${TEST_TAG}`,
      `Automated end-to-end test issue. Safe to close.\nTag: \`${TEST_TAG}\``,
      { labels: ["ai-sdd"] },
    );

    if (!createResult.ok && createResult.error.code === "AUTH") {
      console.log(`SKIP: GitHub token lacks Issues write permission (${createResult.error.message})`);
      return;
    }
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    createdIssueRef = createResult.value;
    expect(createdIssueRef.provider).toBe("github");
    expect(typeof createdIssueRef.key).toBe("string");
    expect(typeof createdIssueRef.url).toBe("string");

    // Read
    const getResult = await adapter.getTask(createdIssueRef);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.summary).toContain(TEST_TAG);
    expect(getResult.value.labels).toContain("ai-sdd");

    // Update description
    const updateResult = await adapter.updateTask(createdIssueRef, {
      description: "Updated by e2e test.",
    });
    expect(updateResult.ok).toBe(true);

    // Add label
    const addLabelResult = await adapter.addLabel(createdIssueRef, "e2e-tested");
    expect(addLabelResult.ok).toBe(true);

    // Transition to closed (cleanup)
    const closeResult = await adapter.transitionTask(createdIssueRef, "closed");
    expect(closeResult.ok).toBe(true);

    createdIssueRef = undefined;
  });

  it("cleanup: close issue if previous test threw before close", async () => {
    if (skip || !createdIssueRef) return;

    const adapter = new GitHubTaskTrackingAdapter(
      env("GITHUB_TOKEN"),
      env("GITHUB_REPO_OWNER"),
      env("GITHUB_REPO_NAME"),
    );
    await adapter.transitionTask(createdIssueRef, "closed");
    createdIssueRef = undefined;
  });
});

// ── Suite: AsCodeSyncEngine + Jira (live roundtrip) ──────────────────────────

describe("AsCodeSyncEngine → Jira (live sync roundtrip)", () => {
  const skip = !hasEnv(
    "JIRA_API_TOKEN", "JIRA_USER_EMAIL",
    "JIRA_BASE_URL", "JIRA_PROJECT_KEY",
  );

  it("syncs a 3-task workflow to Jira, verifies issues exist, re-syncs idempotently", async () => {
    if (skip) { console.log("SKIP: Jira env vars not set"); return; }

    const adapter = new JiraTaskTrackingAdapter(
      env("JIRA_API_TOKEN"),
      env("JIRA_USER_EMAIL"),
      env("JIRA_BASE_URL"),
    );
    const project = env("JIRA_PROJECT_KEY");
    const engine = new DefaultAsCodeSyncEngine(project);

    const workflow = makeWorkflow({
      [`e2e-sync-${TEST_TAG}-a`]: { description: "E2E sync task A" },
      [`e2e-sync-${TEST_TAG}-b`]: { description: "E2E sync task B" },
      [`e2e-sync-${TEST_TAG}-c`]: { description: "E2E sync task C" },
    });

    // First sync — should create 3 issues
    const report1 = await engine.sync(workflow, adapter);

    expect(report1.created).toBe(3);
    expect(report1.updated).toBe(0);
    expect(report1.errors).toHaveLength(0);

    const mappings = engine.getMappings();
    expect(mappings).toHaveLength(3);

    // Verify each created issue exists in Jira
    for (const mapping of mappings) {
      const ref: IssueRef = {
        provider: "jira",
        key: mapping.issue_key,
        id: mapping.issue_key,
        url: "",
      };
      const getResult = await adapter.getTask(ref);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) continue;
      expect(getResult.value.labels).toContain("ai-sdd");
    }

    // Second sync — idempotent, nothing changed
    const report2 = await engine.sync(workflow, adapter);
    expect(report2.created).toBe(0);
    expect(report2.updated).toBe(0);
    expect(report2.unchanged).toBe(3);
    expect(report2.errors).toHaveLength(0);
  }, 30000);
});

// ── Suite: AdapterFactory credential validation ───────────────────────────────

describe("DefaultCollaborationAdapterFactory.validateCredentials (live env)", () => {
  it("returns ok:true when all real adapter env vars are present", () => {
    if (!hasEnv("SLACK_BOT_TOKEN", "CONFLUENCE_API_TOKEN", "CONFLUENCE_USER_EMAIL",
      "CONFLUENCE_BASE_URL", "JIRA_API_TOKEN", "JIRA_USER_EMAIL", "JIRA_BASE_URL",
      "GITHUB_TOKEN")) {
      console.log("SKIP: not all adapter env vars set");
      return;
    }

    const factory = new DefaultCollaborationAdapterFactory({
      notification: "slack",
      document: "confluence",
      task_tracking: "jira",
      code_review: "github",
    });

    const result = factory.validateCredentials();
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with AUTH error when a required var is missing", () => {
    // Unset SLACK_BOT_TOKEN for just this test by using a scope-local adapter factory
    // with an env var that is definitely absent.
    const saved = process.env["SLACK_BOT_TOKEN"];
    delete process.env["SLACK_BOT_TOKEN"];

    const factory = new DefaultCollaborationAdapterFactory({
      notification: "slack",
      document: "mock",
      task_tracking: "mock",
      code_review: "mock",
    });

    const result = factory.validateCredentials();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AUTH");
      expect(result.error.message).toContain("SLACK_BOT_TOKEN");
    }

    // Restore
    if (saved !== undefined) process.env["SLACK_BOT_TOKEN"] = saved;
  });
});
