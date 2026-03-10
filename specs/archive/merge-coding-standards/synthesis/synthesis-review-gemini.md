# Review and Synthesis of Merged Proposals

**Files Reviewed:**
- `specs/merge-coding-standards/merged-claude.md`
- `specs/merge-coding-standards/merged-codex.md`

**Date:** 2026-03-04

## 1. Overall Assessment

Both documents successfully merge features from the three original AI proposals into phased implementation plans. However, they operate at different levels of abstraction and fidelity.

**`merged-claude.md` is a superior document and should be considered the canonical engineering specification.** It is deeply integrated with the `ai-sdd` codebase, providing specific file paths, code snippets, and type definitions. Its analysis is more rigorous, as it correctly identifies and rejects hallucinated modules from the source proposals.

**`merged-codex.md` serves as a higher-level project roadmap.** It provides a good strategic overview and a useful summary backlog, but it lacks the detail required for direct implementation and uncritically inherits flaws from its source material.

This review will break down the pros and cons of each and propose a synthesis that incorporates the few strategic strengths of `merged-codex.md` into the technically superior `merged-claude.md`.

---

## 2. Review of `merged-claude.md`

This document is founded on `claude.md`, citing its high fidelity to the existing codebase as the primary rationale.

#### Pros

*   **High Fidelity & Actionable:** Provides exact file paths, TypeScript type definitions, and code snippets, making the plan unambiguous and ready for developers to implement.
*   **Architecturally Sound:** Shows strong discipline in rejecting proposals that would violate core architectural invariants, such as the `VALID_TRANSITIONS` state machine. The "What NOT to Merge" section is a key strength.
*   **Rigorous Vetting:** Correctly identifies that the `tools/validators` and `tools/query-engine` modules mentioned in the `codex.md` proposal do not exist (were hallucinated) and excludes them.
*   **Clear Phasing with Exit Criteria:** The four-phase plan is logical, and each phase has concrete, verifiable exit criteria.
*   **Comprehensive:** Successfully integrates the best ideas from all three source documents, such as the tristate governance flag (`codex`) and sub-gate naming (`deepseek`).

#### Cons

*   **Dense:** The sheer level of detail can make it hard to quickly grasp the high-level strategy without a careful read.
*   **Slightly Less Optimal Phasing:** It places the MCP tool integration in Phase 3, delaying a potentially quick win that could provide value earlier.

---

## 3. Review of `merged-codex.md`

This document is founded on `codex.md`, citing its implementation focus and clear sequencing as the rationale.

#### Pros

*   **Good High-Level Summary:** The A-E phasing provides a clear, strategic overview of the project's flow.
*   **Actionable Backlog:** The "Immediate Implementation Backlog (First 10 Tickets)" is an excellent feature, translating the plan into a concrete list of initial tasks.
*   **Good Phasing Idea:** Introduces a "Phase 0" for MCP/Traceability enablement, which is a smart move to front-load the delivery of tooling value.

#### Cons

*   **Lacks Implementation Detail:** The plan is too high-level. A developer could not begin work from this document alone without significant further research.
*   **Inherits Flaws:** It uncritically includes the integration of `tools/validators` and `tools/query-engine`, which `merged-claude.md` correctly identified as non-existent. This indicates a less thorough vetting process and poses a significant planning risk.
*   **Less Grounded:** The proposal is not as clearly tied to the existing `ai-sdd` codebase, making its recommendations feel more abstract.

---

## 4. Synthesis and Proposal

The two documents are not mutually exclusive; `merged-claude.md` is the "how" (technical spec) and `merged-codex.md` is a "what" (project plan). The technically superior and more accurate document should be the source of truth.

**Proposal: Adopt `merged-claude.md` as the canonical plan, amended with two key improvements from `merged-codex.md`.**

### Recommended Amendments to `merged-claude.md`:

1.  **Re-Phase to Deliver MCP Tools Earlier:**
    *   Adopt the "Phase 0" concept from `merged-codex.md`.
    *   **Action:** Move the "New MCP tools" task (currently in Phase 3.2 of `merged-claude.md`) into a new, earlier phase. It should happen right after the `traceability` CLI is built, allowing the value from that new command to be exposed to IDE users immediately. This de-risks the integration and accelerates value delivery.

2.  **Add an Initial Ticket Backlog:**
    *   `merged-codex.md` provides an excellent, actionable list of the first 10 tickets.
    *   **Action:** Add a new section to the end of `merged-claude.md` titled "Initial Implementation Backlog" and incorporate a similar list. This would give project managers and developers a clear, summarized starting point without detracting from the detailed technical plan.

By making these two minor additions, we can combine the strategic foresight of `merged-codex.md` with the technical rigor and accuracy of `merged-claude.md`, resulting in a single, truly exceptional planning document.
