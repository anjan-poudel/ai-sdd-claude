# MCS-002: Import and Adapt Drift + Spec-Hash Scripts

**Phase:** A (Quality Gate Foundation)  
**Status:** DRAFT  
**Priority:** P0  
**Dependencies:** MCS-001 (optional for enforcement mode wiring)  
**Size:** M (2-3 days)

## Context

`coding-standards` provides proven drift/reproducibility scripts.  
`ai-sdd` needs adapted versions that work with `.ai-sdd/` conventions and optional lock usage.

## Scope

Add and adapt:
1. `scripts/spec-hash.sh`
2. `scripts/spec-hash-verify.sh`
3. `scripts/reproducibility-check.sh`
4. `scripts/semantic-drift-check.sh`

Adaptation requirements:
1. Support `.ai-sdd/requirements.lock.yaml` path defaults.
2. Skip lock-specific checks when no lock exists and mode is not enforce.
3. Use repo-compatible test command (`bun test`) fallback.
4. Keep script output deterministic for CI parsing.

## Acceptance Criteria

1. All four scripts run locally without syntax/runtime errors.
2. Scripts return non-zero on configured failures.
3. Scripts return zero when checks pass or are intentionally skipped by mode.
4. README-level usage examples are added/updated.

## Deliverables

1. New/adapted scripts under `scripts/`.
2. Script usage section in project docs.
3. Basic script tests (or smoke-test CI step) validating exit behavior.

## Dependency Section

**Blocked by:**
1. MCS-001 (soft dependency; required only for enforce-mode coupling)

**Blocks:**
1. MCS-003
2. MCS-007
