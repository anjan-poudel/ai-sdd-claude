# ai-sdd Level-2 Gaps Analysis

**Date:** 2026-02-27
**Scope:** Gaps remaining after reviewing all 4 synthesized plans

---

## Method

Compared synthesized-{claude, codex, gemini, deepseek} for:
- Internal consistency (every requirement has a corresponding task)
- Completeness (every runtime behavior is specified)
- Safety (no security or correctness holes)
- Implementability (specs concrete enough to build without ambiguity)

---

## Gap Registry

### GAP-L2-001: Exit Conditions Are Unsafe Raw Strings
**Severity:** Critical (Security + Correctness)
**Identified by:** synthesized-codex
**Present in:** synthesized-claude, synthesized-gemini, synthesized-deepseek (all use raw strings)

**Problem:** Expressions like `"pair.challenger_approved == true"` or `"confidence_score >= 0.85"` are currently untyped string literals. Without a formal grammar and safe evaluator, they are either interpreted via Python `eval()` (prompt injection / code execution risk) or by ad-hoc string parsing (inconsistent behavior across overlays).

**Solution (T012):** Define a formal Expression DSL with:
- Supported operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `and`, `or`, `not`
- Bounded path lookups only (no function calls, no imports)
- Parser + safe evaluator (no `eval()` or `exec()`)
- Validation at workflow load time with clear error messages
- Golden test corpus for valid/invalid expressions

---

### GAP-L2-002: No Typed Artifact Contract for Task I/O
**Severity:** High (Reliability)
**Identified by:** synthesized-codex
**Present in:** synthesized-claude, synthesized-gemini, synthesized-deepseek

**Problem:** Tasks declare `outputs: ["requirements.md"]` as raw file paths. Downstream tasks consume these outputs without any type or schema check. A task that produces a malformed or missing output silently breaks all downstream consumers.

**Solution (T013):** Introduce versioned artifact contracts:
- `artifact.schema.yaml` defining expected structure/type per artifact kind
- Per-task `output_contract` declaration in workflow YAML
- Compatibility check before handover: producer's declared type must match consumer's expected type
- Validation errors surfaced in diagnostics before execution begins

---

### GAP-L2-003: Overlay Composition Behavior Not Guaranteed
**Severity:** High (Correctness)
**Identified by:** synthesized-codex
**Present in:** synthesized-claude, synthesized-gemini, synthesized-deepseek

**Problem:** Enabling multiple overlays (e.g., confidence + paired + policy gate) simultaneously can produce non-deterministic routing. No plan specifies the invariants that must hold across overlay combinations. Without a test matrix, composed overlays can silently conflict.

**Solution (T014):** Define and enforce an overlay composition matrix:
- Invariants: bounded loops, no silent promotion, deterministic routing
- Pairwise test matrix for all overlay combinations
- Golden trace fixtures for high-risk combinations (all overlays on, T2 tier)
- CI gate: pairwise matrix must pass before any overlay is merged

---

### GAP-L2-004: Adapter Error Behavior Is Undefined
**Severity:** High (Reliability)
**Identified by:** synthesized-codex
**Present in:** synthesized-claude (partial), synthesized-gemini, synthesized-deepseek

**Problem:** Each adapter (Claude Code, Codex, Gemini) has different error surfaces (rate limits, context limits, timeouts, content policy). Without a unified error taxonomy and retry contract, the engine's behavior on adapter failures is inconsistent and can break resume semantics.

**Solution (T015):**
- Unified adapter error taxonomy (network, rate_limit, context_limit, content_policy, timeout, unknown)
- Standardized timeout/retry/backoff defaults per error type
- Idempotency keys for safe retries
- Deterministic mapping from adapter error → engine task state (FAILED / PAUSED / RETRY)
- Contract tests that both mock and real adapters must pass

---

### GAP-L2-005: Context Window Growth Unmanaged
**Severity:** High (Scalability + Cost)
**Identified by:** synthesized-gemini
**Present in:** synthesized-claude, synthesized-codex, synthesized-deepseek

**Problem:** As a DAG progresses through 10+ tasks, each agent's context bundle grows unboundedly: constitution (N KB) + all prior task outputs + handover state. This leads to context limit errors, degraded LLM focus, and inflated cost. No plan specifies how to manage this.

**Solution (T016 — Constitution Artifact Manifest):**

Use a **pull model** rather than a push/reduction model. Keep the framework lightweight — no ContextReducer, no custom summarizer, no embedding pipeline.

The engine auto-writes an **artifact manifest section** into `constitution.md` after each task completes, listing all produced artifacts with their paths and statuses. Agents are instructed (via the constitution's reading convention) to read only what they need, using their native tools (Claude Code's Read/Grep, Roo Code via MCP, etc.).

This approach:
- Requires no new infrastructure
- Delegates context selection to the agent (which knows what it needs)
- Works natively with Claude Code, Roo Code, and any tool-capable runtime
- Keeps the engine thin — constitution writer is ~50 lines

---

### GAP-L2-006: No Step Execution / Interactive Debug Mode
**Severity:** Medium (Developer Experience)
**Identified by:** synthesized-gemini
**Present in:** synthesized-claude (dry-run only), synthesized-codex, synthesized-deepseek

**Problem:** Complex multi-agent DAGs are hard to debug. Dry-run mode shows the plan but doesn't execute. There is no way to advance one task at a time and inspect intermediate outputs without writing custom scripts.

**Solution:** Add `ai-sdd run --step` mode to T010 CLI spec:
- After each task completes, pause and show output before proceeding
- Allow operator to: continue (next task), skip (mark as COMPLETED without output), abort
- Step mode state persisted so it survives interruption
- Useful for debugging both early-stage workflows and production failures

---

### GAP-L2-007: Observability Missing Correlation IDs and Cost Metrics
**Severity:** Medium (Operability)
**Identified by:** synthesized-codex
**Present in:** synthesized-claude (partial — has event schema but no run IDs or cost)

**Problem:** The synthesized-claude observability spec (T011) lacks correlation/run IDs (making it impossible to correlate events across a multi-task run) and has no cost/token metrics (making budget management impossible).

**Solution:** Extend T011 (Observability) with:
- `run_id` (UUID) on every event for cross-event correlation
- `task_run_id` (UUID) per task execution
- Metrics: `tokens_used`, `estimated_cost_usd`, `latency_ms`, `retry_count`, `loop_count`
- CLI summary: `ai-sdd status --metrics` shows cost/token usage per task
- Cost budget threshold: configurable; warns or pauses workflow when exceeded

---

### GAP-L2-008: Prompt Injection Not Addressed
**Severity:** Medium (Security)
**Identified by:** synthesized-codex
**Present in:** synthesized-claude (secret redaction only), synthesized-gemini, synthesized-deepseek

**Problem:** Agents receive user-provided spec files, constitution files, and task outputs as part of their prompt context. Malicious content in any of these (e.g., "Ignore all previous instructions and...") can hijack agent behavior.

**Solution:** Extend T011/security spec with:
- Input sanitization pipeline before any content is injected into agent context
- Detect known prompt-injection patterns (regex + heuristic)
- Quarantine flagged content and escalate to HIL
- Security fixture corpus for regression testing
- Output sanitization: scrub outputs for sensitive data before writing to state files

---

### GAP-L2-009: No Concurrency Budget / Resource Guardrails
**Severity:** Medium (Cost + Reliability)
**Identified by:** synthesized-codex (gap analysis)
**Present in:** All four plans (none specify it)

**Problem:** Parallel task execution (independent tasks dispatched concurrently) can trigger simultaneous LLM calls, causing cost spikes, rate limit exhaustion, and unpredictable latency. No plan specifies guardrails.

**Solution:** Add concurrency config to engine and workflow:
```yaml
config:
  max_concurrent_tasks: 3           # max parallel dispatches at once
  rate_limit_requests_per_minute: 20 # across all adapters
  cost_budget_per_run_usd: 10.00    # pause and HIL escalate when exceeded
```
Engine maintains a semaphore on dispatch. Exceeding cost budget pauses to HIL.

---

### GAP-L2-010: No Schema Migration Tooling
**Severity:** Low (Maintainability)
**Identified by:** synthesized-claude (noted in risk table)
**Present in:** All four plans

**Problem:** When workflow schema, state file schema, or agent schema changes between framework versions, in-progress workflows may silently break.

**Solution (Phase 4):**
- All schemas carry a `version` field (already in state file)
- `ai-sdd migrate --from <version> --to <version>` CLI command
- Auto-migration for minor versions; fail-fast for major with migration guide
- Schema version mismatch at startup raises actionable error

---

## Prioritized Resolution Order

| Priority | Gap | Blocking? | Target Phase |
|---|---|---|---|
| 1 | GAP-L2-001: Expression DSL | Yes — blocks safe loop execution | Phase 1 |
| 2 | GAP-L2-002: Artifact Contract | Yes — blocks reliable handovers | Phase 1 |
| 3 | GAP-L2-007: Observability correlation IDs + cost | Yes — blocks governance evidence | Phase 1 |
| 4 | GAP-L2-005: Context Window Management | Yes — blocks long workflows | Phase 1 |
| 5 | GAP-L2-004: Adapter Reliability Contract | Yes — blocks stable real-provider runs | Phase 1/2 |
| 6 | GAP-L2-003: Overlay Composition Tests | Yes — blocks safe advanced modes | Phase 2 |
| 7 | GAP-L2-006: Step execution mode | No — DX improvement | Phase 1 (CLI) |
| 8 | GAP-L2-008: Prompt injection | No — security hardening | Phase 2 |
| 9 | GAP-L2-009: Concurrency budget | No — cost protection | Phase 2 |
| 10 | GAP-L2-010: Schema migration | No — maintainability | Phase 4 |

---

## Definition of Gap Closure

A gap is closed only when all four conditions are met:
1. **Spec exists**: schema/contract/grammar is defined.
2. **Runtime enforces it**: engine validates and enforces the spec at runtime.
3. **Tests cover it**: both happy path and failure path are tested.
4. **Docs explain it**: operator-facing troubleshooting guidance is written.
