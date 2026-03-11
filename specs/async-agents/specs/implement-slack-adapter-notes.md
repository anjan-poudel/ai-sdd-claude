---
description: Slack notification adapter implementation — polling-based listener, approval/rejection signal parsing, mock test double, and fixture-based tests.
---

# Implementation Notes: Slack Notification Adapter

## Summary

Implemented the Slack notification adapter (real + mock) for async approval workflows.

## Files Created

- `src/collaboration/impl/slack-notification-adapter.ts` — Real Slack adapter using `conversations.history` API with polling. Parses `@ai-sdd approve <task-id> [notes]` and `@ai-sdd reject <task-id> <reason>` commands via regex. Stakeholder ID extracted from API `.user` field (not from parsed text) to prevent spoofing.
- `src/collaboration/impl/mock-notification-adapter.ts` — In-memory test double with `simulateMessage()` helper, `failOn` and `latencyMs` injection options.

## Testing

Tests in `tests/collaboration/adapters/impl/slack.test.ts`:
- Signal parsing (approval with/without notes, rejection, case-insensitivity)
- Fixture-based validation against `tests/fixtures/slack/conversations-history.json`
- Stakeholder ID extraction from `.user` field
- ISO 8601 timestamp conversion from Slack `ts` format

## Key Design Decisions

- High-water mark `oldestTs` is initialized to "now" on adapter startup, preventing replay of historical messages on first poll.
- Poll interval configurable via constructor options (default 5s).
- `notes` field on ApprovalSignal uses conditional assignment to be `exactOptionalPropertyTypes`-safe.
- Rejection requires non-empty feedback text; `@ai-sdd reject task-id` (no feedback) returns null.
