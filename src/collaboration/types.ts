/**
 * Shared types for the collaboration layer.
 * All adapters return Result<T, AdapterError> to make error handling explicit.
 * Ref types are opaque — callers never inspect vendor-specific IDs.
 */

// ─── Result Type ─────────────────────────────────────────────────────────────

export type Result<T, E = AdapterError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// ─── Error Type ──────────────────────────────────────────────────────────────

export interface AdapterError {
  code: "AUTH" | "RATE_LIMIT" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "NETWORK" | "UNKNOWN";
  message: string;
  retryable: boolean;
  cause?: unknown;
}

// ─── Ref Types (opaque vendor-agnostic references) ───────────────────────────

export interface MessageRef {
  provider: string;
  id: string;
  channel: string;
  timestamp: string;
}

export interface PageRef {
  provider: string;
  id: string;
  url: string;
  version: number;
}

export interface IssueRef {
  provider: string;
  key: string;
  id: string;
  url: string;
}

export interface PRRef {
  provider: string;
  id: string;
  url: string;
  repo: string;
}

export interface PipelineRef {
  provider: string;
  id: string;
  url: string;
}

export interface CommentRef {
  provider: string;
  id: string;
}

// ─── Signal Types ─────────────────────────────────────────────────────────────

export interface ApprovalSignal {
  stakeholder_id: string;
  timestamp: string;       // ISO 8601
  source: string;          // "slack:<channel>/<ts>"
  notes?: string | undefined;
}

export interface RejectionSignal {
  stakeholder_id: string;
  timestamp: string;
  source: string;
  feedback: string;        // required
}

// ─── Event Types ─────────────────────────────────────────────────────────────

export type CollaborationEventType =
  | "collab.approval.received"
  | "collab.rejection.received"
  | "collab.comment.posted"
  | "collab.page.created"
  | "collab.page.updated"
  | "collab.pr.created"
  | "collab.pr.merged"
  | "collab.pr.comment"
  | "collab.pipeline.completed"
  | "collab.sync.completed"
  | "collab.timeout.expired"
  | "async.cycle.started"
  | "async.approval.received"
  | "async.rejection.received"
  | "async.threshold.met"
  | "async.timeout.expired"
  | "collab.api.request"
  | "collab.api.retry"
  | "collab.sync.completed";

export interface CollaborationEvent {
  type: CollaborationEventType;
  task_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ─── Async Task Types ─────────────────────────────────────────────────────────

export interface AsyncTaskConfig {
  mode: "sync" | "async";
  min_approvals: number;            // default 1
  approval_timeout_seconds: number; // default 0 (no timeout)
}

export interface AsyncTaskState {
  async_phase: number;              // current approval cycle (1, 2, 3...)
  approval_signals: ApprovalSignal[];
  rejection_signals: RejectionSignal[];
  collaboration_refs: CollaborationRefs;
  approval_timeout_at?: string;     // ISO 8601 deadline
}

export interface CollaborationRefs {
  slack_message_ts?: string;
  confluence_page_id?: string;
  jira_issue_key?: string;
  pr_id?: string;
  pipeline_run_id?: string;
}

export interface ApprovalStatus {
  task_id: string;
  phase: number;
  received: number;
  required: number;
  stakeholders: string[];
  threshold_met: boolean;
}

export interface ApprovalResult {
  accepted: boolean;           // false if duplicate
  approval_status: ApprovalStatus;
  triggered_transition?: "APPROVED" | null;
}

export interface RejectionResult {
  accepted: boolean;
  feedback: string;
  triggered_transition: "DOING";
}

// ─── Sync Engine Types ────────────────────────────────────────────────────────

export interface TaskToIssueMapping {
  task_id: string;
  issue_key: string;
  issue_type: string;
  content_hash: string;        // "sha256:<hex>"
  created_at: string;
  updated_at: string;
  orphaned: boolean;
}

export interface SyncMappingFile {
  schema_version: "1";
  adapter_type: string;
  project_key: string;
  synced_at: string;
  mappings: TaskToIssueMapping[];
}

export interface SyncReport {
  created: number;
  updated: number;
  orphaned: number;
  unchanged: number;
  errors: Array<{ task_id: string; error: AdapterError }>;
}

// ─── Adapter Config Types ─────────────────────────────────────────────────────

export interface CollaborationAdaptersConfig {
  notification: "slack" | "mock";
  document: "confluence" | "mock";
  task_tracking: "jira" | "github" | "mock";
  code_review: "bitbucket" | "github" | "mock";
}

// ─── NotificationChannel re-exports ──────────────────────────────────────────

export type {
  ActivityEvent,
  ActivityMessage,
  NotificationChannel,
  MentionConfig,
} from "./adapters/notification-channel.ts";
