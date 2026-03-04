# Review Feedback: ai-sdd-synthesis-2-claude

**Reviewer:** Gemini CLI
**Date:** February 27, 2026
**Subject:** Deep Analysis of the Modular SDD Framework Specification

---

## 1. Executive Summary

The `ai-sdd-synthesis-2-claude` specification represents a significant evolution from the original `sdd-unified` project. By decomposing the monolithic orchestration into a modular "Core Engine + Overlays" architecture, it successfully transforms a specific tool into a general-purpose framework. 

The introduction of **Canonical Contracts**, a **Safe Expression DSL**, and **Artifact Contracts** provides the rigorous engineering foundation required for reliable agentic workflows. However, while the architectural "bones" are excellent, there are nuances in the **Native Integration** and **Context Management** strategy that require further refinement to avoid operational friction.

---

## 2. Strengths & Innovations

### 2.1 The "Pull Model" for Context Management (T016)
The decision to abandon a complex `ContextReducer` (summarization/embedding) in favor of an **Artifact Manifest** in the constitution is a masterstroke of "less is more" engineering.
- **Why it works:** It leverages the native tool-calling capabilities (Grep, Read) of modern agents (Claude Code, Roo Code).
- **Benefit:** It keeps the engine "thin" and avoids the "lossy compression" problem of summarization. The agent—not the engine—is the best judge of what context is relevant to the task at hand.

### 2.2 Formal Expression DSL (T012)
Moving away from raw string evaluation to a formal, whitelist-only grammar is a critical security upgrade.
- **Why it works:** It prevents prompt injection from escalating into arbitrary code execution via `eval()`.
- **Benefit:** It allows for "dry-run" validation of complex loop logic without executing a single LLM call.

### 2.3 Transactional Task Completion (Contract-First)
The `ai-sdd complete-task` boundary (Contract 7) is exceptionally well-defined.
- **Why it works:** By coupling file writes, state updates, and constitution manifest updates into a single atomic transaction, it ensures that the "Source of Truth" (filesystem) and "State of Truth" (JSON) never drift.

---

## 3. Critical Feedback & Identified Risks

### 3.1 The "Adapter Responsibility" Ambiguity
While the `RuntimeAdapter` ABC exists, the boundary of *who* manages the prompt is still slightly blurred.
- **Risk:** If the `ai-sdd` engine constructs the full system prompt (including constitutions) and sends it to the adapter, we might clash with the "Native Integration" (Phase 3) where the tool (e.g., Claude Code) *also* has its own system prompt and context management.
- **Suggestion:** Clarify if the adapter sends a *completion request* (raw LLM) or a *prompt instruction* (to another agent). If it's the latter, `ai-sdd` should likely act as a "Context Provider" rather than a "Context Wrapper."

### 3.2 The "T2 Tier" Human Bottleneck
The specification mandates that T2 risk tiers *always* require human sign-off.
- **Risk:** In a highly parallel workflow (concurrency budget > 1), a single T2 task can stall the entire DAG if the HIL queue isn't actively monitored, leading to "orchestrator deadlock."
- **Suggestion:** Introduce a "HIL Notification Hook" or a "Heartbeat" mechanism that can ping external systems (Slack, Email) when a T2 gate is reached, rather than relying on the user to manually run `ai-sdd hil list`.

### 3.3 Artifact Versioning Complexity
The artifact contract uses versioned types (e.g., `requirements_doc@1`).
- **Risk:** For small-to-medium projects, maintaining a central `artifact_types` registry may feel like "schema-overhead" that discourages adoption.
- **Suggestion:** Support "In-line Contracts" or "Inferred Contracts" for local tasks where the schema is simple, reserving the versioned registry for shared, cross-team artifacts.

---

## 4. Strategic Suggestions for Implementation

### 4.1 "Serena" as the Preferred Context Engine
Given the project context mentions `.serena/` and memories, the **Artifact Manifest Writer** (T016) should be designed to be "Serena-compatible."
- **How:** Instead of just a table in `constitution.md`, the manifest could be output in a structured format that a Serena-powered agent can index directly for long-term memory.

### 4.2 The "Agent Switch" Latency
In `ai-sdd`, every task is a fresh dispatch.
- **Observation:** If `design-l1` and `design-l2` use the same agent, spawning a new adapter process (e.g., a new `claude-code` session) for each task adds significant overhead (15-30s per task).
- **Suggestion:** The `RuntimeAdapter` should support a **Persistent Session** mode for tasks that share the same agent persona and sequence, allowing the orchestrator to "handoff" the live process.

### 4.3 Validation of "Security Redaction" (T017)
The output sanitizer is mentioned for redacting secrets.
- **Suggestion:** This should be a **Blocking Gate**, not just a post-processing step. If a secret is detected in an agent's output, the task should transition to `NEEDS_REWORK` automatically with a feedback message: "Output rejected: contains potential credentials." This forces the agent to fix the leak before it ever hits the filesystem.

---

## 5. Conclusion

The Level-2 Synthesis is a robust, production-ready blueprint. It solves the biggest pain point of `sdd-unified` (rigidity) by introducing a pluggable overlay system and a tool-agnostic core. 

**Next Steps Recommendation:** 
Focus Phase 1 implementation specifically on the **Expression DSL** and the **RuntimeAdapter ABC**. If these two contracts are solid, the rest of the framework (overlays, native tools) will fall into place as simple extensions. 

**Verdict:** **Approved.** The specification is deep, thoughtful, and addresses the critical "Gaps" identified in previous iterations.