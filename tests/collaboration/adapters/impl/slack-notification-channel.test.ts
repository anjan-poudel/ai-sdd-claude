/**
 * SlackNotificationChannel unit tests.
 *
 * Verifies:
 *  - ActivityMessage → Slack text formatting (emoji, title, body)
 *  - @mention substitution (role keys → handles, raw user IDs, already formatted)
 *  - Event emoji mapping
 *  - publish() delegates to NotificationAdapter.postNotification()
 *  - healthCheck() delegates to adapter
 *  - publish() returns ok:false when adapter fails
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { MockNotificationAdapter } from "../../../../src/collaboration/impl/mock-notification-adapter.ts";
import { SlackNotificationChannel } from "../../../../src/collaboration/impl/slack-notification-channel.ts";
import type { ActivityMessage } from "../../../../src/collaboration/adapters/notification-channel.ts";

describe("SlackNotificationChannel", () => {
  let mockAdapter: MockNotificationAdapter;
  let channel: SlackNotificationChannel;

  beforeEach(() => {
    mockAdapter = new MockNotificationAdapter();
    channel = new SlackNotificationChannel(mockAdapter, "ai-sdd", {
      ba: ["U001"],
      pe: ["U002"],
      reviewer: ["U003", "U004"],
    });
  });

  it("posts to the configured Slack channel", async () => {
    const msg: ActivityMessage = {
      event: "task_completed",
      workflow_id: "wf-test",
      task_id: "define-requirements",
      title: "Task completed: define-requirements",
      body: "Workflow: wf-test | Status: COMPLETED",
    };

    const result = await channel.publish(msg);
    expect(result.ok).toBe(true);
    expect(mockAdapter.calls).toHaveLength(1);
    expect(mockAdapter.calls[0]!.method).toBe("postNotification");
    const [calledChannel] = mockAdapter.calls[0]!.args as [string, ...unknown[]];
    expect(calledChannel).toBe("ai-sdd");
  });

  it("includes emoji prefix for known events", async () => {
    const testCases: Array<[ActivityMessage["event"], string]> = [
      ["workflow_started",   ":rocket:"],
      ["workflow_completed", ":white_check_mark:"],
      ["task_started",       ":arrow_forward:"],
      ["task_completed",     ":heavy_check_mark:"],
      ["task_failed",        ":x:"],
      ["task_needs_rework",  ":arrows_counterclockwise:"],
      ["hil_requested",      ":pause_button:"],
    ];

    for (const [event, emoji] of testCases) {
      mockAdapter.calls = [];
      await channel.publish({
        event,
        workflow_id: "wf",
        title: "test",
        body: "",
      });
      const [, posted] = mockAdapter.calls[0]!.args as [string, { body: string }];
      expect(posted.body).toContain(emoji);
    }
  });

  it("includes task_id in formatted message when provided", async () => {
    await channel.publish({
      event: "task_completed",
      workflow_id: "wf",
      task_id: "design-l1",
      title: "done",
      body: "details",
    });
    const [, posted] = mockAdapter.calls[0]!.args as [string, { body: string }];
    expect(posted.body).toContain("`design-l1`");
  });

  it("includes artifact_url as a link when provided", async () => {
    await channel.publish({
      event: "document_published",
      workflow_id: "wf",
      title: "Published",
      body: "",
      artifact_url: "https://confluence.example.com/page/123",
    });
    const [, posted] = mockAdapter.calls[0]!.args as [string, { body: string }];
    expect(posted.body).toContain("https://confluence.example.com/page/123");
  });

  describe("mention resolution", () => {
    it("expands role keys to configured Slack user IDs", async () => {
      await channel.publish({
        event: "hil_requested",
        workflow_id: "wf",
        title: "Review required",
        body: "",
        mentions: ["reviewer"],
      });
      const [, posted] = mockAdapter.calls[0]!.args as [string, { body: string }];
      expect(posted.body).toContain("<@U003>");
      expect(posted.body).toContain("<@U004>");
    });

    it("wraps bare Slack user IDs as <@USER_ID>", async () => {
      await channel.publish({
        event: "task_completed",
        workflow_id: "wf",
        title: "done",
        body: "",
        mentions: ["U005"],
      });
      const [, posted] = mockAdapter.calls[0]!.args as [string, { body: string }];
      expect(posted.body).toContain("<@U005>");
    });

    it("passes through already-formatted <@...> handles unchanged", async () => {
      await channel.publish({
        event: "task_completed",
        workflow_id: "wf",
        title: "done",
        body: "",
        mentions: ["<@U999>"],
      });
      const [, posted] = mockAdapter.calls[0]!.args as [string, { body: string }];
      expect(posted.body).toContain("<@U999>");
    });

    it("deduplicates mentions", async () => {
      await channel.publish({
        event: "task_completed",
        workflow_id: "wf",
        title: "done",
        body: "",
        mentions: ["ba", "ba", "U001"],
      });
      const [, posted] = mockAdapter.calls[0]!.args as [string, { body: string }];
      const count = (posted.body.match(/<@U001>/g) ?? []).length;
      expect(count).toBe(1);
    });

    it("no CC line when mentions is empty", async () => {
      await channel.publish({
        event: "task_completed",
        workflow_id: "wf",
        title: "done",
        body: "",
        mentions: [],
      });
      const [, posted] = mockAdapter.calls[0]!.args as [string, { body: string }];
      expect(posted.body).not.toContain("CC:");
    });
  });

  it("returns ok:false when adapter fails", async () => {
    mockAdapter = new MockNotificationAdapter({
      failOn: {
        method: "postNotification",
        error: { code: "AUTH", message: "invalid token", retryable: false },
      },
    });
    channel = new SlackNotificationChannel(mockAdapter, "ai-sdd");

    const result = await channel.publish({
      event: "task_completed",
      workflow_id: "wf",
      title: "done",
      body: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AUTH");
    }
  });

  it("healthCheck() delegates to adapter", async () => {
    const result = await channel.healthCheck();
    expect(result.ok).toBe(true);
    expect(mockAdapter.calls.some(c => c.method === "healthCheck")).toBe(true);
  });
});
