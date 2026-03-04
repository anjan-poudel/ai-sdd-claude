# Review of ai-sdd-synthesis-2-claude Spec

**Reviewer:** Claude
**Date:** 2026-02-27
**Scope:** Level-2 synthesis of ai-sdd-synthesized-{claude, codex, gemini, deepseek}

## Overview

The ai-sdd-synthesis-2-claude spec represents a thoughtful synthesis of four independently generated plans for an AI-driven Specification-Driven Development (SDD) framework. This synthesis aims to create a modular, general-purpose, and flexible orchestration framework that can be integrated natively with AI coding tools (Claude Code, Codex, Roo Code). The spec is comprehensive, spanning five phases of development with detailed task breakdowns, effort estimates, and architectural diagrams.

## Key Strengths

### 1. **Comprehensive Gap Analysis**
The GAPS-ANALYSIS.md document identifies 10 critical gaps across the four source plans, with clear prioritization and proposed solutions. This demonstrates rigorous meta-analysis and ensures the synthesis addresses weaknesses that individual plans missed.

### 2. **Strong Safety and Security Focus**
- **Expression DSL (T012):** Formal grammar and safe evaluator eliminate `eval()` risks, addressing a critical security vulnerability in raw string exit conditions.
- **Artifact Contracts (T013):** Versioned typed I/O with compatibility checks prevent malformed handovers.
- **Prompt Injection Protection (T017):** Input/output sanitization pipeline with detection corpus.
- **Overlay Composition Tests (T014):** Pairwise matrix testing ensures deterministic behavior when multiple overlays are combined.

### 3. **Tools-First Architecture**
The shift from a heavy ContextReducer to a "pull model" using native tool capabilities (Read, Grep, Serena, MCP) is pragmatic and reduces framework complexity. The constitution-as-index approach leverages existing tooling rather than building custom summarization pipelines.

### 4. **Practical Native Integration Strategy**
Phase 3 dedicates effort to native integration with AI coding tools via slash commands, MCP servers, and static templates. The shared MCP server and tool schemas show thoughtful reuse across integration targets.

### 5. **Clear MVP Exit Criteria**
The 10-point MVP checklist (PLAN.md §8) provides concrete, verifiable success metrics, ensuring the framework delivers core value before expanding to advanced features.

### 6. **Realistic Effort Estimation**
T-shirt sizing with day estimates (from synthesized-deepseek) adds practical planning value, enabling realistic resource allocation.

## Weaknesses and Concerns

### 1. **Contract Inconsistencies**
As highlighted in REVIEW-FEEDBACK.md, several internal contradictions exist:
- **Idempotency key generation** includes `attempt` counter, breaking deduplication.
- **Tool selector naming** (`openai` vs `codex`) creates UX ambiguity.
- **Manifest ownership rules** conflict between auto-generated vs user-authored reading conventions.
- **Security config namespaces** inconsistent (`observability.secret_patterns` vs `security.custom_secret_patterns`).

These inconsistencies will cause implementation churn and potential runtime safety issues if not resolved before coding begins.

### 2. **Transaction Boundary Ambiguity**
The MCP `complete_task` flow writes files then executes commands non-atomically, risking partial completion and path traversal vulnerabilities. The spec needs explicit transaction definitions for all mutating operations.

### 3. **State Machine Gaps**
- **Missing `NEEDS_REWORK` state:** Policy gate failures leave tasks in `RUNNING` indefinitely, violating bounded-loop invariants.
- **Task lifecycle transitions** are not formally defined, leading to potential race conditions during retries and resume.

### 4. **Permissive Fallbacks Undermine Safety**
- Artifact contract registry missing fallback warns but continues, disabling the primary safety guarantee.
- Constitution parse failures are silently skipped, potentially dropping governance rules.

### 5. **Undefined LLM-as-Judge Independence**
When confidence scoring uses LLM-as-judge metrics, there's no policy on self-evaluation independence. This creates potential bias loops.

### 6. **Schema Migration Deferred**
While acknowledged as a gap, migration tooling is deferred to Phase 5. This risks breaking in-progress workflows during framework upgrades.

### 7. **Multi-Project/Shared Agent Registry Deferred**
The framework assumes single-project deployment; multi-project scenarios are uniformly deferred without roadmap notes.

## Suggestions for Improvement

### 1. **Create Canonical Contracts Appendix**
Add a single document (CONTRACTS.md) defining normalized names and enums:
- Tool names (`codex`, `claude_code`, `roo_code`)
- Adapter types (`openai`, `claude`, `gemini`)
- Task states (`PENDING`, `RUNNING`, `NEEDS_REWORK`, `HIL_PENDING`, `COMPLETED`, `FAILED`)
- HIL states (`PENDING`, `ACKED`, `RESOLVED`, `REJECTED`)
- Event types and CLI flags

This serves as the single source of truth for all implementations.

### 2. **Define Explicit Transaction Boundaries**
For each mutating operation (`run --task`, `complete_task`, HIL resolve):
- Specify atomic unit (what operations must succeed together)
- Define rollback behavior on partial failure
- Include path allowlist validation and sanitization steps

### 3. **Formalize Task State Machine**
Create a state diagram with allowed transitions, including:
- `RUNNING` → `NEEDS_REWORK` (policy gate failure)
- `NEEDS_REWORK` → `PENDING` (after rework)
- `RUNNING` → `HIL_PENDING` (human intervention required)
- Clear timeout/retry limits for each state

### 4. **Replace Permissive Fallbacks with Explicit Modes**
Introduce configuration modes:
- `strict` (default): hard failures for missing registry, malformed constitution
- `legacy`: permissive mode for migration, requires explicit flag `--allow-legacy-untyped-artifacts`

### 5. **Address LLM-as-Judge Independence**
Add policy rule: when `llm_judge` metric is used, the judging LLM must be different from the agent being evaluated (different model or at least different session). Document trade-offs.

### 6. **Front-Load Schema Migration Planning**
Even if implementation is deferred, design the versioning scheme and migration CLI interface in Phase 1. Include `version` fields in all schemas and state files from day one.

### 7. **Clarify Multi-Project Vision**
Add a brief roadmap note on multi-project support, even if deferred. Outline whether shared agent registries are per-organization, per-repository, or configurable.

### 8. **Enhance Security Requirements**
Add non-functional targets for security components:
- Max false-positive rate for injection detector (e.g., < 1%)
- Max sanitizer latency per artifact (e.g., < 100ms)
- Minimum fixture coverage by category (e.g., 20 patterns minimum)

### 9. **Improve CLI Consistency**
- Normalize `--tool codex` as CLI vocabulary; use `adapter.type: openai` internally
- Add missing `status --next` flag to T010 acceptance criteria
- Ensure all CLI commands are documented in a single reference

### 10. **Add Performance Budgets**
Beyond concurrency budgets, consider:
- Memory usage limits per adapter
- Maximum context size growth thresholds
- Timeout defaults per operation type

## Overall Assessment

**Grade: A-** (Excellent foundation with some refinement needed)

This synthesis represents a significant advancement over the original sdd-unified framework. The architectural decisions are sound, particularly the tools-first approach, expression DSL safety, and artifact contracts. The gap analysis is thorough, and the phased delivery plan is realistic.

**Primary Risk:** The internal inconsistencies noted in REVIEW-FEEDBACK.md must be resolved before implementation begins. These are not conceptual flaws but specification contradictions that will cause significant rework if discovered during coding.

**Recommendation:** Prioritize creating the Canonical Contracts Appendix and resolving the 9 findings from the Codex review. Once these contract issues are settled, the spec will be implementation-ready.

The framework has the potential to become a robust, production-grade orchestration layer for AI-assisted software development. With the suggested refinements, it could set a new standard for specification-driven development with AI tools.

---

## Action Items (Before Implementation)

1. **Resolve contract inconsistencies** (idempotency keys, tool naming, manifest ownership)
2. **Define transaction boundaries** for all mutating operations
3. **Formalize task state machine** with `NEEDS_REWORK` state
4. **Create Canonical Contracts Appendix** (CONTRACTS.md)
5. **Replace permissive fallbacks** with explicit strict/legacy modes
6. **Add security performance requirements**
7. **Normalize CLI vocabulary** and document all flags

Once these items are addressed, the spec will be exceptionally well-prepared for implementation.