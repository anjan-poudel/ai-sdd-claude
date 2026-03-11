# NFR-003: State Transition Auditability

## Metadata
- **Category:** Compliance
- **Priority:** MUST

## Description
Every state transition in the async task state machine must be recorded in an append-only audit log. Each audit entry must include: (1) timestamp in ISO 8601 format with millisecond precision, (2) task ID, (3) previous state, (4) new state, (5) actor identity (agent name or stakeholder ID), (6) trigger source (Slack message ID, API call ID, or "engine"), and (7) optional metadata (approval count, rejection reason). The audit log must be queryable by task ID and by time range. The log must retain all entries for the lifetime of the workflow session -- no entries may be deleted or overwritten. The audit log must contain 100% of state transitions with zero gaps.

## Acceptance criteria

```gherkin
Feature: State transition auditability

  Scenario: Every state transition is logged with required fields
    Given an async task that transitions through 4 states: PENDING -> DOING -> AWAITING_APPROVAL -> APPROVED -> DONE
    When the audit log is queried for that task ID
    Then 4 entries are returned
    And each entry contains timestamp, task_id, previous_state, new_state, actor, and trigger_source
    And all timestamps are in ISO 8601 format with millisecond precision

  Scenario: Audit log is append-only
    Given an audit log with 10 entries
    When a new state transition occurs
    Then the log contains 11 entries
    And the first 10 entries are unchanged (byte-identical)

  Scenario: Audit log is queryable by task ID
    Given a workflow with 5 tasks each having 3 state transitions
    When the audit log is queried for task "design-l1"
    Then only the 3 entries for "design-l1" are returned
    And they are ordered by timestamp ascending
```

## Related
- FR: FR-002, FR-009, FR-013
