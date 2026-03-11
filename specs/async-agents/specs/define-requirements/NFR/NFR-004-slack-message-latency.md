# NFR-004: Slack Message Latency

## Metadata
- **Category:** Performance
- **Priority:** MUST

## Description
Slack notification messages triggered by state transitions or agent actions must be delivered to the Slack API within 5 seconds of the triggering event (measured from the moment the engine decides to send a notification to the moment the Slack API returns a success response). The Slack listener must detect new messages in the monitored channel within 10 seconds of the message being posted (polling interval or WebSocket latency). End-to-end latency from a stakeholder posting an approval message to the orchestrator receiving the parsed signal must not exceed 15 seconds under normal operating conditions. These thresholds apply when the Slack API is responsive (HTTP 200 within 3 seconds).

## Acceptance criteria

```gherkin
Feature: Slack message latency

  Scenario: Outbound notification delivered within 5 seconds
    Given the Slack API is responsive (HTTP 200 within 3 seconds)
    When an async task transitions to AWAITING_APPROVAL
    Then the Slack notification API call completes within 5 seconds of the transition event

  Scenario: Inbound message detected within 10 seconds
    Given the Slack listener is active on the configured channel
    When a stakeholder posts a message at time T
    Then the listener detects and parses the message by time T + 10 seconds

  Scenario: End-to-end approval signal within 15 seconds
    Given a stakeholder posts an approval message at time T
    And the Slack API is responsive
    When the approval is parsed and forwarded to the orchestrator
    Then the orchestrator receives the approval signal by time T + 15 seconds
```

## Related
- FR: FR-004, FR-005
