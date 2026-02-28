# T009: Agentic Review Loop Overlay

**Phase:** 2 (Overlay Suite)
**Status:** PENDING
**Dependencies:** T004 (core engine), T005 (HIL overlay), T007 (confidence scoring — optional)

---

## Context

The agentic review overlay implements a coder/reviewer loop where roles do **not** switch. The coder produces an artifact; the reviewer critiques it against quality guidelines (drawn from the constitution). The loop continues until the reviewer issues a GO decision or MAX_ITERATION is reached.

Review decisions are auditable — stored in a structured review log for compliance and retrospective analysis.

This overlay differs from the Paired Workflow overlay in that:
- Roles never switch (coder stays coder, reviewer stays reviewer).
- Exit is driven by GO/NO_GO, not confidence score.
- It is targeted at formal quality gates (PR code review, design review).

This overlay is **off by default**.

---

## Acceptance Criteria

```gherkin
Feature: Agentic review loop overlay

  Scenario: Reviewer issues GO
    Given a task with agentic_review enabled, coder=dev, reviewer=reviewer
    When the coder produces an artifact
    And the reviewer evaluates it against quality guidelines
    And the reviewer signals GO
    Then the loop exits
    And the artifact is locked
    And a GO review log entry is written

  Scenario: Reviewer issues NO_GO with rework feedback
    Given a reviewer that issues NO_GO with feedback "missing error handling on auth flow"
    When the coder receives the NO_GO
    Then the coder runs again with the NO_GO feedback injected into context
    And produces a revised artifact addressing the feedback

  Scenario: Loop exits on max iterations
    Given agentic_review.max_iterations=3
    When 3 iterations complete with all NO_GO outcomes
    Then the loop exits
    And a HIL queue item is created with the full review history
    And the task pauses for human decision

  Scenario: Review decisions are auditable
    Given a completed agentic review loop
    When the review log is inspected
    Then each iteration has a record: iteration number, decision, feedback, timestamp
    And the final decision is clearly marked

  Scenario: Quality guidelines sourced from constitution
    Given a constitution with a "Standards" section specifying code review guidelines
    When the reviewer agent runs
    Then its evaluation prompt includes the constitution's Standards section
    And its review is grounded in the project-specific quality rules

  Scenario: Agentic review disabled (default)
    Given a task with no agentic_review configuration
    When the task runs
    Then no coder/reviewer loop occurs
    And the task runs with its single assigned agent
```

---

## Review Decision Schema

```json
{
  "task_id": "implement",
  "reviewer_agent": "reviewer",
  "coder_agent": "dev",
  "iteration": 2,
  "decision": "NO_GO | GO",
  "feedback": "Missing error handling in the authentication flow. Add try/catch around JWT validation.",
  "quality_checks": {
    "acceptance_criteria_met": true,
    "code_standards_met": false,
    "test_coverage_adequate": true,
    "security_review_passed": true
  },
  "timestamp": "2026-02-27T11:30:00Z"
}
```

---

## Review Log

Review log location: `.ai-sdd/state/review-logs/<task-id>.json`

```json
{
  "task_id": "implement",
  "overlay": "agentic_review",
  "iterations": [
    {
      "iteration": 1,
      "decision": "NO_GO",
      "feedback": "...",
      "timestamp": "..."
    },
    {
      "iteration": 2,
      "decision": "GO",
      "feedback": "All criteria met.",
      "timestamp": "..."
    }
  ],
  "final_decision": "GO",
  "completed_at": "2026-02-27T11:45:00Z"
}
```

---

## Workflow YAML Config

```yaml
tasks:
  implement:
    agent: dev
    overlays:
      agentic_review:
        enabled: true
        coder_agent: dev
        reviewer_agent: reviewer
        max_iterations: 3
        exit_conditions:
          - "review.decision == GO"
```

---

## Reviewer Prompt Structure

The reviewer receives:
1. The coder's output artifact.
2. The quality guidelines from the merged constitution.
3. The acceptance criteria for the task.
4. (If iterating) The history of previous NO_GO decisions and feedback.

The reviewer must output a structured decision: `{ "decision": "GO|NO_GO", "feedback": "..." }`.

---

## Implementation Notes

- Agentic review wraps task dispatch via the post-task hook.
- Reviewer prompt is constructed from constitution standards + task acceptance criteria.
- NO_GO feedback is injected into the coder's context for the next iteration.
- Review log is appended after each iteration (not rewritten) for atomic, corruption-resistant logging.
- On repeated NO_GO beyond max_iterations, route to HIL with the full review log.

---

## Files to Create

- `overlays/review/review_overlay.py`
- `overlays/review/review_log.py`
- `tests/test_review_overlay.py`

---

## Test Strategy

- Integration tests: GO path exits loop; NO_GO path reruns coder with feedback.
- Integration test: max_iterations reached → HIL escalation.
- Unit tests: review log append (atomic write); GO/NO_GO decision parsing.
- Integration test: constitution quality guidelines are included in reviewer context.

## Rollback/Fallback

- On repeated NO_GO beyond max iterations: route to HIL with full review log as context.
- On review log write failure: log warning but continue (review log is observability, not state).
