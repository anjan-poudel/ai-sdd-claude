# Review of Merged Coding Standards Proposal

**File Reviewed:** `specs/merge-coding-standards/merged-claude.md`
**Date:** 2026-03-04

## 1. Overall Assessment

The merged proposal is exceptionally well-structured, comprehensive, and demonstrates a high degree of planning maturity. It successfully synthesizes the strongest elements from three different AI-generated proposals (`claude.md`, `codex.md`, `deepseek.md`) into a coherent and actionable implementation plan.

The choice of `claude.md` as a foundation is well-justified by its direct relevance and fidelity to the existing `ai-sdd` codebase. The discipline shown in rejecting features that would compromise architectural invariants (e.g., `VALID_TRANSITIONS`) or introduce redundancy is a significant strength.

The plan is ambitious but phased logically to manage risk, starting with documentation and configuration wins and progressively adding more complex components like new overlays and CLI commands.

## 2. Pros

*   **Disciplined Synthesis:** The document doesn't just combine features; it selectively integrates the best ideas (e.g., `codex.md`'s tristate governance flag, `deepseek.md`'s sub-gate naming) while rigorously defending the core architecture.
*   **Code-level Specificity:** The proposal provides concrete file paths, TypeScript snippets, and type definitions, removing ambiguity and making the plan immediately actionable for developers.
*   **Risk Mitigation:** The phased rollout, focus on additive changes, and making new features (like the `PlanningReviewOverlay`) opt-in are excellent strategies for minimizing disruption and risk.
*   **Clarity and Structure:** The use of sections like "What NOT to Merge," "Success Metrics," and "Explicit Non-Goals" provides exceptional clarity of purpose and scope. The Feature-to-File map is a highly useful reference.
*   **Measurable Progress:** Each phase includes clear exit criteria, and the project as a whole is framed by the success metrics adopted from `codex.md`.

## 3. Cons & Potential Risks

*   **Implementation Complexity & Effort:** The scope of work is significant. The time estimates (e.g., 5–8 days for Phase 3) appear optimistic given the creation of a new overlay, a new multi-command CLI, and external tool integrations. This phase, in particular, carries a risk of schedule overrun.
*   **Brittleness of `handover_state` Contract:** The plan relies on agents correctly populating fields like `ac_coverage`, `new_files_created`, and `loc_delta` within the `handover_state`. The code example `as Record<string, unknown>` indicates this is not a strongly typed contract. An agent failing to provide this data in the expected format could cause the new policy gates to fail silently or malfunction.
*   **Potential for New Bottlenecks:** The `PlanningReviewOverlay` introduces a synchronous review step that could slow down workflows. While it is opt-in, for teams that adopt it, the performance and reliability of the `reviewer_agent` become critical path.
*   **Increased Cognitive Load:** The introduction of numerous new concepts (governance modes, spec locks, budgets, ACs, planning reviews) will require significant effort in documentation and training for development teams to adopt them effectively.

## 4. Synthesis & Recommendations

The existing document is already an excellent synthesis. The following recommendations aim to refine the plan further to de-risk implementation and enhance robustness.

*   **Recommendation 1: Formalize the `handover_state` Schema for Gates.**
    *   **Problem:** The reliance on loosely-typed `handover_state` properties for budget and AC coverage checks is potentially brittle.
    *   **Proposal:** Introduce a new, strongly-typed interface in `src/types/index.ts`, such as `GatedHandoverState`, which explicitly defines optional fields for `ac_coverage: Record<string, boolean>`, `new_files_created: number`, `loc_delta: number`, etc. The `PolicyGateOverlay` and `complete-task` command should then validate that the received `handover_state` conforms to this interface before processing the gates. This turns a runtime dependency into a type-safe, explicit contract.

*   **Recommendation 2: De-risk Phase 3 by sequencing sub-tasks.**
    *   **Problem:** Phase 3 is very dense, combining a CLI, an overlay, and MCP tools.
    *   **Proposal:** Explicitly sequence the work within Phase 3.
        1.  **3a: Implement the `ai-sdd traceability` CLI.** Build and test this as a standalone tool first. Its functionality is foundational for the other features.
        2.  **3b: Implement the MCP tools.** Once the CLI works, wire it up to the MCP server. This is a small, dependent step.
        3.  **3c: Implement the `PlanningReviewOverlay`.** This is a separate, parallelizable piece of work.
        4.  **3d: Implement the AC coverage gate.** This has dependencies on the governance flag from Phase 2 and is the final piece.
        This sequencing makes progress more granular and easier to track.

*   **Recommendation 3: Add a "Documentation & Onboarding" Task.**
    *   **Problem:** The plan focuses entirely on implementation, but the new features will be useless without developer adoption.
    *   **Proposal:** Add a task, perhaps as part of Phase 4, to create or update a user guide that explains the new governance and traceability features, how to configure them, and the value they provide. This ensures the investment in building these features pays off.
