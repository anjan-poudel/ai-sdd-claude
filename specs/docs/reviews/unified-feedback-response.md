# Response to UNIFIED-FEEDBACK-CODEX-DEEPSEEK.md

**Date:** 2026-02-28

---

## P0: Must Fix Before Coding

### P0/1: Security behavior contradiction → Already resolved
Task output secret: blocking gate → `NEEDS_REWORK` before write — in T017.
Log/event secret: non-blocking redaction — in T017.
Single namespace `security.secret_patterns` — in T017, T010, CONTRACTS.md §10.
No further action.

### P0/2: Constitution ownership mismatch → Already resolved
T016 §Manifest Ownership Contract: engine owns ONLY `## Workflow Artifacts`.
`## Reading Convention` is user-authored and never touched by engine.
No further action.

### P0/3: Gate status evidence mismatch → Fixed
- `PRE-IMPLEMENTATION-GATE.md`: Status changed from `✅ PASSED` to `⏳ READY_FOR_SIGNOFF`.
  Rationale: the 24 checks verify that spec text is complete and consistent, but the gate
  cannot be `PASSED` until the sign-off table has real signatures. Changed gate decision
  box accordingly.
- `T000-spec-gate.md`: Status changed from `COMPLETED` to `PENDING`.
  The task is not COMPLETED until both sign-offs are recorded.

### P0/4: Adapter ID contract drift (`idempotency_key` residuals) → Fixed
Updated `dispatch()` signature in T015, T018, T019 from `idempotency_key: str` to
`operation_id: str, attempt_id: str` — matching CONTRACTS.md §4.
Updated Gherkin scenarios in T004 and T010.
Updated test strategy lines in T010 and T015.
Updated T004 header note.

---

## P1: Spec Consistency Pass

### P1/5: MCP text-vs-JSON return handling → Fixed
T020 `get_constitution()` returns `str` (markdown text) but was calling `_run_cli()`
which does `json.loads()`. Fixed by adding a `_run_cli_text()` helper for text-returning
tools. `get_constitution()` now calls `_run_cli_text()`. All other tools still use
`_run_cli()` (JSON path).

### P1/6: LLM-judge self-evaluation note in T007 → Fixed
Implementation Notes line "the agent itself is asked to score its own output" directly
contradicted the LLM-as-Judge Independence Policy above it. Replaced with correct
description: the evaluator agent (not the task agent) is invoked with a structured judge
prompt.

### P1/7: HIL config hierarchy mismatch → Fixed
T005 YAML example had `hil:` at the root of `ai-sdd.yaml`, while T010 correctly uses
`overlays.hil:`. Fixed T005 to use `overlays.hil:` — consistent with all other overlays
in `ai-sdd.yaml` and with CONTRACTS.md.
Added CONTRACTS.md §12: HIL Config Hierarchy — documents two-level structure (project
global vs per-task) and confirms `overlays.hil` is the canonical path at both levels.

### P1/8: Stale command vocabulary → Fixed
- TASK-VISUALIZATION.md: 3× `--tool openai` → `--tool codex` (all occurrences).
- T010 config YAML comment: `# hard cap passed to ContextReducer / agent` → `# hard cap; context warning emitted at breach`.
- T010 test strategy: `--tool claude_code/openai/roo_code` → `--tool claude_code/codex/roo_code`.
- CONTRACTS.md: duplicate `## 9. Backward-Compatibility Modes` renumbered to `## 11`.

**Note on remaining ContextReducer mentions:**
References in PLAN.md, ROADMAP.md, COMPARISON.md, GAPS-ANALYSIS.md, T016, and T003
are **intentional historical context** — they explain the decision to remove ContextReducer
in favour of the pull model. These are not stale vocabulary; they are design rationale and
should remain.

---

## P2: Delivery/Derailment Risks (Strategic) — Pushback

### P2/9 Scope/timeline risk
**Pushback.** 201 dev-days is accurate and already documented in ROADMAP.md with phased
delivery: Core Engine (Phase 1) → Overlays (Phase 2) → Native Integration (Phase 3).
The spec is already structured so that Phase 1 alone produces a usable system. Trimming
scope in the spec would remove validated task definitions. Delivery sequencing is a
project execution decision, not a spec change. No action on spec.

### P2/10 Integration volatility
**Pushback.** Already mitigated by the delegation dispatch model: the engine sends only
a lightweight task brief to native tools; CLAUDE.md / .roomodes / AGENTS.md handle
persona and context. This thin coupling means adapter changes are isolated. A
compatibility matrix is noted as a good idea for T018/T019/T020 README files at
implementation time, but is not a spec-blocking concern.

### P2/11 Testing surface explosion
**Pushback.** T014 already specifies the overlay composition matrix test suite with CI
gate. The CI/reliability SLOs (PR ≤ 15 min, full suite ≤ 30 min) have been added to
T010 §Reliability and CI SLOs — this is actionable and bounds the testing surface.

### P2/12 Adoption friction
**Pushback.** The framework's DX gap is acknowledged in GAPS-ANALYSIS.md §DX and
assigned to Phase 4. `ai-sdd init --tool <name>` reduces setup to a single command;
constitution.md drives context. First workflow SLO (≤ 30 min) is now in T010 — this
bounds the onboarding target. Further DX improvements belong in Phase 4 planning.

---

## Quantitative Targets Added

The Wave 3 quantitative targets from the feedback have been incorporated into T010
§Reliability and CI SLOs:

| Target | Value |
|---|---|
| Time to first successful workflow (new user) | ≤ 30 min |
| Crash recovery | ≤ 5 min |
| PR validation CI job | ≤ 15 min |
| Full test suite | ≤ 30 min |
| Task completion reliability | ≥ 99% (excl. HIL rejection) |

Security detector targets (FP < 1%, FN < 5%, sanitizer < 50/100ms p95) remain in T017.

---

## Summary

| Finding | Status |
|---|---|
| P0/1 Security contradiction | Already resolved in T017 |
| P0/2 Constitution ownership | Already resolved in T016 |
| P0/3 Gate status mismatch | Fixed — READY_FOR_SIGNOFF |
| P0/4 `idempotency_key` drift | Fixed — 6 files updated |
| P1/5 MCP text-vs-JSON | Fixed — `_run_cli_text()` added |
| P1/6 LLM-judge contradiction | Fixed — T007 Implementation Notes |
| P1/7 HIL hierarchy mismatch | Fixed — T005 + CONTRACTS.md §12 |
| P1/8 Stale vocabulary | Fixed — TASK-VISUALIZATION.md + T010 + CONTRACTS.md |
| P2/9–12 Strategic risks | Pushed back (execution planning, not spec); SLOs added |
