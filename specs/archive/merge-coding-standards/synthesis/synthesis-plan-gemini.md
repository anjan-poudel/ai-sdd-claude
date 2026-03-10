# Synthesis Implementation Plan: Coding Standards Integration

**Date:** 2026-03-05
**Author:** Gemini Agent
**Based on:** `synthesis-review-claude-2.md`, `merged-claude.md`, `merged-codex.md`, and prior Gemini reviews.

---

## 1. Executive Summary and Foundation

### 1.1 Background: Architectural Integration Strategy

A fundamental architectural decision underpins this synthesis: **all governance features from `coding-standards` will be integrated natively into the existing `ai-sdd` architecture, primarily using the Overlay system.**

We explicitly reject importing new state machines or modifying the core execution engine. Instead:
- **Overlays for Governance:** New governance checks are implemented entirely within the existing overlay system. Post-task checks (like budget limits and scope drift) become new sub-gates inside the existing `PolicyGateOverlay`. Pre-task reviews are handled by a new `PlanningReviewOverlay` that slots into the existing overlay chain.
- **Same Engine & State Machine:** The core engine and the `VALID_TRANSITIONS` state machine remain strictly unmodified. New data fields (like `acceptance_criteria` or `budget`) are introduced as optional additions to the existing `TaskDefinition` schema, ensuring 100% backward compatibility.
- **Native CLI Integration:** Instead of porting external shell scripts or tools from the `coding-standards` repository, traceability and validation commands are built natively into the `ai-sdd` CLI (e.g., as `ai-sdd traceability`).

This approach ensures the project remains cohesive, type-safe (TypeScript), and maintains a single runtime architecture, rather than becoming a stitched-together hybrid of two different systems.

### 1.2 Synthesis Overview

This document serves as the canonical implementation plan for integrating the `coding-standards` governance model into the `ai-sdd` architecture. 

It synthesizes the high-fidelity technical specification from `merged-claude.md`, incorporates the strategic sequencing and backlog concepts from `merged-codex.md`, and directly addresses the critical gaps identified in the peer reviews (specifically the `handover_state` type safety issue and the native vs. porting integration decision).

**Core Strategic Decisions:**
1. **Native TypeScript Implementation:** We will implement the traceability and validation logic natively within `ai-sdd` (e.g., `src/cli/commands/traceability.ts`). We **reject** taking a cross-repo runtime dependency on `coding-standards/tools/` to preserve architectural cohesion and type safety.
2. **Architectural Invariance:** The `VALID_TRANSITIONS` state machine remains untouched. `REQUIREMENTS_VALIDATED` is rejected as a state. All new schema fields are `optional`.
3. **Opt-in to Enforce:** Governance features default to `warn` or are explicitly opt-in (`enabled: false`) to prevent breaking existing workflows during rollout.

---

## 2. Formalized Data Contracts (Addressing Review Gaps)

Before implementing logic, we must establish the strongly-typed data contracts that bridge the agents and the engine.

### 2.1 Schema Additions (`src/types/index.ts`)

```typescript
export type GovernanceMode = "off" | "warn" | "enforce";

export interface GovernanceConfig {
  requirements_lock?: GovernanceMode;
}

export interface AcceptanceCriterion {
  scenario: string;
  given: string | string[];
  when: string;
  then: string[];
  and?: string[];
}

export interface TaskBudget {
  max_new_files?: number;
  max_loc_delta?: number;
  max_new_public_apis?: number;
}

// Additions to existing TaskDefinition (all optional):
// acceptance_criteria?: AcceptanceCriterion[];
// requirement_ids?: string[];
// scope_excluded?: string[];
// budget?: TaskBudget;
// phase?: string;
```

### 2.2 The `GatedHandoverState` Interface

To ensure policy gates do not fail silently due to missing data, we formalize the expected output from agents when governance features are active.

```typescript
export interface GatedHandoverState {
  ac_coverage?: Record<string, boolean>;   // keyed by AcceptanceCriterion.scenario
  new_files_created?: number;
  loc_delta?: number;
  new_public_apis?: number;
  tests_passed?: boolean;
  blockers?: string[];
}
```
*Note: The `PolicyGateOverlay` and `complete-task` must validate against this interface and emit a `governance.handover_state.untyped` warning if agents fail to provide it.*

---

## 3. Phased Implementation Plan

### Phase 1: Zero-Code Foundations (Days 1-2)
**Goal:** Establish behavioral guardrails via prompts and templates.

1.  **Agent Constitution:** Create `data/integration/claude-code/agents/constitution.md`. Crucially, add instructions detailing how agents must populate the `GatedHandoverState` when `budget` or `acceptance_criteria` are present in their task. Specify that the BA agent owns the initial `requirements.lock.yaml`, the Architect regenerates it, and the Human approves it.
2.  **GO Protocol:** Update `sdd-scaffold.md` and `ba.md` with the 90% confidence threshold and explicit "GO" protocol.
3.  **Toolgate Template:** Add `data/integration/toolgate.yaml` (copied via `ai-sdd init`).
4.  **Convention:** Document the `plans/<feature>/` directory convention in `CLAUDE.md`.

### Phase 2: Core Governance & Policy Gates (Days 3-5)
**Goal:** Implement the data structures, configuration flags, and post-task drift checks.

1.  **Config & Types:** Implement the types defined in Section 2 and add `governance.requirements_lock` (defaulting to `warn`) to `ai-sdd.yaml`.
2.  **Spec Hash Tracking:** Update `src/core/engine.ts` `run()` startup to hash `requirements.lock.yaml` (if present) and store `spec_hash` in `workflow-state.json`.
3.  **Gate 2 (Scope Drift):** Implement in `PolicyGateOverlay.postTask` to check output against `scope_excluded`.
4.  **Gate 2b (Budget):** Implement in `PolicyGateOverlay.postTask` using the strongly-typed `GatedHandoverState`.

### Phase 3: Traceability, Review Overlay, and MCP (Days 5-8)
**Goal:** Build native traceability tooling and pre-dispatch planning reviews.
*Note: Strict sequencing applies here.*

1.  **3a. Native Traceability CLI:** Build `src/cli/commands/traceability.ts` (subcommands: `validate-lock`, `gaps`, `coverage`, `report`). `gaps` should exit non-zero *only* on critical gaps (unlinked requirements or unlinked tasks).
2.  **3b. MCP Tool Registration:** Extend `src/integration/mcp-server/server.ts` to register `validate_requirements_lock` and `check_scope_drift`, delegating to the CLI commands built in 3a.
3.  **3c. Planning Review Overlay:** Build `src/overlays/planning-review/planning-review-overlay.ts`.
    *   Add config: `phases: [planning, design]` to restrict when it runs.
    *   Require structured JSON response from the reviewer agent: `{"planning_review": "APPROVED" | "NEEDS_WORK", "reason": "..."}`.
    *   Handle parse failures gracefully (emit event, respect `block_on_needs_work`).
    *   Update `src/overlays/composition-rules.ts` chain order.
4.  **3d. AC Coverage Gate:** Add Step 2.5 to `src/cli/commands/complete-task.ts` to enforce AC coverage (respecting the `governance.requirements_lock` tristate).

### Phase 4: Tooling, CI/CD, and Operations (Days 3-5)
**Goal:** Provide the scripts and configuration for continuous enforcement.

1.  **Drift Scripts:** Adapt and add `reproducibility-check.sh` and `semantic-drift-check.sh` to `data/integration/scripts/`.
2.  **Budget Check:** Add `check-budgets.sh`.
3.  **CI/CD Template:** Add GitHub Actions template `data/integration/.github/workflows/ai-sdd-gates.yml`. **Crucial:** Include a step that explicitly checks for the existence of the scripts and fails with "Run ai-sdd init first" if missing.
4.  **Routing:** Implement phase-based model routing in `src/adapters/factory.ts`.
5.  **Task Library:** Add `data/task-library/regenerate-requirements-lock.yaml`.

---

## 4. Success Metrics

**Technical:**
1.  **Determinism:** PR gate outcomes are deterministic (0 flaky gate runs).
2.  **Drift Catch Rate:** > 80% of scope-drift class issues are caught by Gate 2 before merge (measured against a 4-sprint baseline after Phase 2 deploy).
3.  **Traceability:** Critical-gap count trends downward release-over-release.

**Adoption & Impact:**
1.  **Enforcement:** % of projects using `requirements.lock.yaml` with `governance.requirements_lock: enforce`.
2.  **Rework Reduction:** `NEEDS_REWORK` rate for tasks in workflows that have `PlanningReviewOverlay` enabled decreases by at least 15% within 60 days of Phase 3 completion (compared to pre-adoption baseline).

---

## 5. Explicit Exclusions

*   No cross-repo runtime dependency on `coding-standards/tools/`.
*   No new task states (e.g., `REQUIREMENTS_VALIDATED`).
*   No replacement of the `VALID_TRANSITIONS` state machine.
*   No MCP registration without backing implementation.
*   No `greenfield|brownfield` undocumented flags.