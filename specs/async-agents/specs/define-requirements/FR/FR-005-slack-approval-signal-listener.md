# FR-005: Slack Approval Signal Listener

## Metadata
- **Area:** Slack Integration
- **Priority:** MUST
- **Source:** requirements.md "Orchestrator will wait until it gets approval signals from stakeholders" / constitution.md "Configurable stakeholder sign-off"

## Description
The system must provide a Slack listener that monitors a configured channel for approval and rejection signals from stakeholders. The listener must parse structured approval messages (or reactions/commands) to extract: the task ID being approved/rejected, the stakeholder identity, and optional feedback notes. Parsed signals must be forwarded to the orchestrator's state machine to trigger the appropriate state transition. The listener must run continuously while the engine is active and must not poll more frequently than the configured interval.

## Acceptance criteria

```gherkin
Feature: Slack approval signal listener

  Scenario: Stakeholder approval is parsed and forwarded
    Given the Slack listener is active on a configured channel
    And an async task "define-requirements" is in AWAITING_APPROVAL state
    When a stakeholder posts an approval message referencing task "define-requirements"
    Then the listener parses the approval signal
    And forwards it to the orchestrator with the stakeholder identity and task ID

  Scenario: Rejection with feedback is captured
    Given the Slack listener is active
    And an async task is in AWAITING_APPROVAL state
    When a stakeholder posts a rejection message with feedback text
    Then the listener parses the rejection signal and feedback
    And the feedback is attached to the task context for the rework cycle

  Scenario: Malformed message is ignored gracefully
    Given the Slack listener is active
    When a message is posted that does not match the approval/rejection format
    Then the listener ignores the message
    And no state transition is attempted
    And a debug-level log entry is recorded
```

## Related
- NFR: NFR-004 (Slack Message Latency), NFR-005 (External API Retry)
- Depends on: FR-002, FR-004
