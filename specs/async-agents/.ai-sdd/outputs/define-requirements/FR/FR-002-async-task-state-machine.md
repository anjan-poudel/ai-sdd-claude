# FR-002: Async Task State Machine

## Metadata
- **Area:** Workflow Engine
- **Priority:** MUST
- **Source:** constitution.md "State machine: orchestrator manages async lifecycle" / requirements.md "Orchestrator will maintain a state machine"

## Description
The orchestrator must implement a state machine for async tasks with the following states and transitions: AWAITING_APPROVAL, APPROVED, DOING, DONE. The state machine must enforce valid transitions only, reject invalid transitions with an error, and handle rejection loops (AWAITING_APPROVAL back to DOING for rework). The state machine must also handle timeouts on AWAITING_APPROVAL (configurable per task), concurrent approval signals from multiple stakeholders, and partial failures where an approval is received but the subsequent action fails.

## Acceptance criteria

```gherkin
Feature: Async task state machine

  Scenario: Happy path approval flow
    Given an async task in AWAITING_APPROVAL state
    When the required number of stakeholder approvals are received
    Then the task transitions to APPROVED state
    And immediately transitions to DOING state for the next phase of work

  Scenario: Rejection triggers rework
    Given an async task in AWAITING_APPROVAL state
    When a stakeholder rejects the task with feedback
    Then the task transitions back to DOING state
    And the rejection feedback is attached to the task context

  Scenario: Invalid transition is rejected
    Given an async task in DONE state
    When a transition to AWAITING_APPROVAL is attempted
    Then the engine raises a StateError
    And the task remains in DONE state

  Scenario: Timeout on awaiting approval
    Given an async task in AWAITING_APPROVAL state with a timeout of 3600 seconds
    When 3600 seconds elapse without sufficient approvals
    Then the task transitions to a timeout state
    And a notification is sent via Slack to the configured channel

  Scenario: Concurrent approvals are deduplicated
    Given an async task in AWAITING_APPROVAL state requiring 2 approvals
    When the same stakeholder sends 2 approval signals
    Then only 1 approval is counted
    And the task remains in AWAITING_APPROVAL until a second distinct stakeholder approves
```

## Related
- NFR: NFR-003 (State Transition Auditability)
- Depends on: FR-001
