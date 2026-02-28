# T014: Overlay Composition Matrix Tests

**Phase:** 2 (Overlay Suite)
**Status:** PENDING
**Dependencies:** T005 (HIL), T006 (Evidence Gate), T007 (Confidence), T008 (Paired), T009 (Agentic Review)
**Size:** M (5 days)
**Source:** Synthesized-Codex (GAP-L2-003)

---

## Context

Enabling multiple overlays simultaneously (e.g., HIL + policy gate + confidence + paired) can produce non-deterministic routing. No source plan specified the invariants that must hold across overlay combinations, nor the test matrix required to verify them.

This task defines and enforces those invariants through a pairwise + full-combination test matrix with golden trace fixtures.

---

## Acceptance Criteria

```gherkin
Feature: Overlay composition matrix

  Scenario: Single overlay — HIL only
    Given a task with only HIL enabled
    When the task executes
    Then HIL fires first and pauses on requires_human
    And no other overlay fires

  Scenario: HIL + Policy Gate
    Given a task with HIL and policy_gate(T1) enabled
    When HIL resolves and policy gate evaluates
    Then HIL check occurs before gate evaluation
    And policy gate FAIL blocks advancement regardless of HIL resolution

  Scenario: Policy Gate + Confidence — confidence advisory only
    Given a task with policy_gate(T1) and confidence(threshold=0.80) enabled
    And confidence score is 0.95 (above threshold)
    But verification evidence is missing
    When overlays evaluate
    Then policy gate returns FAIL (missing evidence)
    And the high confidence score does not override the gate verdict
    And the confidence advisory is noted in the gate report

  Scenario: Paired + Agentic Review — cannot combine on same task
    Given a task with both paired_workflow and agentic_review enabled
    When the workflow loads
    Then a validation error is raised: "paired_workflow and agentic_review cannot both be enabled on the same task"

  Scenario: All overlays enabled (HIL + Gate + Confidence)
    Given a task with HIL, policy_gate(T2), and confidence(0.85) enabled
    When the task produces output with confidence=0.90 and full evidence
    Then HIL fires first (no requires_human → passes through)
    Then policy gate evaluates (T2 → creates HIL item for sign-off)
    Then confidence advisory is noted
    And the task does not advance until T2 HIL item is resolved

  Scenario: Loop exhaustion with all overlays
    Given a task with max_iterations=3 and all overlays enabled
    When 3 iterations complete without meeting exit conditions
    Then the engine escalates to HIL with: loop history, confidence scores, gate reports
    And does not enter an infinite loop

  Scenario: Overlay chain is strictly ordered
    Given any task with multiple overlays enabled
    When the task executes
    Then overlays always fire in order: HIL → Gate → Review → Paired → Confidence → Agent
    And no overlay fires out of order

  Scenario: Invariant: loops are always bounded
    Given any combination of overlays with loops enabled
    When the workflow executes
    Then every loop terminates (either via exit condition or MAX_ITERATION)
    And no task remains in RUNNING status indefinitely
```

---

## Composition Rules (Constraints)

| Rule | Constraint |
|---|---|
| Mutual exclusion | `paired_workflow` and `agentic_review` cannot both be enabled on the same task |
| Confidence gate bypass | Confidence score ≥ threshold does NOT bypass the policy gate |
| T2 sign-off | T2 policy tier always creates a HIL item, regardless of confidence score |
| Loop bound | Every loop must have `max_iterations`; the DSL must validate this at load time |
| Overlay order | Fixed: HIL → Gate → Review → Paired → Confidence → Agent (immutable) |

---

## Test Matrix

| HIL | Gate | Confidence | Paired | Review | Valid Combination | Key Invariant to Verify |
|---|---|---|---|---|---|---|
| ✓ | | | | | Yes | HIL pause/resolve works alone |
| ✓ | ✓ | | | | Yes | Gate runs after HIL; T2 requires HIL |
| ✓ | ✓ | ✓ | | | Yes | Confidence advisory does not bypass gate |
| ✓ | ✓ | ✓ | ✓ | | Yes | Paired loop bounded; confidence used in exit |
| ✓ | ✓ | ✓ | | ✓ | Yes | Review loop bounded; gate final arbiter |
| ✓ | ✓ | | ✓ | ✓ | **Invalid** | Mutual exclusion: paired + review on same task |
| ✓ | ✓ | ✓ | ✓ | ✓ | **Invalid** | Mutual exclusion |

---

## Golden Trace Fixtures

Each valid combination has a golden trace: a JSON file recording the complete sequence of overlay calls, decisions, and state transitions for a canonical execution.

```json
{
  "fixture": "hil-gate-confidence",
  "task": "design-l1",
  "overlays": ["hil", "policy_gate_T1", "confidence_0.85"],
  "trace": [
    { "step": 1, "overlay": "hil", "action": "check", "result": "pass_through", "reason": "no requires_human" },
    { "step": 2, "overlay": "policy_gate", "action": "evaluate", "result": "PASS", "evidence": {...} },
    { "step": 3, "overlay": "confidence", "action": "score", "result": 0.87, "advisory": "threshold_met" },
    { "step": 4, "overlay": "agent", "action": "execute", "result": "COMPLETED" }
  ]
}
```

---

## Invariant Assertions (CI Gates)

These must be asserted in the CI overlay composition test suite:

1. **Bounded loops**: No task remains RUNNING after `max_iterations` is exhausted.
2. **No silent promotion**: COMPLETED status is only set after all active overlays pass.
   `gap_audit` must also pass before COMPLETED is allowed.
3. **Deterministic routing**: Same input + same context = same overlay sequence and outcome.
4. **Order immutability**: Overlay call order matches the locked chain every time.
5. **Confidence advisory**: `confidence_score >= threshold` never sets COMPLETED alone.

---

## Files to Create

- `tests/overlays/test_composition_matrix.py`
- `tests/overlays/golden/hil-only.json`
- `tests/overlays/golden/hil-gate.json`
- `tests/overlays/golden/hil-gate-confidence.json`
- `tests/overlays/golden/hil-gate-confidence-paired.json`
- `tests/overlays/golden/hil-gate-confidence-review.json`
- `overlays/composition_rules.py` (mutual exclusion + order enforcement)

---

## Test Strategy

- Pairwise matrix: all valid 2-overlay combinations verified.
- Full combination: all valid multi-overlay combinations with invariant assertions.
- Mutation tests: deliberately violate each invariant and assert the test catches it.
- CI gate: composition matrix must fully pass before any overlay PR merges.

## Rollback/Fallback

- If composition rules module is missing, engine refuses to run with >1 overlay.
- Mutual exclusion violations fail at load time (not runtime).
