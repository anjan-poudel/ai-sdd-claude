# Response to DeepSeek Review

**Date:** 2026-02-27

---

## Already Resolved (by Codex Review)

The following weaknesses were independently identified by the Codex reviewer and
resolved before this review arrived. No further action needed:

| Finding | Resolution |
|---|---|
| W1: Contract inconsistencies (idempotency, tool naming, manifest ownership, security namespaces) | Fixed — T015, T010, T016, T017 |
| W2: Transaction boundary ambiguity in `complete_task` | Fixed — `ai-sdd complete-task` atomic command in T010, T020 |
| W3: Missing `NEEDS_REWORK` state | Fixed — T004 state machine, T006 rollback, CONTRACTS.md §2 |
| W4: Permissive fallbacks (registry missing, constitution parse) | Fixed — T013 hard error, T003 fail-fast for root layer |
| S1: Canonical Contracts Appendix | Done — CONTRACTS.md created |
| S2: Transaction boundaries | Done — CONTRACTS.md §7 |
| S3: Formal state machine | Done — T004 + CONTRACTS.md §2 |
| S4: Explicit strict/legacy modes | Done — T013, T003, CONTRACTS.md §9 |
| S7: Multi-project vision | Addressed below (W7) |
| S9: CLI consistency (--tool codex, status --next) | Fixed — T010 |

---

## Newly Addressed

### W5: LLM-as-Judge Independence → T007

Added an explicit policy section and three Gherkin scenarios:
- `evaluator_agent` is **required** when metric type is `llm_judge` (load-time error if absent).
- `evaluator_agent` must not equal the task's `agent` field (load-time error if same).
- The evaluator is invoked with a structured judge prompt; the task agent's session is
  never used for scoring.

This prevents self-evaluation bias loops.

---

### W6: Schema Migration Deferred — Phase 1 Versioning → T010 + T004 + CONTRACTS.md

Added from Phase 1:
- `schema_version: "1"` field added to state file schema in T004 (renamed from `version`
  for clarity).
- `state.schema_version` field added to `ai-sdd.yaml` config schema in T010.
- Version mismatch at startup → hard error with `ai-sdd migrate` prompt.
- Migration CLI interface specified in T010 acceptance criteria and CLI commands
  (`ai-sdd migrate --dry-run / --from / --to`), even though Phase 5 implements it.
- CONTRACTS.md §9 defines the versioning contract for all schema files.

---

### W7: Multi-Project Roadmap Note → ROADMAP.md

Added task group N (Post-M11, not yet scheduled) with four design questions that
must be resolved before multi-project work begins:
- Agent registry scope (per-repo vs per-org)
- Constitution inheritance across repos
- Workflow sharing
- State isolation

Notes that the MCP server already provides a potential cross-project orchestration
surface with minimal new work.

---

### S8: Security Performance Requirements → T017

Added a Non-Functional Requirements table to T017 with concrete targets:

| Requirement | Target |
|---|---|
| Injection detector false-positive rate | < 1% on clean corpus |
| Injection detector false-negative rate | < 5% on known-bad corpus |
| Input sanitizer latency | < 50ms p95 |
| Output sanitizer latency | < 100ms p95 |
| Injection fixture corpus | ≥ 20 patterns across ≥ 5 categories |
| Secret pattern coverage | All T011 event types verified |

---

### S10: Performance Budgets → T010

Added a performance budget table to T010 with default timeouts per operation:

| Operation | Default |
|---|---|
| Adapter dispatch (direct) | 120s |
| Adapter dispatch (delegation) | 300s |
| `complete-task` transaction | 30s |
| State file write | 10s |
| HIL queue write | 5s |

Memory: `observability.memory_warning_mb` (default 512) triggers a warning event.
Timeout breach → task transitions to `FAILED(error_type: timeout)`.

---

## Verdict

All 10 action items from the DeepSeek review are now resolved. The specification is
ready for implementation.
