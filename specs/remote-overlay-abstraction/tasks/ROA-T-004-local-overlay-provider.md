# ROA-T-004: LocalOverlayProvider (`src/overlays/local-overlay-provider.ts`)

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Component B — `src/overlays/local-overlay-provider.ts`
- **Effort:** S
- **Risk:** HIGH
- **Depends on:** ROA-T-001
- **Blocks:** ROA-T-005, ROA-T-007
- **Requirements:** FR-001, FR-002, NFR-004
- **Status:** COMPLETE — file exists and all verdict mappings are implemented

## Description

Implement `LocalOverlayProvider` as a backward-compatibility shim that wraps an
existing `BaseOverlay` in the `OverlayProvider` interface. The engine and chain runner
must treat local and remote providers identically through the same `OverlayProvider`
call site. Zero behavioral changes to existing overlays (`HilOverlay`, `PolicyGateOverlay`,
`ConfidenceOverlay`, `ReviewOverlay`, `PairedOverlay`).

Key behaviors:
- Constructor detects which hooks are present (`typeof overlay.preTask === "function"`)
  and throws `TypeError` if neither `preTask` nor `postTask` is implemented.
- `invokePre` and `invokePost` are assigned as class methods only when the relevant hook
  is present; they are `undefined` otherwise.
- `enabled` is a live getter — not cached — reflecting `overlay.enabled`.
- `inner` exposes the wrapped `BaseOverlay` for the engine's HIL `awaitResolution` path.

The `OverlayResult` to `OverlayDecision` mapping must be deterministic:
- `proceed: true` → `PASS`
- `proceed: false, hil_trigger: true` → `HIL`
- `proceed: false, hil_trigger: false/undefined` → `REWORK`
- `accept: true` → `PASS`
- `accept: false, new_status: "COMPLETED"` → throws `TypeError` (engine-only transition)
- `accept: false, new_status: "FAILED"` → `FAIL`
- `accept: false, new_status: undefined/"NEEDS_REWORK"` → `REWORK`

## Files to create/modify

| File | Action |
|------|--------|
| `src/overlays/local-overlay-provider.ts` | Create |

## Acceptance criteria

```gherkin
Feature: LocalOverlayProvider wrapping and verdict mapping

  Scenario: Constructor rejects overlay with no hooks
    Given a BaseOverlay instance that implements neither preTask nor postTask
    When it is wrapped in a LocalOverlayProvider
    Then the constructor throws a TypeError
    And the error message contains the overlay name and states at least one hook method is required

  Scenario: proceed true maps to PASS
    Given a BaseOverlay whose preTask returns proceed: true
    When LocalOverlayProvider.invokePre is called
    Then the OverlayDecision has verdict "PASS"

  Scenario: proceed false with hil_trigger maps to HIL
    Given a BaseOverlay whose preTask returns proceed: false and hil_trigger: true
    When LocalOverlayProvider.invokePre is called
    Then the OverlayDecision has verdict "HIL"

  Scenario: proceed false without hil_trigger maps to REWORK
    Given a BaseOverlay whose preTask returns proceed: false without hil_trigger
    When LocalOverlayProvider.invokePre is called
    Then the OverlayDecision has verdict "REWORK"

  Scenario: accept false with new_status COMPLETED throws TypeError
    Given a BaseOverlay whose postTask returns accept: false with new_status "COMPLETED"
    When LocalOverlayProvider.invokePost processes the result
    Then it throws a TypeError
    And the error message names the overlay and states only the engine may set COMPLETED

  Scenario: accept false with new_status FAILED maps to FAIL
    Given a BaseOverlay whose postTask returns accept: false with new_status "FAILED"
    When LocalOverlayProvider.invokePost is called
    Then the OverlayDecision has verdict "FAIL"

  Scenario: enabled getter reflects live overlay.enabled state
    Given a LocalOverlayProvider wrapping an overlay with enabled: true
    When the wrapped overlay's enabled property is set to false
    Then provider.enabled returns false without re-wrapping
```

## Implementation notes

- Error message contracts (tested by assertions):
  - No-hook TypeError: `"LocalOverlayProvider: overlay '${name}' declares no hooks (preTask/postTask). A provider must implement at least one hook method."`
  - COMPLETED rejection TypeError: `"LocalOverlayProvider: overlay '${name}' returned accept:false with new_status:\"COMPLETED\". Only the engine may transition a task to COMPLETED. Use accept:true instead."`
- The `toLegacyCtx()` function converts `OverlayContext` (new) to `LegacyContext` (base-overlay.ts).
  Both types are currently structurally identical; the function is the evolution boundary.
- NFR-004: This is the backward-compat shim. All 177 (now 505) pre-feature tests must pass
  after this refactor. Any behavioral regression in existing overlay outcomes is a bug.

## Definition of done

- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests in `tests/overlays/local-overlay-provider.test.ts`
- [ ] Error message strings verified by test assertions (Development Standards §5)
- [ ] `bun test` shows all 505+ existing tests still pass (NFR-004)
