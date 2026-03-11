/**
 * BitbucketCodeReviewAdapter — PR creation, review feedback, merge flow, and pipeline triggers.
 * Uses Bitbucket Cloud REST API v2.0.
 *
 * API mappings:
 *   createPullRequest    → POST /2.0/repositories/{workspace}/{repo}/pullrequests
 *   getReviewComments    → GET  /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments
 *   postReviewComment    → POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments
 *   approvePullRequest   → POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/approve
 *   requestChanges       → POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/request-changes
 *   mergePullRequest     → POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/merge
 *   getPullRequestStatus → GET  /2.0/repositories/{workspace}/{repo}/pullrequests/{id}
 *   triggerPipeline      → POST /2.0/repositories/{workspace}/{repo}/pipelines/
 *   getPipelineStatus    → GET  /2.0/repositories/{workspace}/{repo}/pipelines/{uuid}
 *   healthCheck          → GET  /2.0/user
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

const MERGE_STRATEGY_MAP: Record<MergeStrategy, string> = {
  merge:         "merge_commit",
  squash:        "squash",
  "fast-forward": "fast_forward",
};

interface BitbucketPR {
  id: number;
  title: string;
  state: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";
  links: { html: { href: string } };
}

interface BitbucketComment {
  id: number;
  content: { raw: string };
  created_on: string;
  author?: { display_name?: string };
  inline?: { path?: string; to?: number };
}

interface BitbucketCommentsResponse {
  values: BitbucketComment[];
  next?: string;
}

interface BitbucketMergeResponse {
  hash: string;
}

interface BitbucketPipeline {
  uuid: string;
  state: { name: string; result?: { name: string } };
  links: { self: { href: string } };
}

function mapPRStatus(state: string): PRStatus {
  switch (state) {
    case "OPEN":        return "open";
    case "MERGED":      return "merged";
    case "DECLINED":    return "declined";
    case "SUPERSEDED":  return "superseded";
    default:            return "open";
  }
}

function mapPipelineStatus(pipeline: BitbucketPipeline): PipelineStatus {
  const stateName = pipeline.state.name;
  const resultName = pipeline.state.result?.name;
  if (stateName === "COMPLETED") {
    if (resultName === "SUCCESSFUL") return "passed";
    if (resultName === "FAILED")    return "failed";
    if (resultName === "STOPPED")   return "stopped";
  }
  if (stateName === "IN_PROGRESS") return "running";
  if (stateName === "PENDING")     return "pending";
  return "pending";
}

export class BitbucketCodeReviewAdapter implements CodeReviewAdapter {
  readonly provider = "bitbucket";

  private readonly client: RetryHttpClient;
  private readonly baseUrl = "https://api.bitbucket.org";

  constructor(
    private readonly appPassword: string,
    private readonly username: string,
    private readonly workspace: string,
  ) {
    const credentials = Buffer.from(`${username}:${appPassword}`).toString("base64");
    this.client = new RetryHttpClient({
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    });
  }

  async createPullRequest(
    repo: string,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string,
  ): Promise<Result<PRRef>> {
    const result = await this.client.post<BitbucketPR>(
      `${this.baseUrl}/2.0/repositories/${this.workspace}/${repo}/pullrequests`,
      {
        title,
        description,
        source: { branch: { name: sourceBranch } },
        destination: { branch: { name: targetBranch } },
        close_source_branch: false,
      },
    );

    if (!result.ok) return result;

    return {
      ok: true,
      value: {
        provider: "bitbucket",
        id: String(result.value.id),
        url: result.value.links.html.href,
        repo: `${this.workspace}/${repo}`,
      },
    };
  }

  async getReviewComments(ref: PRRef, since?: string): Promise<Result<ReviewComment[]>> {
    const [workspace, repo] = this.parseRepo(ref.repo);
    const result = await this.client.get<BitbucketCommentsResponse>(
      `${this.baseUrl}/2.0/repositories/${workspace}/${repo}/pullrequests/${ref.id}/comments`,
    );

    if (!result.ok) return result;

    // Bitbucket API doesn't support server-side date filtering on comments — filter client-side.
    const comments: ReviewComment[] = result.value.values.map(c => {
      const comment: ReviewComment = {
        id: String(c.id),
        author: c.author?.display_name ?? "unknown",
        body: c.content.raw,
        created_at: c.created_on,
      };
      if (c.inline?.path !== undefined) comment.file_path = c.inline.path;
      if (c.inline?.to !== undefined) comment.line = c.inline.to;
      return comment;
    });

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
    const [workspace, repo] = this.parseRepo(ref.repo);
    const payload: Record<string, unknown> = {
      content: { raw: body },
    };

    if (filePath !== undefined && line !== undefined) {
      payload["inline"] = { path: filePath, to: line };
    }

    const result = await this.client.post<{ id: number }>(
      `${this.baseUrl}/2.0/repositories/${workspace}/${repo}/pullrequests/${ref.id}/comments`,
      payload,
    );

    if (!result.ok) return result;

    return {
      ok: true,
      value: { provider: "bitbucket", id: String(result.value.id) },
    };
  }

  async approvePullRequest(ref: PRRef): Promise<Result<void>> {
    const [workspace, repo] = this.parseRepo(ref.repo);
    const result = await this.client.post<void>(
      `${this.baseUrl}/2.0/repositories/${workspace}/${repo}/pullrequests/${ref.id}/approve`,
      {},
    );
    return result;
  }

  async requestChanges(ref: PRRef, body: string): Promise<Result<void>> {
    const [workspace, repo] = this.parseRepo(ref.repo);
    const result = await this.client.post<void>(
      `${this.baseUrl}/2.0/repositories/${workspace}/${repo}/pullrequests/${ref.id}/request-changes`,
      { content: { raw: body } },
    );
    return result;
  }

  async mergePullRequest(ref: PRRef, strategy: MergeStrategy = "squash"): Promise<Result<MergeResult>> {
    const [workspace, repo] = this.parseRepo(ref.repo);
    const result = await this.client.post<BitbucketMergeResponse>(
      `${this.baseUrl}/2.0/repositories/${workspace}/${repo}/pullrequests/${ref.id}/merge`,
      { merge_strategy: MERGE_STRATEGY_MAP[strategy] },
    );

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
      };
    }

    return {
      ok: true,
      value: { merged: true, commit_hash: result.value.hash },
    };
  }

  async getPullRequestStatus(ref: PRRef): Promise<Result<PRStatus>> {
    const [workspace, repo] = this.parseRepo(ref.repo);
    const result = await this.client.get<BitbucketPR>(
      `${this.baseUrl}/2.0/repositories/${workspace}/${repo}/pullrequests/${ref.id}`,
    );
    if (!result.ok) return result;
    return { ok: true, value: mapPRStatus(result.value.state) };
  }

  async triggerPipeline(repo: string, branch: string, pipelineName?: string): Promise<Result<PipelineRef>> {
    const payload: Record<string, unknown> = {
      target: { ref_type: "branch", type: "pipeline_ref_target", ref_name: branch },
    };

    if (pipelineName) {
      payload["target"] = {
        ...payload["target"] as Record<string, unknown>,
        selector: { type: "custom", pattern: pipelineName },
      };
    }

    const result = await this.client.post<BitbucketPipeline>(
      `${this.baseUrl}/2.0/repositories/${this.workspace}/${repo}/pipelines/`,
      payload,
    );

    if (!result.ok) return result;

    return {
      ok: true,
      value: {
        provider: "bitbucket",
        id: result.value.uuid,
        url: result.value.links.self.href,
      },
    };
  }

  async getPipelineStatus(ref: PipelineRef): Promise<Result<PipelineStatus>> {
    // Extract workspace/repo from the pipeline URL.
    const urlParts = ref.url.split("/repositories/")[1]?.split("/pipelines/")[0]?.split("/");
    const [workspace, repo] = urlParts ?? [this.workspace, ""];

    const result = await this.client.get<BitbucketPipeline>(
      `${this.baseUrl}/2.0/repositories/${workspace}/${repo}/pipelines/${ref.id}`,
    );

    if (!result.ok) return result;

    return { ok: true, value: mapPipelineStatus(result.value) };
  }

  async healthCheck(): Promise<Result<void>> {
    const result = await this.client.get<{ account_id: string }>(
      `${this.baseUrl}/2.0/user`,
    );
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Parse "workspace/repo" from ref.repo. Returns [workspace, repo]. */
  private parseRepo(repoStr: string): [string, string] {
    const parts = repoStr.split("/");
    if (parts.length >= 2) {
      const ws = parts[0];
      const repo = parts[1];
      if (ws !== undefined && repo !== undefined) return [ws, repo];
    }
    return [this.workspace, repoStr];
  }
}
