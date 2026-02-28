# T006: Evidence Policy Gate Overlay

**Phase:** 2 (Overlay Suite)
**Status:** PENDING
**Dependencies:** T004 (core engine), T005 (HIL overlay)

---

## Context

The Evidence Policy Gate is a governance overlay that enforces that artifact promotion decisions are backed by real evidence — not just a confidence score. A confidence percentage alone **must never** be a standalone gate criterion.

The gate operates at three risk tiers:
- **T0 (Lightweight)**: Minimal evidence required; suitable for low-risk tasks.
- **T1 (Standard)**: Acceptance evidence + verification results required.
- **T2 (Strict)**: Full evidence + mandatory human sign-off via HIL.

This overlay is a critical addition from Codex's plan that is absent from other models.

---

## Acceptance Criteria

```gherkin
Feature: Evidence policy gate

  Scenario: T1 gate passes with sufficient evidence
    Given a task with policy_gate.risk_tier=T1
    And acceptance evidence is present (tests pass)
    And verification results are present (lint pass, security scan clean)
    When the policy gate evaluates the task outputs
    Then the gate returns PASS
    And the workflow advances to the next task

  Scenario: T1 gate fails with missing verification
    Given a task with policy_gate.risk_tier=T1
    And acceptance evidence is present
    But verification results are missing
    When the policy gate evaluates
    Then the gate returns FAIL with reason "missing verification evidence"
    And the task is returned for rework

  Scenario: T2 gate always requires HIL sign-off
    Given a task with policy_gate.risk_tier=T2
    And all evidence categories are satisfied
    When the policy gate evaluates
    Then a HIL queue item is created for human sign-off
    And the workflow pauses until the operator resolves the HIL item
    And the gate never bypasses HIL regardless of confidence score

  Scenario: Confidence score is advisory only
    Given a task with confidence_score=0.99
    And a policy gate with risk_tier=T1
    But verification results are missing
    When the policy gate evaluates
    Then the gate returns FAIL
    And the confidence score is noted in the gate report but does not override the verdict

  Scenario: T0 gate (lightweight) passes with minimal evidence
    Given a task with policy_gate.risk_tier=T0
    And acceptance evidence is present
    When the policy gate evaluates
    Then the gate returns PASS without requiring verification or readiness evidence

  Scenario: Requirement coverage check (optional)
    Given a task with policy_gate.require_coverage=true
    And requirement coverage is below the configured threshold
    When the policy gate evaluates
    Then the gate returns FAIL with reason "requirement coverage below threshold"
```

---

## Evidence Categories

| Category | Required for T0 | Required for T1 | Required for T2 |
|---|---|---|---|
| Acceptance evidence (tests pass) | Yes | Yes | Yes |
| Verification results (lint/security) | No | Yes | Yes |
| Operational readiness | No | Optional | Yes |
| Requirement coverage | No | Optional | Optional |
| Human sign-off (HIL) | No | No | **Always** |

---

## Gate Report Schema

```json
{
  "task_id": "implement",
  "risk_tier": "T1",
  "verdict": "PASS | FAIL",
  "evidence_checks": {
    "acceptance_evidence": { "status": "PASS", "details": "12/12 tests pass" },
    "verification": { "status": "PASS", "details": "lint: clean, security: clean" },
    "operational_readiness": { "status": "SKIPPED", "details": "not required for T1" },
    "requirement_coverage": { "status": "SKIPPED", "details": "not configured" }
  },
  "confidence_score": 0.87,
  "confidence_advisory": "High confidence — advisory only, does not override verdict",
  "hil_required": false,
  "evaluated_at": "2026-02-27T10:30:00Z"
}
```

---

## Workflow YAML Config

```yaml
tasks:
  implement:
    agent: dev
    overlays:
      policy_gate:
        enabled: true
        risk_tier: T1             # T0 | T1 | T2
        require_coverage: false   # optional; enable requirement coverage check
        coverage_threshold: 0.90  # used only if require_coverage=true
```

---

## Implementation Notes

- Policy gate is a post-task hook: it runs after the task completes and evaluates outputs.
- Evidence is collected from the task's output files and from external tool results (test runner, linter, security scanner).
- Gate verdict is written to `.ai-sdd/state/gate-reports/<task-id>.json`.
- T2 tier: gate creates a HIL queue item with the full gate report as context.
- Confidence score is included in the gate report as an advisory note, never as a decision factor.

---

## Files to Create

- `overlays/policy_gate/gate_overlay.py`
- `overlays/policy_gate/evidence_collector.py`
- `overlays/policy_gate/report.py`
- `tests/test_policy_gate.py`

---

## Test Strategy

- Unit tests: T0/T1/T2 gate logic for each evidence category combination.
- Unit tests: confidence score does not affect gate verdict.
- Integration test: T2 gate creates HIL item and pauses workflow.
- Integration test: gate FAIL returns task for rework.

## Rollback/Fallback

- If evidence collection fails (e.g., test runner unavailable), the gate fails with reason "evidence collection error".
- Gate failure transitions task to `NEEDS_REWORK` (not left in `RUNNING`).
  `NEEDS_REWORK` → agent reruns with gate failure reason injected into context.
  `NEEDS_REWORK` after max rework iterations → `FAILED`.
