/**
 * NotificationAdapter interface — abstracts Slack (and future notification providers).
 * Implementations: SlackNotificationAdapter, MockNotificationAdapter.
 */

import type { Result, MessageRef, ApprovalSignal, RejectionSignal } from "../types.ts";

export interface NotificationMessage {
  task_id: string;
  title: string;
  body: string;
  action_hints?: { approve_cmd: string; reject_cmd: string };
  artifact_url?: string;
}

/** Raw Slack message shape — adapter implementations parse this. */
export interface RawSlackMessage {
  type: string;
  text?: string;
  user?: string;
  ts?: string;
  channel?: string;
  [key: string]: unknown;
}

export type MessageHandler = (signal: ApprovalSignal | RejectionSignal) => void;

export interface ListenerHandle {
  id: string;
  stop: () => Promise<void>;
}

export interface NotificationAdapter {
  readonly provider: string;

  postNotification(channel: string, message: NotificationMessage): Promise<Result<MessageRef>>;
  startListener(channel: string, handler: MessageHandler): Promise<Result<ListenerHandle>>;
  stopListener(handle: ListenerHandle): Promise<void>;
  parseApprovalSignal(raw: RawSlackMessage): ApprovalSignal | null;
  parseRejectionSignal(raw: RawSlackMessage): RejectionSignal | null;
  healthCheck(): Promise<Result<void>>;
}
