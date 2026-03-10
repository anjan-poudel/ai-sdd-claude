# ROA-T-008: Engine Integration (`src/core/engine.ts`)

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Component I — `src/core/engine.ts`
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** ROA-T-001, ROA-T-002, ROA-T-004, ROA-T-007
- **Blocks:** ROA-T-009, ROA-T-010
- **Requirements:** FR-007, FR-009, NFR-002, NFR-003
- **Status:** COMPLETE — engine integration is implemented; status CLI CANCELLED display and overlay_evidence in status --json need verification

## Description

Integrate the provider chain into `src/core/engine.ts`. The engine is the single
enforcement point for translating `OverlayDecision` verdicts into task state transitions
via `applyPreDecision` and `applyPostDecision`. No provider, chain runner, or wrapper
may call `StateManager.transition()` directly.

**`Engine` constructor** receives `providerChain: OverlayProvider[] = []` as a final
parameter (default empty for backward compatibility).

**`applyPreDecision`** (exhaustive switch over `OverlayVerdict`):
- `PASS` → return `"CONTINUE"` (continue to agent dispatch)
- `REWORK` → `RUNNING → NEEDS_REWORK` → emit `task.rework` → `NEEDS_REWORK → RUNNING` → return `"NEEDS_REWORK"`
- `FAIL` → `RUNNING → FAILED` → emit `task.failed` → persist evidence → return `"FAILED"`
- `HIL` → `RUNNING → HIL_PENDING` → emit `task.hil_pending` → `awaitResolution` → return `"HIL_AWAITING"`

**`applyPostDecision`** (exhaustive switch):
- `PASS` → return `"PASS"` (continue to COMPLETED)
- `REWORK` → cycle to NEEDS_REWORK → return `"NEEDS_REWORK"`
- `FAIL` → fail → return `"FAILED"`
- `HIL` → treated conservatively as `REWORK`

Both functions must use a `never` default branch that causes TypeScript compilation failure
if a new `OverlayVerdict` is added without a handler.

**Evidence persistence**: when `OverlayDecision.evidence` is non-null, write it to
`TaskState.overlay_evidence` during the `stateManager.transition()` call. The evidence
must be visible in `ai-sdd status --json` output.

**HIL resume path** (unchanged from pre-feature): on `--resume` with a `HIL_PENDING`
task, skip the pre-overlay chain and call `awaitResolution` directly using the stored
`hil_item_id`. Access the HIL overlay via `providerChain.find(p => p.id === "hil" &&
p.runtime === "local") as LocalOverlayProvider | undefined`.

## Files to create/modify

| File | Action |
|------|--------|
| `src/core/engine.ts` | Modify — add `providerChain` constructor param, `applyPreDecision`, `applyPostDecision`, evidence persistence |
| `src/cli/commands/status.ts` | Modify — include `overlay_evidence` in `--json` output, CANCELLED display |

## Acceptance criteria

```gherkin
Feature: Engine verdict-to-state mapping

  Scenario: PASS verdict continues execution without state change
    Given a task in RUNNING state
    And runPreProviderChain returns OverlayDecision with verdict PASS
    When the engine calls applyPreDecision
    Then the task status remains RUNNING
    And execution proceeds to agent dispatch

  Scenario: REWORK verdict from pre-task chain cycles the task
    Given a task in RUNNING state
    And runPreProviderChain returns verdict REWORK with feedback "Scope drift detected"
    When the engine calls applyPreDecision
    Then the task transitions to NEEDS_REWORK
    And a task.rework event is emitted with the feedback message

  Scenario: FAIL verdict from pre-task chain terminates the task with evidence
    Given a task in RUNNING state
    And runPreProviderChain returns verdict FAIL with non-null evidence
    When the engine calls applyPreDecision
    Then the task transitions to FAILED
    And a task.failed event is emitted
    And the evidence is written to TaskState.overlay_evidence
    And getTaskState returns overlay_evidence on subsequent reads

  Scenario: HIL verdict transitions task to HIL_PENDING
    Given a task in RUNNING state
    And runPreProviderChain returns verdict HIL
    When the engine calls applyPreDecision
    Then the task transitions to HIL_PENDING
    And a task.hil_pending event is emitted

  Scenario: New OverlayVerdict without engine handler causes compile failure
    Given OverlayVerdict is extended with a new value "ESCALATE"
    When applyPreDecision has no case for "ESCALATE"
    Then TypeScript compilation fails with an exhaustive check error

  Scenario: overlay_evidence visible in ai-sdd status --json
    Given a task that produced OverlayDecision with evidence
    When "ai-sdd status --json" is run
    Then the JSON output includes overlay_evidence for that task

  Scenario: HIL resume skips pre-overlay chain
    Given a persisted state where a task is in HIL_PENDING with a valid hil_item_id
    When the engine resumes the workflow with --resume
    Then the pre-overlay chain is not invoked for that task
    And awaitResolution is called directly with the stored hil_item_id

  Scenario: buildProviderChain is called at startup and chain is passed to runPreProviderChain
    Given a workflow with an Engine constructed using buildProviderChain output
    When a task runs and the provider chain is non-empty
    Then runPreProviderChain is invoked with the built chain (not an empty array)
```

## Implementation notes

- Exhaustive switch `never` default (both `applyPreDecision` and `applyPostDecision`):
  ```typescript
  default: {
    const _exhaustive: never = verdict;
    throw new Error(`Unhandled OverlayVerdict: ${String(_exhaustive)}`);
  }
  ```
- Identity fields in `updated_context` are stripped by `mergeContextUpdate` in the chain
  runner before the engine ever sees them. The engine does not re-apply identity stripping.
- Development Standards §2 integration test (review-l2 Recommendation 4): there must be
  at least one test verifying `buildProviderChain` is called at engine startup and the chain
  is passed to `runPreProviderChain`. This test belongs in `tests/engine.test.ts` (extended).
- Review-l2 Recommendation 6: `overlay_evidence` must be included in the `ai-sdd status --json`
  output serializer. The `TaskState` type already has `overlay_evidence?` — the status command
  must not strip it from the JSON output.
- Review-l2 Recommendation 5: CANCELLED display in `ai-sdd status` is covered by ROA-T-002
  but the integration test asserting separate display belongs here with the engine tests.

## Definition of done

- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by tests in `tests/engine.test.ts` (extended)
- [ ] Integration test verifying `buildProviderChain` wires into engine (Development Standards §2)
- [ ] `overlay_evidence` visible in `ai-sdd status --json` (review-l2 Recommendation 6)
- [ ] `bun run typecheck` passes — exhaustiveness check verified at compile time
- [ ] `bun test` shows all 505+ existing tests still pass (NFR-004)
