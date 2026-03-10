# ROA-T-001: Overlay Protocol Types (`src/types/overlay-protocol.ts`)

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Component A — `src/types/overlay-protocol.ts`
- **Effort:** S
- **Risk:** MEDIUM
- **Depends on:** —
- **Blocks:** ROA-T-002, ROA-T-003, ROA-T-004, ROA-T-005, ROA-T-006, ROA-T-007, ROA-T-008
- **Requirements:** FR-001, FR-002, NFR-003, NFR-004
- **Status:** COMPLETE — file exists and passes typecheck

## Description

Define the canonical transport-agnostic types for the overlay protocol in
`src/types/overlay-protocol.ts` and re-export them from `src/types/index.ts`.
This file is the single source of truth for `OverlayProvider`, `OverlayDecision`,
`OverlayVerdict`, `OverlayInvokeOutputSchema`, and `OverlayInvokeInput`. No other
file may define these types.

The `OverlayVerdict` must be a string union (not a TypeScript `enum` keyword) to
enable compile-time exhaustiveness checking. The `OverlayInvokeOutputSchema` uses
`z.literal("1")` so a protocol version mismatch always causes Zod validation failure
and is not overrideable by `failure_policy`.

## Files to create/modify

| File | Action |
|------|--------|
| `src/types/overlay-protocol.ts` | Create |
| `src/types/index.ts` | Modify — add `export * from "./overlay-protocol.ts"` and `CANCELLED` to `TaskStatus` |

## Acceptance criteria

```gherkin
Feature: Overlay protocol types

  Scenario: OverlayVerdict is a string union enabling exhaustiveness checks
    Given the OverlayVerdict type definition
    When a switch statement handles all four values without a default branch
    Then TypeScript compilation succeeds
    And when a fifth value is added without a handler TypeScript compilation fails

  Scenario: OverlayInvokeOutputSchema rejects protocol_version "2"
    Given a raw response with protocol_version "2" and verdict "PASS"
    When OverlayInvokeOutputSchema.safeParse processes it
    Then success is false
    And the error path contains "protocol_version"

  Scenario: Types are re-exported from src/types/index.ts
    Given an import of OverlayProvider from "src/types/index.ts"
    When the TypeScript compiler resolves the import
    Then it resolves to the definition in overlay-protocol.ts
```

## Implementation notes

- `updated_context` is typed as `Partial<AgentContext>` (not `Record<string, unknown>`)
  to prevent remote providers from injecting arbitrary keys. See NFR-003.
- `OverlayContext` in this file is structurally identical to `OverlayContext` in
  `base-overlay.ts`. Both must be kept in sync. The migration of `base-overlay.ts`
  to import from here is out of scope for this release.
- The `CANCELLED` `TaskStatus` addition belongs in `src/types/index.ts` (Component H),
  not in `overlay-protocol.ts`. Both are in this task because both touch `src/types/index.ts`.

## Definition of done

- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests in `tests/overlays/overlay-protocol.test.ts`
- [ ] `bun run typecheck` passes with zero errors
- [ ] `bun test` shows all 505+ existing tests still pass (NFR-004 regression gate)
