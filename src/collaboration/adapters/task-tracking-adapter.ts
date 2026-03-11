/**
 * TaskTrackingAdapter interface — abstracts Jira and GitHub Issues.
 * Implementations: JiraTaskTrackingAdapter, GitHubTaskTrackingAdapter, MockTaskTrackingAdapter.
 */

import type { Result, IssueRef } from "../types.ts";

export interface TaskFields {
  key: string;
  summary: string;
  description: string;
  status: string;
  issue_type: string;
  labels: string[];
  assignee?: string | undefined;
  parent_key?: string | undefined;       // epic key
  custom_fields?: Record<string, unknown> | undefined;
}

export interface Transition {
  id: string;
  name: string;
  to_status: string;
}

export interface TaskTrackingAdapter {
  readonly provider: string;

  createEpic(project: string, summary: string, description: string, labels?: string[]): Promise<Result<IssueRef>>;
  createTask(project: string, epicRef: IssueRef | null, summary: string, description: string, metadata?: Partial<TaskFields>): Promise<Result<IssueRef>>;
  updateTask(ref: IssueRef, fields: Partial<TaskFields>): Promise<Result<IssueRef>>;
  transitionTask(ref: IssueRef, targetStatus: string): Promise<Result<void>>;
  getTask(ref: IssueRef): Promise<Result<TaskFields>>;
  listTasks(project: string, filter?: { labels?: string[]; status?: string }): Promise<Result<TaskFields[]>>;
  addLabel(ref: IssueRef, label: string): Promise<Result<void>>;
  getAvailableTransitions(ref: IssueRef): Promise<Result<Transition[]>>;
  healthCheck(): Promise<Result<void>>;
}
