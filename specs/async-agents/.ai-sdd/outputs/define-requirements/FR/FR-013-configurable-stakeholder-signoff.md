# FR-013: Configurable Stakeholder Sign-Off Threshold

## Metadata
- **Area:** Workflow Engine
- **Priority:** MUST
- **Source:** requirements.md "configurable min stakeholder signoff" / constitution.md "Configurable stakeholder sign-off: minimum approval threshold"

## Description
The system must allow each async task (or workflow-level default) to specify a minimum number of stakeholder approvals required before transitioning from AWAITING_APPROVAL to APPROVED. The threshold must be configurable in the workflow YAML at both the workflow defaults level and the individual task level (task-level overrides workflow default). The orchestrator must track which distinct stakeholders have approved and only transition when the count meets or exceeds the threshold. A threshold of 0 must mean no approval is required (auto-advance).

## Acceptance criteria

```gherkin
Feature: Configurable stakeholder sign-off threshold

  Scenario: Task requires 2 approvals and receives them
    Given an async task with min_approvals set to 2
    And the task is in AWAITING_APPROVAL state
    When stakeholder "PO-1" approves
    Then the task remains in AWAITING_APPROVAL (1 of 2)
    When stakeholder "PE-1" approves
    Then the task transitions to APPROVED (2 of 2 met)

  Scenario: Task-level threshold overrides workflow default
    Given a workflow default min_approvals of 1
    And task "design-l1" has min_approvals set to 3
    When "design-l1" enters AWAITING_APPROVAL
    Then 3 distinct approvals are required to advance

  Scenario: Threshold of zero auto-advances
    Given an async task with min_approvals set to 0
    When the task completes and would enter AWAITING_APPROVAL
    Then the task automatically transitions to APPROVED and then DOING
    And no Slack approval notification is sent

  Scenario: Duplicate approvals from same stakeholder are not counted
    Given an async task with min_approvals set to 2
    When stakeholder "PO-1" approves twice
    Then only 1 approval is counted
    And the task remains in AWAITING_APPROVAL
```

## Related
- NFR: NFR-003 (State Transition Auditability)
- Depends on: FR-002, FR-005
