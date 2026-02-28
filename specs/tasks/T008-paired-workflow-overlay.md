# T008: Paired Workflow Overlay

**Phase:** 2 (Overlay Suite)
**Status:** PENDING
**Dependencies:** T004 (core engine), T007 (confidence scoring — for optional exit condition)

---

## Context

The paired workflow overlay implements a driver/challenger loop for any task. The driver produces an artifact; the challenger critiques it. The loop continues until:
- The confidence score meets the threshold (if confidence scoring is enabled), OR
- The challenger signals approval.

Role switching (driver ↔ challenger) is configurable: per full session, per subtask, or at defined checkpoints.

**Reviewer independence rule**: if a formal independent review task follows the paired task in the workflow, the challenger agent must not be the same agent assigned as the formal reviewer.

This overlay is **off by default**.

---

## Acceptance Criteria

```gherkin
Feature: Paired workflow overlay

  Scenario: Basic driver/challenger loop
    Given a task with paired_workflow enabled, driver=pe, challenger=architect
    When the task starts
    Then the driver (pe) runs first and produces an artifact
    Then the challenger (architect) critiques the artifact
    Then the driver revises based on the critique
    And the loop continues until an exit condition is met

  Scenario: Exit on challenger approval
    Given a paired loop with exit_condition "pair.challenger_approved == true"
    When the challenger signals approval
    Then the loop exits and the artifact is locked
    And the workflow advances to the next task

  Scenario: Exit on confidence threshold
    Given a paired loop with confidence_loop also enabled and threshold=0.82
    When the driver output scores 0.85 confidence
    Then the confidence advisory is emitted
    And if the policy gate also passes, the loop exits automatically

  Scenario: Role switch at subtask level
    Given a paired loop with role_switch=subtask
    When the first subtask completes
    Then the challenger becomes the new driver for the next subtask
    And the driver becomes the new challenger

  Scenario: Role switch per session (no switch during session)
    Given a paired loop with role_switch=session (default)
    When the entire task loop completes
    Then the driver and challenger roles do not swap during the session

  Scenario: Max iterations reached
    Given a paired loop with max_iterations=4
    When 4 iterations complete without an exit condition being satisfied
    Then the loop exits
    And if HIL is enabled, escalation occurs with the full pair history as context

  Scenario: Pair state corruption escalates to HIL
    Given a running paired loop
    When the pair session state becomes inconsistent
    Then the loop escalates to HIL with the full pair history
    And does not attempt to continue silently

  Scenario: Reviewer independence rule
    Given a paired_workflow with challenger=pe
    And a subsequent formal review task assigned to pe
    When the workflow loads
    Then a validation warning is raised: "challenger and formal reviewer are the same agent"

  Scenario: Paired workflow disabled (default)
    Given a task with no paired_workflow configuration
    When the task runs
    Then no driver/challenger loop occurs
    And the task runs with its single assigned agent
```

---

## Pair Session Context Schema

```json
{
  "pair_session": {
    "driver_agent": "pe",
    "challenger_agent": "architect",
    "current_role_driver": "pe",
    "role_switch": "session",
    "iteration": 2,
    "max_iterations": 5,
    "history": [
      {
        "iteration": 1,
        "driver_output_summary": "Proposed microservices architecture with 4 services",
        "challenger_critique": "Missing data consistency strategy across service boundaries",
        "challenger_approved": false
      }
    ],
    "challenger_approved": false
  }
}
```

---

## Workflow YAML Config

```yaml
tasks:
  design-l1:
    agent: architect
    overlays:
      paired_workflow:
        enabled: true
        driver_agent: architect
        challenger_agent: pe
        role_switch: session        # options: session | subtask | checkpoint
        max_iterations: 5
        exit_conditions:
          - "pair.challenger_approved == true"
          - "confidence_score >= 0.85"
```

---

## Implementation Notes

- The paired overlay wraps task dispatch: run driver, then challenger, then driver again (loop).
- Challenger system prompt: "You are the challenger. Critique the following driver output and identify assumptions, gaps, and risks. Signal `challenger_approved: true` if the output is ready to lock."
- Role switch logic: track `current_role_driver`; swap on the configured trigger.
- Pair history is accumulated in `pair_session.history` and injected into each subsequent iteration's context.
- The overlay communicates with the confidence overlay (if active) via the shared `TaskContext`.
- Pair session state is written to `.ai-sdd/state/pair-sessions/<task-id>.json`.

---

## Files to Create

- `overlays/paired/paired_overlay.py`
- `overlays/paired/pair_session.py`
- `tests/test_paired_overlay.py`

---

## Test Strategy

- Integration tests: basic driver/challenger loop; role switching (session, subtask); max-iteration escalation.
- Integration test: challenger approval exits loop.
- Integration test: pair state corruption triggers HIL escalation.
- Unit test: reviewer independence warning at load time.

## Rollback/Fallback

- If pair session state is corrupted, escalate to HIL with full history.
- If HIL is disabled and max_iterations is reached, exit loop and mark task with "max_iterations_exceeded" flag.
