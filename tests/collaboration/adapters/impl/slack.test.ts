/**
 * Slack adapter tests — signal parsing and fixture-based validation (Dev Standard #4).
 * Tests validate adapter response parsing against captured API fixtures.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { SlackNotificationAdapter } from "../../../../src/collaboration/impl/slack-notification-adapter.ts";
import type { RawSlackMessage } from "../../../../src/collaboration/adapters/notification-adapter.ts";

const FIXTURES_DIR = join(import.meta.dir, "../../../fixtures/slack");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));
}

describe("SlackNotificationAdapter", () => {
  // Token is not used in parsing tests — no HTTP calls made.
  const adapter = new SlackNotificationAdapter("xoxb-test-token");

  describe("parseApprovalSignal", () => {
    it("parses approval message with task ID and notes", () => {
      const raw: RawSlackMessage = {
        type: "message",
        text: "@ai-sdd approve design-l1 looks good",
        user: "U01ABCDEFG",
        ts: "1710151200.001",
        channel: "C01ABC123",
      };
      const signal = adapter.parseApprovalSignal(raw);
      expect(signal).not.toBeNull();
      expect(signal!.stakeholder_id).toBe("U01ABCDEFG"); // from API, not text
      expect(signal!.notes).toBe("looks good");
      expect(signal!.source).toBe("slack:C01ABC123/1710151200.001");
    });

    it("parses approval message without notes", () => {
      const raw: RawSlackMessage = {
        type: "message",
        text: "@ai-sdd approve implement-async-engine",
        user: "U04DEFGHIJ",
        ts: "1710151500.004",
        channel: "C01ABC123",
      };
      const signal = adapter.parseApprovalSignal(raw);
      expect(signal).not.toBeNull();
      expect(signal!.notes).toBeUndefined();
    });

    it("returns null for non-approval messages", () => {
      const raw: RawSlackMessage = {
        type: "message",
        text: "This is a regular message",
        user: "U03CDEFGHI",
        ts: "1710151400.003",
        channel: "C01ABC123",
      };
      expect(adapter.parseApprovalSignal(raw)).toBeNull();
    });

    it("returns null for rejection messages", () => {
      const raw: RawSlackMessage = {
        type: "message",
        text: "@ai-sdd reject design-l1 needs more detail",
        user: "U02BCDEFGH",
        ts: "1710151300.002",
        channel: "C01ABC123",
      };
      expect(adapter.parseApprovalSignal(raw)).toBeNull();
    });

    it("is case-insensitive", () => {
      const raw: RawSlackMessage = {
        type: "message",
        text: "@AI-SDD APPROVE task-id",
        user: "U01ABCDEFG",
        ts: "1234567890.001",
        channel: "C01ABC123",
      };
      const signal = adapter.parseApprovalSignal(raw);
      expect(signal).not.toBeNull();
    });
  });

  describe("parseRejectionSignal", () => {
    it("parses rejection message with feedback", () => {
      const raw: RawSlackMessage = {
        type: "message",
        text: "@ai-sdd reject design-l1 needs more detail on the state machine",
        user: "U02BCDEFGH",
        ts: "1710151300.002",
        channel: "C01ABC123",
      };
      const signal = adapter.parseRejectionSignal(raw);
      expect(signal).not.toBeNull();
      expect(signal!.stakeholder_id).toBe("U02BCDEFGH");
      expect(signal!.feedback).toBe("needs more detail on the state machine");
    });

    it("returns null when feedback is missing", () => {
      const raw: RawSlackMessage = {
        type: "message",
        text: "@ai-sdd reject task-id",  // no feedback
        user: "U01ABCDEFG",
        ts: "1234567890.001",
        channel: "C01ABC123",
      };
      expect(adapter.parseRejectionSignal(raw)).toBeNull();
    });

    it("returns null for approval messages", () => {
      const raw: RawSlackMessage = {
        type: "message",
        text: "@ai-sdd approve design-l1",
        user: "U01ABCDEFG",
        ts: "1234567890.001",
        channel: "C01ABC123",
      };
      expect(adapter.parseRejectionSignal(raw)).toBeNull();
    });
  });

  describe("fixture-based parsing (Dev Standard #4)", () => {
    it("parses all messages from captured conversations.history fixture", () => {
      const fixture = loadFixture("conversations-history.json") as {
        ok: boolean;
        messages: RawSlackMessage[];
      };

      expect(fixture.ok).toBe(true);
      expect(fixture.messages).toHaveLength(4);

      const approvals = fixture.messages
        .map(m => adapter.parseApprovalSignal(m))
        .filter(Boolean);
      const rejections = fixture.messages
        .map(m => adapter.parseRejectionSignal(m))
        .filter(Boolean);

      expect(approvals).toHaveLength(2); // "approve design-l1" + "approve implement-async-engine"
      expect(rejections).toHaveLength(1); // "reject design-l1"
    });

    it("extracts stakeholder_id from user field, not text", () => {
      const fixture = loadFixture("conversations-history.json") as {
        ok: boolean;
        messages: RawSlackMessage[];
      };

      const firstMessage = fixture.messages[0];
      expect(firstMessage).toBeDefined();
      if (!firstMessage) return;
      const firstApproval = adapter.parseApprovalSignal(firstMessage);
      expect(firstApproval!.stakeholder_id).toBe("U01ABCDEFG"); // from .user, not text
    });

    it("timestamps are ISO 8601 converted from Slack ts", () => {
      const fixture = loadFixture("conversations-history.json") as {
        ok: boolean;
        messages: RawSlackMessage[];
      };

      const firstMessage = fixture.messages[0];
      expect(firstMessage).toBeDefined();
      if (!firstMessage) return;
      const signal = adapter.parseApprovalSignal(firstMessage);
      expect(signal!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
