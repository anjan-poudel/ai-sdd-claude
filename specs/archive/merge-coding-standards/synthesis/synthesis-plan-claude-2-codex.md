# Synthesis Execution Plan (Based on `synthesis-review-claude-2.md`)

Date: 2026-03-05  
Base document: `specs/merge-coding-standards/synthesis-review-claude-2.md`  
Output style: implementation plan (codex-suffixed)

## 1. Scope and Intent

This plan operationalizes the synthesis in `synthesis-review-claude-2.md` and incorporates recommendations from:
- `synthesis-review-codex.md`
- `synthesis-review-gemini.md`
- `critical_synthesis_review.md`
- `final_synthesis_review.md`

Goal: produce a low-risk, executable merge path for governance + traceability features in `ai-sdd` while preserving architecture invariants.

## 2. Resolved Planning Defaults

To avoid open-ended execution, this plan resolves defaults from `synthesis-review-claude-2.md`:

1. **Architecture baseline:** native TypeScript implementation in `ai-sdd` (default).  
2. **Governance mode default for new projects:** `warn`.  
3. **PlanningReviewOverlay scope default:** phases `planning` and `design` only.  
4. **Planning review response format:** structured JSON (`{"planning_review":"APPROVED|NEEDS_WORK"}`).
5. **Critical gap exit behavior:** non-zero only on critical gaps (requirement-task unlinks).
6. **MCP sequencing:** register governance MCP tools only after traceability CLI exists.

## 3. Incorporated Cross-LLM Feedback

## Adopted

1. From `synthesis-review-codex.md`: keep codex-style phased execution backbone and ticket-driven delivery.
2. From `synthesis-review-codex.md`: run feasibility spike for cross-repo `coding-standards/tools/*` reuse before committing to import.
3. From `synthesis-review-gemini.md`: keep `merged-claude`-level implementation detail as canonical engineering depth.
4. From `synthesis-review-gemini.md`: expose MCP value early, but only after backing commands exist.
5. From `critical_synthesis_review.md` and `final_synthesis_review.md`: default to native implementation to avoid cross-stack integration risk.
6. From `synthesis-review-claude-2.md`: formalize typed `GatedHandoverState` before enabling gate logic that depends on it.

## Not adopted (for now)

1. Full cross-repo direct dependency on `coding-standards/tools/validators` and `tools/query-engine` without a compatibility decision.
2. Any state-machine expansion (for example, adding `REQUIREMENTS_VALIDATED`) that would modify `VALID_TRANSITIONS`.
3. Full MCP server unification as part of this merge stream.

## 4. Phased Plan

## Phase 1: Zero-Code Wins (1-2 days)

Scope:
1. Agent constitution baseline in integration prompts.
2. 90% confidence + GO protocol in scaffold/BA prompts.
3. `toolgate.yaml` and checklist templates copied by `ai-sdd init`.
4. `plans/<feature>/` convention documented.

Exit criteria:
1. Prompt templates updated and tested/snapshotted.
2. Init templates created and copied non-destructively.

## Phase 2: Schema + Governance Core (3-5 days)

Scope:
1. Add governance tristate config (`off|warn|enforce`).
2. Add optional task schema fields:
   - `acceptance_criteria`
   - `requirement_ids`
   - `scope_excluded`
   - `budget`
   - `phase`
3. Add lock preflight and spec-hash state tracking.
4. Add policy gate sub-checks for scope excluded + budgets.
5. Add **typed** `GatedHandoverState` and warning event on untyped handover payloads.

Exit criteria:
1. No breaking change in existing workflows.
2. Governance checks behave correctly under `off`, `warn`, and `enforce`.
3. Gate checks do not silently noop when expected fields are absent (warning emitted).

## Phase 3: Traceability + Planning Review + MCP (5-8 days)

Order (mandatory):
1. **3a Feasibility spike**: evaluate reuse vs native for `coding-standards/tools/*`; produce go/no-go note.
2. **3b Traceability CLI**: implement `ai-sdd traceability` (`validate-lock`, `gaps`, `coverage`, `report`).
3. **3c MCP tools**: register two governance tools delegating to traceability CLI.
4. **3d PlanningReviewOverlay**: add overlay with robust parse-failure behavior and phase filter.
5. **3e AC coverage gate** in `complete-task` using typed handover contract.

Exit criteria:
1. Traceability command stable with machine-readable output and clear exit codes.
2. MCP tools functional (not stubbed).
3. PlanningReviewOverlay blocks correctly on `NEEDS_WORK` and parse failure policy.

## Phase 4: Tooling + CI + Routing (3-5 days)

Scope:
1. Adapt and ship drift/repro scripts.
2. Add CI template with explicit `ai-sdd init` prerequisite guard.
3. Add `check-budgets.sh`.
4. Add phase-based model routing with precedence:
   - task override > phase routing > adapter default
5. Add lock-regeneration task template.
6. Add user-facing onboarding docs for governance features.

Exit criteria:
1. CI template is executable in initialized projects.
2. Budget and drift scripts fail deterministically on violations.
3. Routing precedence verified in dry-run and tests.

## 5. Ticket Mapping

This plan uses the existing `MCS-*` ticket set as the execution backbone:
- Phase 1: MCS-004, MCS-005
- Phase 2: MCS-001, MCS-006, MCS-007, MCS-009
- Phase 3: MCS-008, MCS-010 (+ add spike and planning overlay tickets)
- Phase 4: MCS-002, MCS-003 (+ add routing, onboarding, lock-regeneration tickets)

Additional tickets to add:
1. `MCS-011` Feasibility spike: `coding-standards/tools/*` reuse decision.
2. `MCS-012` PlanningReviewOverlay implementation.
3. `MCS-013` Typed `GatedHandoverState` rollout.
4. `MCS-014` Governance onboarding docs.
5. `MCS-015` Phase-based routing implementation.

## 6. Risks and Controls

1. **Silent governance failures from untyped handover payloads**  
Control: enforce typed `GatedHandoverState` + warning events.

2. **Phase-order dependency breakage (MCP before CLI)**  
Control: hard sequencing in Phase 3.

3. **Cross-repo dependency lock-in**  
Control: explicit feasibility spike and documented decision gate.

4. **Operator friction due to over-enforcement**  
Control: default `warn` mode with migration path to `enforce`.

## 7. Success Metrics

Technical:
1. Deterministic gate outcomes (no flaky governance checks).
2. Scope-drift detection rate improves against established baseline.
3. Critical traceability gaps trend down release-over-release.
4. Planning-review-enabled workflows reduce `NEEDS_REWORK` by at least 15% within 60 days.

Adoption:
1. Share of projects on `governance.requirements_lock: enforce`.
2. Share of workflows using declared `acceptance_criteria`.
3. Releases passing traceability report with zero critical gaps.

