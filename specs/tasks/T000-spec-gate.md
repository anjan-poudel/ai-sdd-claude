# T000: Spec Gate — Pre-Implementation Review Sign-Off

**Phase:** 0 (Pre-Implementation)
**Status:** PENDING
**Dependencies:** none
**Risk Tier:** T2 (mandatory human sign-off — blocks all implementation)
**Size:** XS (1d to verify)

---

## Context

This is the pre-implementation gate for `ai-sdd`. It uses the framework's own T2
evidence gate and HIL sign-off mechanism — the framework gating its own implementation.

**No Phase 1 task may start until this gate reaches COMPLETED.**

The gate consolidates action items from three independent reviews:
- `REVIEW-FEEDBACK.md` (Codex review — 9 findings)
- `GEMINI-REVIEW.md` (Gemini review — 6 findings)
- `deepseek-review.md` (DeepSeek review — 10 action items)

All findings have been addressed. This task verifies that the fixes are in place
and collects sign-off before coding begins.

---

## Acceptance Criteria

```gherkin
Feature: Pre-implementation spec gate

  Scenario: All review action items are resolved
    Given the three review documents in this folder
    When a reviewer checks each action item against the referenced spec section
    Then every item has a corresponding fix in a task file or CONTRACTS.md
    And no item is marked OPEN

  Scenario: CONTRACTS.md is the single source of truth
    Given CONTRACTS.md exists
    When a reviewer reads it
    Then all normalized names, enums, states, CLI flags, and transaction
         boundaries are unambiguous and consistent with every task file

  Scenario: T2 gate requires two sign-offs before implementation
    Given this task has the evidence collected above
    When the HIL gate fires
    Then a Tech Lead sign-off is required
    And a Security Reviewer sign-off is required
    And Phase 1 implementation is blocked until both are given
```

---

## Evidence Checklist

A reviewer completes this checklist before resolving the HIL gate.

### From Codex Review (REVIEW-FEEDBACK.md)

- [ ] **C1** `operation_id` is stable across retries; `attempt_id` changes per retry. Verified in: T015
- [ ] **C2** `--tool codex` and `adapter.type: openai` are documented as independent settings. Verified in: T010, CONTRACTS.md §1
- [ ] **C3** `ai-sdd complete-task` is the single atomic transaction boundary. MCP does not write files directly. Verified in: T010, T020, CONTRACTS.md §7
- [ ] **C4** `NEEDS_REWORK` state is in the formal state machine with defined transitions. Verified in: T004, CONTRACTS.md §2
- [ ] **C5** Engine owns only `## Workflow Artifacts` in constitution.md. Verified in: T016
- [ ] **C6** Missing artifact registry + declared contracts → hard startup error. Verified in: T013
- [ ] **C7** Root constitution malformed → hard startup error. Submodule → warn+skip. Verified in: T003
- [ ] **C8** `security.secret_patterns` is the single namespace. Verified in: T017, T010
- [ ] **C9** `status --next --json` is specified in T010 CLI commands and acceptance criteria. Verified in: T010
- [ ] **C10** `gap_audit` is required before task completion and documented in transaction boundary. Verified in: T004, T010, CONTRACTS.md §7

### From Gemini Review (GEMINI-REVIEW.md)

- [ ] **G1** `direct` and `delegation` dispatch modes are documented. `delegation` mode does not send engine-assembled prompts. Verified in: T004, CONTRACTS.md §8
- [ ] **G2** `hil.notify` config block supports `on_created` and `on_t2_gate` hooks. Verified in: T005, T010
- [ ] **G3** Inline contract syntax (Level 2) is defined alongside registry reference (Level 3). Verified in: T013
- [ ] **G4** Secret in task output → `NEEDS_REWORK` before filesystem write (blocking). Secret in logs → non-blocking redaction. Verified in: T017

### From DeepSeek Review (deepseek-review.md)

- [ ] **D1** `llm_judge` metric requires `evaluator_agent` ≠ task `agent`. Load-time error if violated. Verified in: T007
- [ ] **D2** `schema_version` field present in state file schema from Phase 1. Verified in: T004
- [ ] **D3** `ai-sdd migrate` CLI interface is specified (scenarios + syntax) even though Phase 5 implements it. Verified in: T010
- [ ] **D4** Version mismatch at startup → hard error with `ai-sdd migrate` prompt. Verified in: T010
- [ ] **D5** Multi-project support has a roadmap note with specific design questions. Verified in: ROADMAP.md §N
- [ ] **D6** Security NFRs: injection FP < 1%, FN < 5%, sanitizer < 50/100ms p95, corpus ≥ 20 patterns. Verified in: T017
- [ ] **D7** Performance budget table with default timeouts per operation type. Verified in: T010

### CONTRACTS.md Completeness

- [ ] Tool names, adapter types, task states, HIL states, CLI flags — all in CONTRACTS.md
- [ ] Idempotency key split (`operation_id` / `attempt_id`) — in CONTRACTS.md §4
- [ ] Transaction boundary for `complete-task` — in CONTRACTS.md §7
- [ ] Dispatch modes (`direct` / `delegation`) — in CONTRACTS.md §8
- [ ] Schema versioning contract — in CONTRACTS.md §9
- [ ] Backward-compatibility modes (`strict` / `legacy`) — in CONTRACTS.md §10 (formerly §9)

---

## HIL Sign-Off

This task has `risk_tier: T2`. The HIL gate fires automatically when evidence
collection is complete. Two sign-offs unlock Phase 1.

```yaml
# workflow state entry for this task
T000-spec-gate:
  status: HIL_PENDING → COMPLETED (after both sign-offs)
  hil:
    items:
      - id: hil-gate-tech-lead
        trigger: T2_gate
        required_role: tech_lead
        context: "All review action items verified. Phase 1 unblocked."
      - id: hil-gate-security
        trigger: T2_gate
        required_role: security_reviewer
        context: "Security findings C8, C9, G4, D6 verified."
```

---

## Workflow YAML Excerpt

All Phase 1 tasks declare `T000-spec-gate` as a dependency:

```yaml
tasks:
  spec-gate:
    agent: reviewer
    overlays:
      policy_gate:
        risk_tier: T2
    outputs:
      - path: .ai-sdd/outputs/spec-gate-report.md
        contract:
          required_sections: [evidence_checklist, sign_off]

  T001-agent-system:
    dependencies: [spec-gate]
    ...

  T002-workflow-system:
    dependencies: [spec-gate, T001-agent-system]
    ...
```

---

## Output

`spec-gate-report.md` — produced by the reviewer agent, containing:
1. Completed evidence checklist (all items ticked)
2. Any exceptions or caveats noted during review
3. Sign-off record (tech lead + security reviewer)

---

## Files to Create

- `tasks/T000-spec-gate.md` (this file)
- `.ai-sdd/outputs/spec-gate-report.md` (produced at runtime, not pre-created)
