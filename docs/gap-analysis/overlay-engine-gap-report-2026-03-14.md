# Overlay Engine Gap Report

Date: 2026-03-14

## Scope

Review focus:

- overlay engine decision mapping
- built-in local overlays
- remote MCP overlay provider
- overlay-related test coverage and repo claims

## What Was Verified

- `bun test` passes across the full repo.
- `bun run typecheck` passes.
- Provider-chain ordering and verdict mapping are covered by automated tests.
- Remote overlay transport/schema handling and observability events are covered by automated tests.

## Gaps Found And Fixed

### 1. Review/Paired HIL escalation was not actually wired into the engine

Problem:

- `ReviewOverlay` and `PairedOverlay` advertised HIL escalation after `max_iterations`.
- In practice they only returned `NEEDS_REWORK` with `data.hil_suggested=true`.
- `LocalOverlayProvider` ignored that hint, so the engine never entered `HIL_PENDING`.

Fix:

- `src/overlays/local-overlay-provider.ts` now maps `data.hil_suggested=true` to `OverlayVerdict = "HIL"`.
- `src/core/engine.ts` now preserves overlay evidence during post-task HIL transitions.
- Regression coverage added in:
  - `tests/overlays/local-overlay-provider.test.ts`
  - `tests/core/engine-provider-chain.test.ts`

### 2. Task-level overlay config was being ignored by multiple overlays

Problem:

- `policy_gate.enabled=false` did not disable the policy gate.
- `confidence.enabled=false` did not disable confidence scoring.
- `traceability.enabled=false`, `traceability.lock_file`, and `traceability.evaluator_agent` were ignored at runtime.

Fix:

- `src/overlays/policy-gate/gate-overlay.ts` now respects task-level `enabled`.
- `src/overlays/confidence/confidence-overlay.ts` now respects task-level `enabled`.
- `src/overlays/traceability/traceability-overlay.ts` now respects task-level:
  - `enabled`
  - `lock_file`
  - `evaluator_agent`

- Regression coverage added in:
  - `tests/overlays/policy-gate.test.ts`
  - `tests/overlays/confidence-overlay.test.ts`
  - `tests/overlays/traceability/traceability-overlay.test.ts`

### 3. Repo claims and type-safety had drifted from runtime behavior

Problem:

- README/User Guide overlay-chain docs omitted `Traceability` and optional remote overlays.
- `tsc --noEmit` was failing even though `bun test` passed.
- `src/overlays/mcp/mcp-overlay-provider.ts` had an `exactOptionalPropertyTypes` violation in suppressed non-blocking responses.

Fix:

- Updated overlay-chain docs in:
  - `README.md`
  - `docs/USER_GUIDE.md`
- Fixed the MCP provider optional-field construction.
- Cleaned up test typing issues so the repo is typecheck-clean again.

## Residual Risks

### 1. Engine integration tests still validate HIL escalation generically, not via full real ReviewOverlay/PairedOverlay runs

Current state:

- Unit tests cover `ReviewOverlay` and `PairedOverlay` max-iteration behavior.
- Engine integration now covers the post-task `HIL` path generically.

Residual gap:

- There is still no end-to-end engine test that instantiates the real `ReviewOverlay` or `PairedOverlay`, drives them to max iterations, and asserts the final `HIL_PENDING`/resolution flow.

Impact:

- Low to medium. The critical mapping path is now covered, but a full integration test would better protect against future regressions across overlay + provider + engine boundaries.

## Recommended Next Step

Add one engine-level integration test for each of:

- `ReviewOverlay` max-iterations -> `HIL_PENDING`
- `PairedOverlay` max-iterations -> `HIL_PENDING`
