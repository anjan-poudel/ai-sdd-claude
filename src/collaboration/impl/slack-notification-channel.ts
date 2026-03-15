/**
 * SlackNotificationChannel — wraps SlackNotificationAdapter and adds:
 *  - ActivityMessage → rich Slack block formatting (emoji, bold title, body)
 *  - @mention resolution from MentionConfig (role handles → Slack <@USER_ID> format)
 *  - Delegates posting to NotificationAdapter.postNotification()
 *
 * Implements NotificationChannel.
 */

import type { NotificationChannel, ActivityMessage, MentionConfig } from "../adapters/notification-channel.ts";
import type { NotificationAdapter } from "../adapters/notification-adapter.ts";
import type { Result } from "../types.ts";

/** Maps ActivityEvent to a Slack-friendly emoji prefix. */
const EVENT_EMOJI: Record<string, string> = {
  workflow_started:           ":rocket:",
  workflow_completed:         ":white_check_mark:",
  task_started:               ":arrow_forward:",
  task_completed:             ":heavy_check_mark:",
  task_failed:                ":x:",
  task_needs_rework:          ":arrows_counterclockwise:",
  hil_requested:              ":pause_button:",
  hil_approved:               ":thumbsup:",
  hil_rejected:               ":thumbsdown:",
  document_published:         ":page_facing_up:",
  document_updated:           ":pencil2:",
  sync_completed:             ":twisted_rightwards_arrows:",
  async_approval_requested:   ":mailbox:",
  approval_received:          ":white_check_mark:",
  rejection_received:         ":no_entry:",
};

export class SlackNotificationChannel implements NotificationChannel {
  readonly provider = "slack";

  constructor(
    private readonly adapter: NotificationAdapter,
    private readonly channel: string,
    private readonly mentionConfig: MentionConfig = {},
  ) {}

  async publish(message: ActivityMessage): Promise<Result<void>> {
    const text = this.formatMessage(message);
    const result = await this.adapter.postNotification(this.channel, {
      task_id: message.task_id ?? message.workflow_id,
      title:   message.title,
      body:    text,
      ...(message.artifact_url !== undefined && { artifact_url: message.artifact_url }),
    });

    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  async healthCheck(): Promise<Result<void>> {
    return this.adapter.healthCheck();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private formatMessage(message: ActivityMessage): string {
    const emoji = EVENT_EMOJI[message.event] ?? ":information_source:";
    const lines: string[] = [
      `${emoji} *${message.title}*`,
    ];

    if (message.task_id) {
      lines.push(`Task: \`${message.task_id}\``);
    }

    if (message.body) {
      lines.push("", message.body);
    }

    if (message.artifact_url) {
      lines.push(``, `📎 <${message.artifact_url}|View artifact>`);
    }

    // Resolve mentions from config + pass-through raw handles
    const resolvedMentions = this.resolveMentions(message.mentions ?? []);
    if (resolvedMentions.length > 0) {
      lines.push("", `CC: ${resolvedMentions.join(" ")}`);
    }

    return lines.join("\n");
  }

  /**
   * Resolves mention strings:
   * - If it matches an agent role key in mentionConfig, expands to all configured handles.
   * - If it looks like a Slack user ID (Uxxxxxxxx), wraps as <@USER_ID>.
   * - Otherwise passes through as-is.
   */
  private resolveMentions(mentions: string[]): string[] {
    const resolved: string[] = [];
    for (const mention of mentions) {
      const roleHandles = this.mentionConfig[mention];
      if (roleHandles && roleHandles.length > 0) {
        // Role key → expand to configured Slack user IDs
        for (const handle of roleHandles) {
          resolved.push(this.formatHandle(handle));
        }
      } else {
        // Raw handle or user ID
        resolved.push(this.formatHandle(mention));
      }
    }
    return [...new Set(resolved)]; // deduplicate
  }

  /** Wrap a bare user ID as <@USER_ID> if not already formatted. */
  private formatHandle(handle: string): string {
    // Already formatted: <@U...> or @username
    if (handle.startsWith("<@") || handle.startsWith("@")) return handle;
    // Slack-style user ID: starts with U or W, followed by uppercase alphanumerics
    // Real IDs are 9+ chars (e.g. U01234567) but allow short IDs in tests too.
    if (/^[UW][A-Z0-9]+$/i.test(handle)) return `<@${handle}>`;
    return `@${handle}`;
  }
}
