# TG-03: Slack Integration

> **Jira Epic:** Slack Integration

## Description
Implements the SlackNotificationAdapter for channel posting and the Slack polling listener for approval/rejection signal detection. Includes integration tests against captured Slack API fixtures. This is the primary coordination bus for the async workflow.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-009](T-009-slack-notification-adapter.md) | SlackNotificationAdapter -- Channel Posting | M | T-005, T-006 | MEDIUM |
| [T-010](T-010-slack-polling-listener.md) | Slack Polling Listener and Signal Parsing | L | T-009 | HIGH |
| [T-011](T-011-slack-integration-tests.md) | Slack Integration Tests with API Fixtures | M | T-010 | LOW |

## Group effort estimate
- Optimistic (full parallel): 2 days
- Realistic (2 devs): 3 days
