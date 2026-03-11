# T-009: SlackNotificationAdapter -- Channel Posting

## Metadata
- **Group:** [TG-03 -- Slack Integration](index.md)
- **Component:** SlackNotificationAdapter
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-005](../TG-02-adapter-framework/T-005-adapter-interfaces.md), [T-006](../TG-02-adapter-framework/T-006-retry-middleware.md)
- **Blocks:** T-010, T-011, T-026
- **Requirements:** [FR-004](../../../define-requirements/FR/FR-004-slack-channel-notification.md)

## Description
Implement the SlackNotificationAdapter for posting structured notifications to Slack channels via `chat.postMessage`. Uses CollabHttpClient for HTTP calls with retry. Outbound messages include task ID, agent name, artifact URL, and copy-paste approve/reject commands. Health check via `auth.test`.

## Acceptance criteria

```gherkin
Feature: SlackNotificationAdapter channel posting

  Scenario: Post notification to Slack channel
    Given a valid SLACK_BOT_TOKEN is configured
    When postNotification is called with a channel and message
    Then chat.postMessage is called with the correct channel and formatted text
    And a MessageRef is returned with provider = "slack"

  Scenario: Health check validates bot token
    Given a valid SLACK_BOT_TOKEN
    When healthCheck is called
    Then auth.test is called and Result ok = true is returned
```

## Implementation notes
- File: `src/collaboration/adapters/slack/notification-adapter.ts`
- Uses CollabHttpClient with 3s timeout (NFR-004)
- Message format: plain text with task ID, title, body, approve/reject commands -- no Block Kit
- API base URL: `https://slack.com/api/`
- Auth header: `Authorization: Bearer ${SLACK_BOT_TOKEN}`

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Tests use captured Slack API fixtures (dev standard #4)
- [ ] No credentials in log output
