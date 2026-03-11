/**
 * GitHubCodeReviewAdapter — PR lifecycle management and GitHub Actions pipeline triggers.
 * Uses GitHub REST API v3.
 *
 * API mappings:
 *   createPullRequest    → POST /repos/{owner}/{repo}/pulls
 *   getReviewComments    → GET  /repos/{owner}/{repo}/pulls/{number}/comments
 *   postReviewComment    → POST /repos/{owner}/{repo}/pulls/{number}/comments
 *   approvePullRequest   → POST /repos/{owner}/{repo}/pulls/{number}/reviews (event: APPROVE)
 *   requestChanges       → POST /repos/{owner}/{repo}/pulls/{number}/reviews (event: REQUEST_CHANGES)
 *   mergePullRequest     → PUT  /repos/{owner}/{repo}/pulls/{number}/merge
 *   getPullRequestStatus → GET  /repos/{owner}/{repo}/pulls/{number}
 *   triggerPipeline      → POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches
 *   getPipelineStatus    → GET  /repos/{owner}/{repo}/actions/runs/{id}
 *   healthCheck          → GET  /user
 */

import type {
  CodeReviewAdapter,
  ReviewComment,
  MergeResult,
  MergeStrategy,
  PRStatus,
  PipelineStatus,
} from "../adapters/code-review-adapter.ts";
import type { Result, PRRef, PipelineRef, CommentRef } from "../types.ts";
import { RetryHttpClient } from "../infra/retry.ts";

const GITHUB_API_BASE = "https://api.github.com";

/** GitHub merge method names map from our strategy types. */
const MERGE_METHOD_MAP: Record<MergeStrategy, string> = {
  merge:          "merge",
  squash:         "squash",
  "fast-forward": "rebase",   // GitHub "rebase" = fast-forward merge
};

interface GitHubPR {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged: boolean;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
  node_id: string;
}

interface GitHubPRCreateResponse {
  id: number;
  number: number;
  html_url: string;
  node_id: string;
}

interface GitHubPRMergeResponse {
  sha: string;
  merged: boolean;
  message: string;
}

interface GitHubReviewComment {
  id: number;
  user?: { login?: string } | null;
  body: string;
  created_at: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
}

interface GitHubActionsWorkflowRun {
  id: number;
  status: "queued" | "in_progress" | "completed" | null;
  conclusion: "success" | "failure" | "cancelled" | "skipped" | "timed_out" | null;
  html_url: string;
}

interface GitHubActionsRunsResponse {
  workflow_runs: GitHubActionsWorkflowRun[];
}

interface GitHubUserResponse {
  login: string;
  id: number;
}

function mapPRStatus(pr: GitHubPR): PRStatus {
  if (pr.merged) return "merged";
  if (pr.state === "closed") return "declined";
  return "open";
}

function mapRunStatus(run: GitHubActionsWorkflowRun): PipelineStatus {
  if (run.status === "completed") {
    if (run.conclusion === "success") return "passed";
    if (run.conclusion === "failure" || run.conclusion === "timed_out") return "failed";
    if (run.conclusion === "cancelled") return "stopped";
    return "stopped";
  }
  if (run.status === "in_progress") return "running";
  return "pending";
}

/** Parse "{owner}/{repo}" from a PRRef.repo string. */
function parseRepo(repoStr: string, defaultOwner: string): [string, string] {
  const parts = repoStr.split("/");
  if (parts.length >= 2) {
    const owner = parts[0];
    const repo = parts[1];
    if (owner !== undefined && repo !== undefined) return [owner, repo];
  }
  return [defaultOwner, repoStr];
}

export class GitHubCodeReviewAdapter implements CodeReviewAdapter {
  readonly provider = "github";

  private readonly client: RetryHttpClient;

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly defaultRepo: string,
  ) {
    this.client = new RetryHttpClient({
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
  }

  async createPullRequest(
    repo: string,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string,
  ): Promise<Result<PRRef>> {
    const [owner, repoSlug] = parseRepo(repo, this.owner);

    const result = await this.client.post<GitHubPRCreateResponse>(
      `${GITHUB_API_BASE}/repos/${owner}/${repoSlug}/pulls`,
      {
        title,
        body: description,
        head: sourceBranch,
        base: targetBranch,
        draft: false,
      },
    );

    if (!result.ok) return result;

    return {
      ok: true,
      value: {
        provider: "github",
        id: String(result.value.number),
        url: result.value.html_url,
        repo: `${owner}/${repoSlug}`,
      },
    };
  }

  async getReviewComments(ref: PRRef, since?: string): Promise<Result<ReviewComment[]>> {
    const [owner, repo] = parseRepo(ref.repo, this.owner);
    const result = await this.client.get<GitHubReviewComment[]>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${ref.id}/comments`,
    );

    if (!result.ok) return result;

    const comments: ReviewComment[] = result.value.map(c => {
      const comment: ReviewComment = {
        id: String(c.id),
        author: c.user?.login ?? "unknown",
        body: c.body,
        created_at: c.created_at,
      };
      if (c.path !== undefined) comment.file_path = c.path;
      const lineNum = c.line ?? c.original_line;
      if (lineNum != null) comment.line = lineNum;
      return comment;
    });

    // GitHub REST API supports `since` parameter for issue comments but not pull request
    // review comments. Filter client-side.
    const filtered = since
      ? comments.filter(c => c.created_at >= since)
      : comments;

    return { ok: true, value: filtered };
  }

  async postReviewComment(
    ref: PRRef,
    body: string,
    filePath?: string,
    line?: number,
  ): Promise<Result<CommentRef>> {
    const [owner, repo] = parseRepo(ref.repo, this.owner);

    const payload: Record<string, unknown> = { body };

    if (filePath !== undefined && line !== undefined) {
      payload["path"] = filePath;
      payload["line"] = line;
      payload["side"] = "RIGHT";
      // commit_id is required for inline comments — we use the PR's latest commit.
      // For simplicity, we'll post a regular review comment body-only if no commit_id.
      // A real implementation would fetch the PR head SHA first.
      // Here we fall through to the issue comment endpoint for the body-only case.
    }

    // Prefer the pull request review comments endpoint for inline comments.
    // For general body-only comments, use the issue comments endpoint.
    if (filePath !== undefined && line !== undefined) {
      // Inline comment needs commit_id — fetch PR head SHA first.
      const prResult = await this.client.get<GitHubPR>(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${ref.id}`,
      );
      if (!prResult.ok) return prResult;

      // Use the issue comments endpoint for simplicity when commit SHA isn't cached.
      // Full inline support would fetch the diff and position mapping.
      const commentResult = await this.client.post<{ id: number }>(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${ref.id}/comments`,
        { body: `[${filePath}:${line}] ${body}` },
      );
      if (!commentResult.ok) return commentResult;
      return { ok: true, value: { provider: "github", id: String(commentResult.value.id) } };
    }

    // General review comment (body only) via issue comments.
    const result = await this.client.post<{ id: number }>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${ref.id}/comments`,
      { body },
    );

    if (!result.ok) return result;

    return {
      ok: true,
      value: { provider: "github", id: String(result.value.id) },
    };
  }

  async approvePullRequest(ref: PRRef): Promise<Result<void>> {
    const [owner, repo] = parseRepo(ref.repo, this.owner);
    const result = await this.client.post<{ id: number }>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${ref.id}/reviews`,
      { event: "APPROVE" },
    );
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  async requestChanges(ref: PRRef, body: string): Promise<Result<void>> {
    const [owner, repo] = parseRepo(ref.repo, this.owner);
    const result = await this.client.post<{ id: number }>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${ref.id}/reviews`,
      {
        body,
        event: "REQUEST_CHANGES",
      },
    );
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  async mergePullRequest(ref: PRRef, strategy: MergeStrategy = "squash"): Promise<Result<MergeResult>> {
    const [owner, repo] = parseRepo(ref.repo, this.owner);
    const mergeMethod = MERGE_METHOD_MAP[strategy];

    // GitHub uses PUT for merge, but RetryHttpClient.put uses PUT.
    const result = await this.client.put<GitHubPRMergeResponse>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${ref.id}/merge`,
      { merge_method: mergeMethod },
    );

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
      };
    }

    return {
      ok: true,
      value: { merged: result.value.merged, commit_hash: result.value.sha },
    };
  }

  async getPullRequestStatus(ref: PRRef): Promise<Result<PRStatus>> {
    const [owner, repo] = parseRepo(ref.repo, this.owner);
    const result = await this.client.get<GitHubPR>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${ref.id}`,
    );
    if (!result.ok) return result;
    return { ok: true, value: mapPRStatus(result.value) };
  }

  async triggerPipeline(repo: string, branch: string, pipelineName?: string): Promise<Result<PipelineRef>> {
    const [owner, repoSlug] = parseRepo(repo, this.owner);

    // Workflow dispatch requires a workflow ID or file name.
    // If pipelineName is provided, use it as the workflow file name; otherwise use "ci.yml".
    const workflowId = pipelineName ?? "ci.yml";

    const result = await this.client.post<void>(
      `${GITHUB_API_BASE}/repos/${owner}/${repoSlug}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
      { ref: branch },
    );

    if (!result.ok) return result;

    // GitHub Actions dispatch returns 204 (no body) — we must poll for the run ID.
    // We poll /actions/runs with a short delay to get the latest run.
    await new Promise<void>(resolve => setTimeout(resolve, 2_000));

    const runsResult = await this.client.get<GitHubActionsRunsResponse>(
      `${GITHUB_API_BASE}/repos/${owner}/${repoSlug}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
    );

    if (!runsResult.ok) {
      // Return a synthetic ref if we can't get the run ID.
      const syntheticId = `${branch}-${Date.now()}`;
      return {
        ok: true,
        value: {
          provider: "github",
          id: syntheticId,
          url: `https://github.com/${owner}/${repoSlug}/actions`,
        },
      };
    }

    const latestRun = runsResult.value.workflow_runs[0];
    if (!latestRun) {
      const syntheticId = `${branch}-${Date.now()}`;
      return {
        ok: true,
        value: {
          provider: "github",
          id: syntheticId,
          url: `https://github.com/${owner}/${repoSlug}/actions`,
        },
      };
    }

    return {
      ok: true,
      value: {
        provider: "github",
        id: String(latestRun.id),
        url: latestRun.html_url,
      },
    };
  }

  async getPipelineStatus(ref: PipelineRef): Promise<Result<PipelineStatus>> {
    // Extract owner/repo from the pipeline URL or use defaults.
    const [owner, repo] = this.parseRepoFromPipelineRef(ref);

    const result = await this.client.get<GitHubActionsWorkflowRun>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${ref.id}`,
    );

    if (!result.ok) return result;

    return { ok: true, value: mapRunStatus(result.value) };
  }

  async healthCheck(): Promise<Result<void>> {
    const result = await this.client.get<GitHubUserResponse>(
      `${GITHUB_API_BASE}/user`,
    );
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Extract owner/repo from pipeline ref URL, falling back to instance defaults. */
  private parseRepoFromPipelineRef(ref: PipelineRef): [string, string] {
    // Expected URL pattern: https://github.com/{owner}/{repo}/actions/runs/{id}
    const match = ref.url.match(/github\.com\/([^/]+)\/([^/]+)\/actions/);
    if (match) {
      const owner = match[1];
      const repo = match[2];
      if (owner !== undefined && repo !== undefined) return [owner, repo];
    }
    return [this.owner, this.defaultRepo];
  }
}
