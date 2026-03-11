# T-010: Slack Polling Listener and Signal Parsing

## Metadata
- **Group:** [TG-03 -- Slack Integration](index.md)
- **Component:** SlackNotificationAdapter (listener subsystem)
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** [T-009](T-009-slack-notification-adapter.md)
- **Blocks:** T-011, T-026
- **Requirements:** [FR-005](../../../define-requirements/FR/FR-005-slack-approval-signal-listener.md)

## Description
Implement the Slack polling listener that calls `conversations.history` at a configurable interval (default 5s), parses messages for approval/rejection signals using regex patterns, and dispatches matched signals to the registered handler. Tracks a high-water mark `ts` to avoid reprocessing messages.

## Acceptance criteria

```gherkin
Feature: Slack polling listener and signal parsing

  Scenario: Approval signal detected and dispatched
    Given the listener is running on channel "#ai-sdd-workflow"
    When a message "@ai-sdd approve define-requirements looks good" appears
    Then an ApprovalSignal is created with stakeholder_id from Slack user
    And the handler callback is invoked with the signal

  Scenario: Rejection signal detected with required feedback
    Given the listener is running
    When a message "@ai-sdd reject define-requirements needs more detail on FR-003" appears
    Then a RejectionSignal is created with feedback = "needs more detail on FR-003"
    And the handler callback is invoked

  Scenario: Non-matching messages are silently ignored
    Given the listener is running
    When a message "hello team" appears
    Then no signal is dispatched
    And the message is logged at DEBUG level
```

## Implementation notes
- Polling via `setInterval` at `poll_interval_seconds` (from config)
- Regex patterns from L2: `/^@ai-sdd\s+approve\s+([\w-]+)(?:\s+(.+))?$/i` and `/^@ai-sdd\s+reject\s+([\w-]+)\s+(.+)$/i`
- `stakeholder_id` extracted from Slack API response `user` field (not user-supplied text) -- prevents signal spoofing
- `ts` high-water mark stored in memory; on restart, re-read from persisted state
- `stopListener` clears the interval and resolves

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Spoofing test: user ID comes from API response, not message text
- [ ] Polling interval configurable and under 10s default (NFR-004)
