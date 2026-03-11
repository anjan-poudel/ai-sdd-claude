# T-016: Jira Kanban Transitions (BFS Multi-Hop)

## Metadata
- **Group:** [TG-05 -- Jira Integration](index.md)
- **Component:** JiraTaskTrackingAdapter (transition subsystem)
- **Agent:** dev
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** [T-015](T-015-jira-task-adapter.md)
- **Blocks:** --
- **Requirements:** [FR-009](../../../define-requirements/FR/FR-009-jira-kanban-transitions.md)

## Description
Implement the `transitionTask` method with BFS multi-hop path discovery. Jira Kanban boards may not allow direct status jumps (e.g., "Backlog" to "Done"). The adapter discovers available transitions at each state, builds a transition graph, finds the shortest path via BFS, and executes hops sequentially. Uses column_mapping config to resolve ai-sdd TaskStatus to Jira status names.

## Acceptance criteria

```gherkin
Feature: Jira Kanban transitions with BFS

  Scenario: Direct transition available
    Given an issue in "Backlog" status
    When transitionTask is called with targetStatus = "In Progress"
    And "In Progress" is a direct transition
    Then one POST /transitions call is made
    And the result is ok = true

  Scenario: Multi-hop transition via BFS
    Given an issue in "Backlog" with transitions only to "Selected"
    And "Selected" has a transition to "In Progress"
    When transitionTask is called with targetStatus = "In Progress"
    Then BFS finds path: Backlog -> Selected -> In Progress
    And two sequential POST /transitions calls are made

  Scenario: No valid transition path
    Given an issue in "Backlog" with no path to "Done"
    When transitionTask is called with targetStatus = "Done"
    Then the result is ok = false with error code VALIDATION
    And the error message says "No transition path from Backlog to Done"
```

## Implementation notes
- BFS over the transition graph discovered via `GET /rest/api/3/issue/{id}/transitions`
- Column mapping from `collaboration.jira.column_mapping` config
- Status ID resolution: call `GET /rest/api/3/status` at adapter startup, cache the mapping
- Execute hops sequentially (each hop may change available transitions)
- Maximum hop limit of 10 to prevent infinite loops on circular transition graphs

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Tests use captured Jira transitions API fixtures
- [ ] BFS path limit enforced (max 10 hops)
