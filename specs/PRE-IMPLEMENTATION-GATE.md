# ai-sdd: Pre-Implementation Gate

**Version:** 1.0
**Date:** 2026-02-27
**Purpose:** This gate must be fully PASSED before any Phase 1 implementation begins.
Every item is a verifiable, binary check. A single OPEN item blocks implementation.

**Current Status: ⏳ READY_FOR_SIGNOFF** — all 24 spec checks resolved; awaiting implementation-time sign-off from Tech Lead and Security Reviewer.

---

## How to Use This Gate

1. Before starting implementation, a reviewer checks every item against the current spec.
2. For each item, verify that the referenced document/section actually satisfies the criterion.
3. If any item is OPEN, implementation is blocked until it is resolved.
4. After resolution, re-run the gate check and update this document.
5. Sign-off at the bottom is required before the first commit.

---

## Category 1: Contract Consistency
*Source: Codex Review C1–C3, DeepSeek W1–W2*

| # | Check | Status | Verified in |
|---|---|---|---|
| C1 | Idempotency key is split into `operation_id` (stable, sent to provider) and `attempt_id` (per-retry, observability only). No `attempt` counter in the provider key. | ✅ RESOLVED | T015 §Adapter Contract Interface |
| C2 | CLI uses `--tool codex` (not `--tool openai`). `adapter.type: openai` is separate from `--tool`. Both documented and distinct. | ✅ RESOLVED | T010 §CLI Commands, CONTRACTS.md §1 |
| C3 | `ai-sdd complete-task` is a single atomic command: path-allowlist → sanitize → contract-validate → write → state-update → manifest-update. MCP `complete_task` delegates to it; never writes files directly. | ✅ RESOLVED | T010 §CLI Commands, T020 §MCP Server, CONTRACTS.md §7 |

---

## Category 2: State Machine
*Source: Codex Review C3/M8, DeepSeek W3*

| # | Check | Status | Verified in |
|---|---|---|---|
| C4 | `NEEDS_REWORK` state exists. Transitions: `RUNNING → NEEDS_REWORK` (gate fail/NO_GO), `NEEDS_REWORK → RUNNING` (rework), `NEEDS_REWORK → FAILED` (max iterations). | ✅ RESOLVED | T004 §Task State Machine, CONTRACTS.md §2 |
| C5 | No task ever remains in `RUNNING` indefinitely. Gate failure → `NEEDS_REWORK`. HIL trigger → `HIL_PENDING`. Crash → `FAILED`. | ✅ RESOLVED | T004 §Task State Machine |
| C6 | `HIL_PENDING` state exists: `HIL_PENDING → RUNNING` (resolved), `HIL_PENDING → FAILED` (rejected). | ✅ RESOLVED | CONTRACTS.md §2 |
| C7 | Invalid state transitions raise `StateError` enforced by `state_manager.py`. | ✅ RESOLVED | T004 §Task State Machine |

---

## Category 3: Safety Model Integrity
*Source: Codex Review H4–H5, DeepSeek W4*

| # | Check | Status | Verified in |
|---|---|---|---|
| C8 | Engine owns **only** `## Workflow Artifacts` in constitution.md. `## Reading Convention` is user-authored; never touched by engine. | ✅ RESOLVED | T016 §Manifest Ownership Contract |
| C9 | Missing artifact schema registry + contracts declared → hard startup error. Permissive mode requires explicit `--allow-legacy-untyped-artifacts`. | ✅ RESOLVED | T013 §Rollback/Fallback, CONTRACTS.md §9 |
| C10 | Malformed root `constitution.md` → hard startup error. Submodule layers → warn+skip. Permissive mode requires `constitution.strict_parse: false`. | ✅ RESOLVED | T003 §Rollback/Fallback, CONTRACTS.md §9 |

---

## Category 4: Security
*Source: Codex Review M7, DeepSeek W4/S8, Gemini 4.3*

| # | Check | Status | Verified in |
|---|---|---|---|
| C11 | All secret patterns under `security.secret_patterns`. Observability reads from `security.*`. No split namespaces. | ✅ RESOLVED | T017 §Policy Checks, T010 §Config Schema |
| C12 | Secret in **task output** → `NEEDS_REWORK` before filesystem write. Never silently redacted in output. | ✅ RESOLVED | T017 §Context, §Acceptance Criteria |
| C13 | Secret in **logs/observability** → non-blocking `[REDACTED:TYPE]`. Task continues. | ✅ RESOLVED | T017 §Context |
| C14 | Security NFRs: injection FP < 1%, FN < 5%, sanitizer latency < 50/100ms p95, fixture corpus ≥ 20 patterns across ≥ 5 categories. | ✅ RESOLVED | T017 §Non-Functional Requirements |

---

## Category 5: CLI Completeness
*Source: Codex Review H6, DeepSeek S9*

| # | Check | Status | Verified in |
|---|---|---|---|
| C15 | `ai-sdd status --next --json` specified in T010 acceptance criteria and CLI command list. MCP `get_next_task()` uses this flag. | ✅ RESOLVED | T010 §CLI Commands |
| C16 | All CLI commands in a single reference. No undocumented flags used by MCP or integration tests. | ✅ RESOLVED | T010 §CLI Commands, CONTRACTS.md §6 |

---

## Category 6: Adapter Contract
*Source: Gemini 3.1*

| # | Check | Status | Verified in |
|---|---|---|---|
| C17 | Two dispatch modes: `direct` (engine builds full prompt) and `delegation` (engine sends task brief only). `dispatch_mode` in adapter config. | ✅ RESOLVED | T004 §RuntimeAdapter Interface, CONTRACTS.md §8 |
| C18 | `delegation` mode adapters do not receive engine-assembled system prompts. CLAUDE.md / .roomodes handle persona. | ✅ RESOLVED | T004 §RuntimeAdapter Interface |

---

## Category 7: HIL Operability
*Source: Gemini 3.2*

| # | Check | Status | Verified in |
|---|---|---|---|
| C19 | `hil.notify` config: `on_created` and `on_t2_gate` hooks, webhook and command types, fire-and-forget. | ✅ RESOLVED | T005 §HIL Notification Hooks, T010 §Config Schema |

---

## Category 8: Confidence Scoring Integrity
*Source: DeepSeek W5*

| # | Check | Status | Verified in |
|---|---|---|---|
| C20 | `llm_judge` requires `evaluator_agent` ≠ task `agent`. Load-time error if same or missing. Self-evaluation impossible by spec. | ✅ RESOLVED | T007 §LLM-as-Judge Independence Policy |

---

## Category 9: Schema Versioning
*Source: DeepSeek W6*

| # | Check | Status | Verified in |
|---|---|---|---|
| C21 | All schemas carry `schema_version`/`version` field from Phase 1. | ✅ RESOLVED | T004 §State File Schema, T010 §Config Schema, CONTRACTS.md §9 |
| C22 | Version mismatch → hard error + `ai-sdd migrate` prompt. Migration CLI interface specified even though Phase 5 implements it. | ✅ RESOLVED | T010 §Acceptance Criteria, §CLI Commands |

---

## Category 10: Artifact Contract Usability
*Source: Gemini 3.3*

| # | Check | Status | Verified in |
|---|---|---|---|
| C23 | Three contract levels: bare path, inline (no registry needed), registry reference. Inline contracts require no registry entry. | ✅ RESOLVED | T013 §Contract Declaration Options |

---

## Category 11: Performance Budgets
*Source: DeepSeek S10*

| # | Check | Status | Verified in |
|---|---|---|---|
| C24 | Default timeout per operation type. Timeout breach → `FAILED(error_type: timeout)`. Memory warning threshold configurable. | ✅ RESOLVED | T010 §Performance Budgets |

---

## Gate Summary

| Category | Items | Resolved | Open |
|---|---|---|---|
| Contract Consistency | 3 | 3 | 0 |
| State Machine | 4 | 4 | 0 |
| Safety Model | 3 | 3 | 0 |
| Security | 4 | 4 | 0 |
| CLI Completeness | 2 | 2 | 0 |
| Adapter Contract | 2 | 2 | 0 |
| HIL Operability | 1 | 1 | 0 |
| Confidence Scoring | 1 | 1 | 0 |
| Schema Versioning | 2 | 2 | 0 |
| Artifact Contract | 1 | 1 | 0 |
| Performance Budgets | 1 | 1 | 0 |
| **TOTAL** | **24** | **24** | **0** |

---

## Gate Decision

```
┌────────────────────────────────────────────────┐
│                                                │
│   PRE-IMPLEMENTATION GATE:  ⏳ READY_FOR_SIGNOFF│
│                                                │
│   All 24 spec checks resolved.                 │
│   Awaiting Tech Lead + Security Reviewer       │
│   sign-offs to move to PASSED.                 │
│   Phase 1 is blocked until both sign-offs are  │
│   recorded below.                              │
│                                                │
└────────────────────────────────────────────────┘
```

---

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Tech Lead | | | |
| Security Reviewer | | | |

*Both sign-offs required before the first implementation commit.*

---

## Re-Running This Gate

Re-run if any of the following happen:
- A new review identifies additional pre-implementation concerns
- A task file is materially changed after gate pass
- CONTRACTS.md is amended
- A new tool integration is added to Phase 3
