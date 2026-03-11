/**
 * Bitbucket adapter tests — mock adapter behavior, merge strategies, fixture-based parsing.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { MockCodeReviewAdapter } from "../../../../src/collaboration/impl/mock-code-review-adapter.ts";

const FIXTURES_DIR = join(import.meta.dir, "../../../fixtures/bitbucket");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));
}

describe("MockCodeReviewAdapter (Bitbucket-style)", () => {
  it("creates a PR and returns a ref", async () => {
    const adapter = new MockCodeReviewAdapter();
    const result = await adapter.createPullRequest(
      "my-repo", "feature/async", "master", "Async Engine", "Implements async support",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider).toBe("mock");
    expect(result.value.id).toMatch(/^mock-pr-\d+$/);
    expect(result.value.repo).toBe("my-repo");
  });

  it("gets PR status", async () => {
    const adapter = new MockCodeReviewAdapter();
    const createResult = await adapter.createPullRequest("repo", "src", "dst", "Title", "Desc");
    if (!createResult.ok) return;

    const statusResult = await adapter.getPullRequestStatus(createResult.value);
    expect(statusResult.ok).toBe(true);
    if (!statusResult.ok) return;
    expect(statusResult.value).toBe("open");
  });

  it("merges a PR and updates status", async () => {
    const adapter = new MockCodeReviewAdapter();
    const createResult = await adapter.createPullRequest("repo", "src", "dst", "Title", "Desc");
    if (!createResult.ok) return;

    const mergeResult = await adapter.mergePullRequest(createResult.value, "squash");
    expect(mergeResult.ok).toBe(true);
    if (!mergeResult.ok) return;
    expect(mergeResult.value.merged).toBe(true);
    expect(mergeResult.value.commit_hash).toBeTruthy();

    const statusResult = await adapter.getPullRequestStatus(createResult.value);
    if (!statusResult.ok) return;
    expect(statusResult.value).toBe("merged");
  });

  it("posts review comments", async () => {
    const adapter = new MockCodeReviewAdapter();
    const createResult = await adapter.createPullRequest("repo", "src", "dst", "Title", "Desc");
    if (!createResult.ok) return;

    await adapter.postReviewComment(createResult.value, "LGTM!");
    await adapter.postReviewComment(createResult.value, "Check line 42", "src/index.ts", 42);

    const commentsResult = await adapter.getReviewComments(createResult.value);
    expect(commentsResult.ok).toBe(true);
    if (!commentsResult.ok) return;
    expect(commentsResult.value).toHaveLength(2);
  });

  it("filters review comments by since timestamp", async () => {
    const adapter = new MockCodeReviewAdapter();
    const createResult = await adapter.createPullRequest("repo", "src", "dst", "Title", "Desc");
    if (!createResult.ok) return;

    await adapter.postReviewComment(createResult.value, "Old comment");
    // Capture cutoff AFTER the old comment is added.
    const since = new Date().toISOString();
    // Ensure next comment is strictly after the cutoff.
    await new Promise(r => setTimeout(r, 5));
    await adapter.postReviewComment(createResult.value, "New comment");

    const filtered = await adapter.getReviewComments(createResult.value, since);
    if (!filtered.ok) return;
    expect(filtered.value).toHaveLength(1);
    const firstComment = filtered.value[0];
    expect(firstComment).toBeDefined();
    if (!firstComment) return;
    expect(firstComment.body).toBe("New comment");
  });

  it("approves a PR", async () => {
    const adapter = new MockCodeReviewAdapter();
    const createResult = await adapter.createPullRequest("repo", "src", "dst", "Title", "Desc");
    if (!createResult.ok) return;

    const approveResult = await adapter.approvePullRequest(createResult.value);
    expect(approveResult.ok).toBe(true);
  });

  it("requests changes on a PR", async () => {
    const adapter = new MockCodeReviewAdapter();
    const createResult = await adapter.createPullRequest("repo", "src", "dst", "Title", "Desc");
    if (!createResult.ok) return;

    const requestResult = await adapter.requestChanges(createResult.value, "Please add tests");
    expect(requestResult.ok).toBe(true);
  });

  it("triggers and polls pipeline", async () => {
    const adapter = new MockCodeReviewAdapter();
    const pipelineResult = await adapter.triggerPipeline("my-repo", "feature/async");
    expect(pipelineResult.ok).toBe(true);
    if (!pipelineResult.ok) return;

    const statusResult = await adapter.getPipelineStatus(pipelineResult.value);
    expect(statusResult.ok).toBe(true);
    if (!statusResult.ok) return;
    expect(statusResult.value).toBe("running");
  });

  it("health check passes", async () => {
    const adapter = new MockCodeReviewAdapter();
    const result = await adapter.healthCheck();
    expect(result.ok).toBe(true);
  });

  it("returns NOT_FOUND for unknown PR", async () => {
    const adapter = new MockCodeReviewAdapter();
    const result = await adapter.getPullRequestStatus({ provider: "mock", id: "nonexistent", url: "", repo: "repo" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("injects errors via failOn option", async () => {
    const adapter = new MockCodeReviewAdapter({
      failOn: { method: "mergePullRequest", error: { code: "NETWORK", message: "Connection refused", retryable: true } },
    });
    const createResult = await adapter.createPullRequest("repo", "src", "dst", "Title", "Desc");
    if (!createResult.ok) return;

    const mergeResult = await adapter.mergePullRequest(createResult.value);
    expect(mergeResult.ok).toBe(false);
    if (mergeResult.ok) return;
    expect(mergeResult.error.code).toBe("NETWORK");
  });
});

describe("Bitbucket fixtures (Dev Standard #4)", () => {
  it("validates create-pr-response fixture structure", () => {
    const fixture = loadFixture("create-pr-response.json") as {
      id: number;
      title: string;
      state: string;
      source: { branch: { name: string } };
      destination: { branch: { name: string } };
      links: { html: { href: string } };
    };

    expect(fixture.id).toBeGreaterThan(0);
    expect(fixture.title).toBeTruthy();
    expect(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]).toContain(fixture.state);
    expect(fixture.source.branch.name).toBeTruthy();
    expect(fixture.destination.branch.name).toBeTruthy();
    expect(fixture.links.html.href).toMatch(/^https?:\/\//);
  });
});
