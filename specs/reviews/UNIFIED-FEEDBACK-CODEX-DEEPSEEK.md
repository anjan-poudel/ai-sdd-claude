# Unified Feedback: Codex + DeepSeek (with Derailment-Risk Merge)

Date: 2026-02-27
Review Inputs:
- `deepseek-review.md`
- `deep-review-derailment-risks.md`
- `review-codex.md`

## Executive Summary

The architecture is strong, but two risk classes remain:
1. **Spec integrity risks (immediate blockers):** cross-document contradictions that will cause implementation churn or unsafe behavior.
2. **Execution/viability risks (delivery derailment):** scope, timeline, and integration volatility risks that can stall adoption or completion.

The right strategy is **not** to redesign the framework, but to:
- close a small set of P0 contract mismatches first,
- then run a scope-controlled MVP plan with explicit success metrics.

## Consolidated Findings

### P0: Must Fix Before Coding

1. Security behavior contradiction
- Task output secret handling is split between blocking (`NEEDS_REWORK`) and redaction semantics.
- Secret-pattern namespace is split (`observability.*` vs `security.*`).
- Unified rule:
  - Task output secret: block completion, set `NEEDS_REWORK`, no write.
  - Logs/events secret: redact, non-blocking.
  - Single config namespace: `security.secret_patterns`.

2. Constitution ownership mismatch
- `Reading Convention` is treated as both engine-owned and user-authored in different docs.
- Unified rule:
  - Engine owns exactly one section: `## Workflow Artifacts`.
  - `## Reading Convention` remains user-authored and not engine-mutated.

3. Gate status evidence mismatch
- Gate marked PASSED while checklists/signatures remain incomplete.
- Unified rule:
  - If signatures/checklists are incomplete, status must be `READY_FOR_SIGNOFF` (not PASSED/COMPLETED).

4. Adapter ID contract drift
- `operation_id/attempt_id` canonical contract conflicts with residual `idempotency_key` references.
- Unified rule:
  - Use `operation_id` (provider dedup) + `attempt_id` (observability) everywhere.

### P1: Fix in Spec Consistency Pass (Before Phase 1 Ends)

5. MCP text-vs-JSON return handling ambiguity
- `get_constitution()` is text but helper appears JSON-only.
- Fix with explicit `_run_cli_json` and `_run_cli_text` or standardized `--json` output.

6. LLM-judge independence contradiction in T007
- Independence policy exists but implementation note still describes self-judging.
- Keep only independent-evaluator flow.

7. HIL config hierarchy mismatch
- Top-level `hil` vs `overlays.hil` inconsistency.
- Pick one hierarchy and enforce in all docs/examples.

8. Stale command vocabulary and removed-component references
- Residual `--tool openai` and `ContextReducer` mentions.
- Run a doc-wide normalization pass.

### P2: Delivery/Derailment Risks (Strategic)

9. Scope/timeline risk remains high
- 201 dev-days total; long time-to-value for small teams.
- Risk: abandonment before durable user value.

10. Integration volatility risk
- Native tool surfaces (Claude/Roo/MCP) can change quickly.
- Risk: maintenance overhead and adapter breakage.

11. Testing surface explosion risk
- Overlay combos + tool integrations can inflate CI burden.
- Risk: flaky/slow tests reduce delivery throughput.

12. Adoption friction risk
- YAML + DSL + multi-file config is powerful but heavy for newcomers.
- Risk: drop-off before first success.

## Unified Action Plan

### Wave 1 (1-3 days): Contract Freeze
- Resolve P0 items 1-4.
- Update `CONTRACTS.md` + all task docs to match.
- Re-run T000 gate with real checklist completion and sign-offs.

### Wave 2 (2-4 days): Consistency Sweep
- Resolve P1 items 5-8.
- Add a repo-wide terminology check (lint-like) for forbidden stale terms (`--tool openai`, `idempotency_key`, `ContextReducer`).

### Wave 3 (1 week): De-risk Execution
- Re-scope near-term MVP to maximize early value:
  - Keep core engine + HIL + DSL + typed artifact baseline.
  - Treat native integrations beyond one path as phased follow-ons if capacity is tight.
- Define measurable delivery SLOs:
  - First usable workflow in <= 2 weeks.
  - PR CI <= 15 min; full suite <= 30 min.
  - 95% task calls under context budget warning threshold.

### Wave 4 (ongoing): Viability Controls
- Add compatibility matrix for integrations (supported versions, last validated date).
- Track weekly progress metrics:
  - milestone completion,
  - failure/rework rates,
  - user setup time to first run.

## Quantitative Targets (Merged)

- Time to first successful workflow: <= 30 minutes for new users.
- Security detector quality: FP < 1%, FN < 5% on defined corpora.
- Sanitizer performance: input < 50ms p95, output < 100ms p95.
- Recovery objective: resume after crash in < 5 minutes.
- CI budget: PR validation < 15 minutes; full suite < 30 minutes.
- Reliability: >= 99% task completion excluding explicit human rejection paths.

## Final Assessment

- **Technical foundation:** strong.
- **Spec readiness:** high but blocked by a small set of correctness inconsistencies.
- **Execution risk:** high unless scope discipline and incremental delivery are enforced.

If Waves 1 and 2 are completed, the spec becomes implementation-safe. If Wave 3 is also adopted, delivery viability improves substantially for a 1-2 developer team.
