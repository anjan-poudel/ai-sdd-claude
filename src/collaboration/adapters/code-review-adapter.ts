/**
 * CodeReviewAdapter interface — abstracts Bitbucket and GitHub PRs.
 * Implementations: BitbucketCodeReviewAdapter, GitHubCodeReviewAdapter, MockCodeReviewAdapter.
 */

import type { Result, PRRef, PipelineRef, CommentRef } from "../types.ts";

export type MergeStrategy = "merge" | "squash" | "fast-forward";
export type PRStatus = "open" | "merged" | "declined" | "superseded";
export type PipelineStatus = "pending" | "running" | "passed" | "failed" | "stopped";

export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  file_path?: string | undefined;
  line?: number | undefined;
  created_at: string;
}

export interface MergeResult {
  merged: boolean;
  commit_hash?: string;
  error?: string;
}

export interface CodeReviewAdapter {
  readonly provider: string;

  createPullRequest(repo: string, sourceBranch: string, targetBranch: string, title: string, description: string): Promise<Result<PRRef>>;
  getReviewComments(ref: PRRef, since?: string): Promise<Result<ReviewComment[]>>;
  postReviewComment(ref: PRRef, body: string, filePath?: string, line?: number): Promise<Result<CommentRef>>;
  approvePullRequest(ref: PRRef): Promise<Result<void>>;
  requestChanges(ref: PRRef, body: string): Promise<Result<void>>;
  mergePullRequest(ref: PRRef, strategy?: MergeStrategy): Promise<Result<MergeResult>>;
  getPullRequestStatus(ref: PRRef): Promise<Result<PRStatus>>;
  triggerPipeline(repo: string, branch: string, pipelineName?: string): Promise<Result<PipelineRef>>;
  getPipelineStatus(ref: PipelineRef): Promise<Result<PipelineStatus>>;
  healthCheck(): Promise<Result<void>>;
}
