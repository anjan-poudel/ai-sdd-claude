/**
 * NotificationChannel — provider-agnostic abstraction for workflow activity notifications.
 * Implementations: SlackNotificationChannel, MockNotificationChannel.
 *
 * ActivityMessage carries enough context so any channel can format it appropriately.
 * The `mentions` field carries provider-specific user handles (e.g. Slack user IDs,
 * Teams @mentions) — the channel resolves them from the MentionConfig if needed.
 */

import type { Result } from "../types.ts";

// ─── Activity Event Types ─────────────────────────────────────────────────────

export type ActivityEvent =
  | "workflow_started"
  | "workflow_completed"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_needs_rework"
  | "hil_requested"
  | "hil_approved"
  | "hil_rejected"
  | "document_published"
  | "document_updated"
  | "sync_completed"
  | "async_approval_requested"
  | "approval_received"
  | "rejection_received";

// ─── Activity Message ─────────────────────────────────────────────────────────

export interface ActivityMessage {
  event: ActivityEvent;
  workflow_id: string;
  task_id?: string;
  title: string;
  body: string;
  artifact_url?: string;
  /** Provider-specific user handles to @mention. Resolved by the channel impl. */
  mentions?: string[];
}

// ─── NotificationChannel Interface ────────────────────────────────────────────

export interface NotificationChannel {
  readonly provider: string;
  publish(message: ActivityMessage): Promise<Result<void>>;
  healthCheck(): Promise<Result<void>>;
}

// ─── Mention Config ───────────────────────────────────────────────────────────

/**
 * Maps agent roles to provider-specific user handles for @mentions.
 * Empty arrays mean no mentions for that role.
 */
export interface MentionConfig {
  ba?: string[];
  pe?: string[];
  le?: string[];
  dev?: string[];
  reviewer?: string[];
  [role: string]: string[] | undefined;
}
