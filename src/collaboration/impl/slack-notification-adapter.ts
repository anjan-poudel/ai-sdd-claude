/**
 * SlackNotificationAdapter — channel posting and polling listener for approval signals.
 * Uses Slack Web API. Implements NotificationAdapter.
 *
 * API usage:
 *   POST chat.postMessage     → postNotification
 *   GET  conversations.history → startListener (polling)
 *   POST auth.test            → healthCheck
 *
 * Signal parsing (regex):
 *   Approval: /^@ai-sdd\s+approve\s+([\w-]+)(?:\s+(.+))?$/i
 *   Rejection: /^@ai-sdd\s+reject\s+([\w-]+)\s+(.+)$/i
 */

import type {
  NotificationAdapter,
  NotificationMessage,
  RawSlackMessage,
  ListenerHandle,
  MessageHandler,
} from "../adapters/notification-adapter.ts";
import type { Result, MessageRef, ApprovalSignal, RejectionSignal } from "../types.ts";
import { RetryHttpClient } from "../infra/retry.ts";

const APPROVAL_REGEX = /^@ai-sdd\s+approve\s+([\w-]+)(?:\s+(.+))?$/i;
const REJECTION_REGEX = /^@ai-sdd\s+reject\s+([\w-]+)\s+(.+)$/i;

interface SlackPostMessageResponse {
  ok: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

interface SlackHistoryResponse {
  ok: boolean;
  messages?: RawSlackMessage[];
  error?: string;
}

interface SlackAuthTestResponse {
  ok: boolean;
  user?: string;
  error?: string;
}

export class SlackNotificationAdapter implements NotificationAdapter {
  readonly provider = "slack";

  private readonly client: RetryHttpClient;
  private readonly baseUrl = "https://slack.com/api";

  constructor(
    private readonly token: string,
    private readonly pollIntervalSeconds: number = 5,
    private readonly requestTimeoutMs: number = 3000,
  ) {
    this.client = new RetryHttpClient(
      {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      { timeoutMs: requestTimeoutMs },
    );
  }

  async postNotification(channel: string, message: NotificationMessage): Promise<Result<MessageRef>> {
    const text = this.formatMessage(message);
    const result = await this.client.post<SlackPostMessageResponse>(
      `${this.baseUrl}/chat.postMessage`,
      { channel, text },
    );

    if (!result.ok) return result;

    if (!result.value.ok) {
      return {
        ok: false,
        error: {
          code: result.value.error === "not_authed" || result.value.error === "invalid_auth" ? "AUTH" : "UNKNOWN",
          message: `Slack API error: ${result.value.error}`,
          retryable: false,
        },
      };
    }

    return {
      ok: true,
      value: {
        provider: "slack",
        id: result.value.ts ?? "",
        channel,
        timestamp: result.value.ts ?? new Date().toISOString(),
      },
    };
  }

  async startListener(channel: string, handler: MessageHandler): Promise<Result<ListenerHandle>> {
    // High-water mark — start from "now" to avoid replaying old messages.
    let oldestTs = (Date.now() / 1000).toFixed(6);

    const intervalHandle = setInterval(async () => {
      const historyResult = await this.client.get<SlackHistoryResponse>(
        `${this.baseUrl}/conversations.history?channel=${encodeURIComponent(channel)}&oldest=${oldestTs}&limit=50`,
      );

      if (!historyResult.ok) {
        console.warn(`[SlackAdapter] Polling error: ${historyResult.error.message}`);
        return;
      }

      const response = historyResult.value;
      if (!response.ok) {
        console.warn(`[SlackAdapter] Slack API error during polling: ${response.error}`);
        return;
      }

      const messages = response.messages ?? [];
      // Messages come newest-first; process oldest first.
      const sorted = [...messages].reverse();

      for (const msg of sorted) {
        if (!msg.ts || msg.ts <= oldestTs) continue;
        oldestTs = msg.ts;

        const approval = this.parseApprovalSignal(msg);
        if (approval) {
          handler(approval);
          continue;
        }
        const rejection = this.parseRejectionSignal(msg);
        if (rejection) {
          handler(rejection);
          continue;
        }
        // Non-matching messages logged at DEBUG.
        console.debug(`[SlackAdapter] Unrecognized message ts=${msg.ts}: ${msg.text?.slice(0, 80)}`);
      }
    }, this.pollIntervalSeconds * 1000);

    const id = `slack-listener-${channel}-${Date.now()}`;
    const handle: ListenerHandle = {
      id,
      stop: async () => { clearInterval(intervalHandle); },
    };

    return { ok: true, value: handle };
  }

  async stopListener(handle: ListenerHandle): Promise<void> {
    await handle.stop();
  }

  parseApprovalSignal(raw: RawSlackMessage): ApprovalSignal | null {
    const text = raw.text ?? "";
    const match = text.match(APPROVAL_REGEX);
    if (!match) return null;
    const signal: ApprovalSignal = {
      // Slack user ID is from the API response, not from user-supplied text (prevents spoofing).
      stakeholder_id: raw.user ?? "unknown",
      timestamp: raw.ts ? new Date(parseFloat(raw.ts) * 1000).toISOString() : new Date().toISOString(),
      source: `slack:${raw.channel ?? "unknown"}/${raw.ts ?? "0"}`,
    };
    const notesRaw = match[2];
    const notes = notesRaw?.trim();
    if (notes !== undefined && notes !== "") signal.notes = notes;
    return signal;
  }

  parseRejectionSignal(raw: RawSlackMessage): RejectionSignal | null {
    const text = raw.text ?? "";
    const match = text.match(REJECTION_REGEX);
    if (!match) return null;
    const feedbackRaw = match[2];
    if (!feedbackRaw) return null;
    return {
      stakeholder_id: raw.user ?? "unknown",
      timestamp: raw.ts ? new Date(parseFloat(raw.ts) * 1000).toISOString() : new Date().toISOString(),
      source: `slack:${raw.channel ?? "unknown"}/${raw.ts ?? "0"}`,
      feedback: feedbackRaw.trim(),
    };
  }

  async healthCheck(): Promise<Result<void>> {
    const result = await this.client.post<SlackAuthTestResponse>(`${this.baseUrl}/auth.test`, {});

    if (!result.ok) return result;

    if (!result.value.ok) {
      return {
        ok: false,
        error: {
          code: "AUTH",
          message: `Slack auth.test failed: ${result.value.error}`,
          retryable: false,
        },
      };
    }

    return { ok: true, value: undefined };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private formatMessage(message: NotificationMessage): string {
    const lines = [
      `*[ai-sdd] ${message.title}*`,
      `Task: \`${message.task_id}\``,
    ];

    if (message.artifact_url) {
      lines.push(`Artifact: ${message.artifact_url}`);
    }

    if (message.body) {
      lines.push("", message.body);
    }

    if (message.action_hints) {
      lines.push(
        "",
        "To approve: `" + message.action_hints.approve_cmd + "`",
        "To reject:  `" + message.action_hints.reject_cmd + "`",
      );
    }

    return lines.join("\n");
  }
}
