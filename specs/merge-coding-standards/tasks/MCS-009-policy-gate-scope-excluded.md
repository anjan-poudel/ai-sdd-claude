# MCS-009: Policy Gate Enforcement for `scope_excluded`

**Phase:** C (Traceability + Policy Gate Expansion)  
**Status:** DRAFT  
**Dependencies:** MCS-001  
**Size:** M (2 days)

## Context

Merged proposal calls out active gold-plating prevention by rejecting excluded-scope terms.

## Scope

1. Extend task schema with `scope_excluded?: string[]`.
2. Add post-task gate check in `src/overlays/policy-gate/gate-overlay.ts`:
   - scan agent output evidence for excluded terms
   - fail gate on violations
3. Ensure failure reason is explicit and actionable.

## Acceptance Criteria

1. Tasks with `scope_excluded` fail gate when excluded terms appear.
2. Tasks without `scope_excluded` maintain existing behavior.
3. Gate failure details include matched terms.
4. Tests cover positive/negative cases.

## Deliverables

1. Type/schema updates for task definition.
2. Policy gate logic updates.
3. Overlay tests for excluded-term enforcement.

