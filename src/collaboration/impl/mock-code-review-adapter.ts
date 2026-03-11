/**
 * MockCodeReviewAdapter — in-memory code review adapter for testing.
 */

import type {
  CodeReviewAdapter,
  ReviewComment,
  MergeResult,
  MergeStrategy,
  PRStatus,
  PipelineStatus,
} from "../adapters/code-review-adapter.ts";
import type { Result, PRRef, PipelineRef, CommentRef, AdapterError } from "../types.ts";

export interface MockCodeReviewOptions {
  failOn?: { method: string; error: AdapterError };
  latencyMs?: number;
}

interface StoredPR {
  ref: PRRef;
  status: PRStatus;
  comments: ReviewComment[];
}

interface StoredPipeline {
  ref: PipelineRef;
  status: PipelineStatus;
}

export class MockCodeReviewAdapter implements CodeReviewAdapter {
  readonly provider = "mock";

  private prs: Map<string, StoredPR> = new Map();
  private pipelines: Map<string, StoredPipeline> = new Map();
  private nextId = 1;

  constructor(private readonly options: MockCodeReviewOptions = {}) {}

  async createPullRequest(repo: string, sourceBranch: string, targetBranch: string, title: string, description: string): Promise<Result<PRRef>> {
    if (this.options.failOn?.method === "createPullRequest") {
      return { ok: false, error: this.options.failOn.error };
    }
    const id = `mock-pr-${this.nextId++}`;
    const ref: PRRef = { provider: "mock", id, url: `http://mock/pulls/${id}`, repo };
    this.prs.set(id, { ref, status: "open", comments: [] });
    return { ok: true, value: ref };
  }

  async getReviewComments(ref: PRRef, since?: string): Promise<Result<ReviewComment[]>> {
    const pr = this.prs.get(ref.id);
    if (!pr) return { ok: false, error: { code: "NOT_FOUND", message: `PR ${ref.id} not found`, retryable: false } };
    const comments = since
      ? pr.comments.filter(c => c.created_at > since)
      : pr.comments;
    return { ok: true, value: comments };
  }

  async postReviewComment(ref: PRRef, body: string, filePath?: string, line?: number): Promise<Result<CommentRef>> {
    const pr = this.prs.get(ref.id);
    if (!pr) return { ok: false, error: { code: "NOT_FOUND", message: `PR ${ref.id} not found`, retryable: false } };
    const id = `mock-review-comment-${this.nextId++}`;
    const comment: ReviewComment = {
      id,
      author: "mock-user",
      body,
      created_at: new Date().toISOString(),
      ...(filePath !== undefined ? { file_path: filePath } : {}),
      ...(line !== undefined ? { line } : {}),
    };
    pr.comments.push(comment);
    return { ok: true, value: { provider: "mock", id } };
  }

  async approvePullRequest(ref: PRRef): Promise<Result<void>> {
    if (!this.prs.has(ref.id)) return { ok: false, error: { code: "NOT_FOUND", message: `PR ${ref.id} not found`, retryable: false } };
    return { ok: true, value: undefined };
  }

  async requestChanges(ref: PRRef, body: string): Promise<Result<void>> {
    if (!this.prs.has(ref.id)) return { ok: false, error: { code: "NOT_FOUND", message: `PR ${ref.id} not found`, retryable: false } };
    await this.postReviewComment(ref, body);
    return { ok: true, value: undefined };
  }

  async mergePullRequest(ref: PRRef, strategy?: MergeStrategy): Promise<Result<MergeResult>> {
    const pr = this.prs.get(ref.id);
    if (!pr) return { ok: false, error: { code: "NOT_FOUND", message: `PR ${ref.id} not found`, retryable: false } };
    if (this.options.failOn?.method === "mergePullRequest") {
      return { ok: false, error: this.options.failOn.error };
    }
    pr.status = "merged";
    return { ok: true, value: { merged: true, commit_hash: `mock-commit-${Date.now()}` } };
  }

  async getPullRequestStatus(ref: PRRef): Promise<Result<PRStatus>> {
    const pr = this.prs.get(ref.id);
    if (!pr) return { ok: false, error: { code: "NOT_FOUND", message: `PR ${ref.id} not found`, retryable: false } };
    return { ok: true, value: pr.status };
  }

  async triggerPipeline(repo: string, branch: string, pipelineName?: string): Promise<Result<PipelineRef>> {
    const id = `mock-pipeline-${this.nextId++}`;
    const ref: PipelineRef = { provider: "mock", id, url: `http://mock/pipelines/${id}` };
    this.pipelines.set(id, { ref, status: "running" });
    return { ok: true, value: ref };
  }

  async getPipelineStatus(ref: PipelineRef): Promise<Result<PipelineStatus>> {
    const pipeline = this.pipelines.get(ref.id);
    if (!pipeline) return { ok: false, error: { code: "NOT_FOUND", message: `Pipeline ${ref.id} not found`, retryable: false } };
    return { ok: true, value: pipeline.status };
  }

  async healthCheck(): Promise<Result<void>> {
    if (this.options.failOn?.method === "healthCheck") {
      return { ok: false, error: this.options.failOn.error };
    }
    return { ok: true, value: undefined };
  }

  /** Test helper: set pipeline status. */
  setPipelineStatus(id: string, status: PipelineStatus): void {
    const p = this.pipelines.get(id);
    if (p) p.status = status;
  }
}
