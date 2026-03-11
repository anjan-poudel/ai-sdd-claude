# T-011: Slack Integration Tests with API Fixtures

## Metadata
- **Group:** [TG-03 -- Slack Integration](index.md)
- **Component:** SlackNotificationAdapter (test suite)
- **Agent:** dev
- **Effort:** M
- **Risk:** LOW
- **Depends on:** [T-010](T-010-slack-polling-listener.md)
- **Blocks:** --
- **Requirements:** [NFR-004](../../../define-requirements/NFR/NFR-004-slack-message-latency.md)

## Description
Write integration tests for the SlackNotificationAdapter using captured Slack API response fixtures. Tests cover postNotification response parsing, conversations.history polling with message fixtures, signal parsing edge cases, and error handling (rate limits, auth failures). Validates dev standard #4 (external schema fixtures).

## Acceptance criteria

```gherkin
Feature: Slack integration tests with API fixtures

  Scenario: Tests validate against real Slack API response format
    Given captured fixtures in tests/fixtures/slack/
    When the adapter parses a conversations-history fixture
    Then messages are correctly extracted and parsed
    And the fixture format matches the actual Slack API schema
```

## Implementation notes
- Fixture files: `tests/fixtures/slack/conversations-history.json`, `auth-test.json`, `chat-post-message.json`
- Test file: `tests/collaboration/adapters/impl/slack.test.ts`
- Shared adapter test suite in `tests/collaboration/adapters/notification-adapter.suite.ts` runs against both Mock and Slack (with intercepted HTTP)
- Use Bun's fetch mock or a local HTTP interceptor (no real Slack calls in CI)

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Fixtures captured from real Slack API responses
- [ ] Shared suite passes for both MockNotificationAdapter and SlackNotificationAdapter
