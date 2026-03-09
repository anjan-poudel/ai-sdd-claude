# ai-sdd Synthesized Plans: Level-2 Comparison

**Date:** 2026-02-27
**Scope:** Comparing the 4 synthesized plans: ai-sdd-synthesized-{claude, codex, gemini, deepseek}

---

## Side-by-Side Assessment

| Dimension | synthesized-claude | synthesized-codex | synthesized-gemini | synthesized-deepseek | Best Source |
|---|---|---|---|---|---|
| **Task detail depth** | Highest — Gherkin ACs, JSON schemas, file lists | High — DoD/test strategy/rollback per task | Medium — conceptual, good narrative | High — deepseek matches claude detail | synthesized-claude |
| **Governance & safety** | Strong (policy gate, T0/T1/T2, reviewer independence) | Strongest (explicit evidence gate + non-promotion rule + security baseline) | Medium (HIL + confidence focus) | Strong | synthesized-codex |
| **Safety: Expression DSL** | **Missing** — exit_conditions as raw strings | **Present** — formal DSL grammar, safe evaluator | Missing | Missing | synthesized-codex |
| **Artifact contract** | Missing | **Present** — versioned typed I/O, compatibility checks | Missing | Missing | synthesized-codex |
| **Overlay composition tests** | Mentioned in principles | **Specified** — matrix, invariants, golden traces | Missing | Missing | synthesized-codex |
| **Adapter reliability contract** | Partial (retry, backoff in T010) | **Specified** — error taxonomy, idempotency, state mapping | Missing | Missing | synthesized-codex |
| **Observability** | Phase 1 (T011) — basic event schema, secret redaction | Phase 1+4 — **correlation/run IDs, cost/token metrics** | Missing | Missing | synthesized-codex |
| **Security/prompt injection** | Secret sanitization only | **Prompt injection protection** + output sanitization | Missing | Missing | synthesized-codex |
| **Context window management** | Missing | Missing | Present — ContextReducer (rejected) | Missing | **Level-2** — constitution-as-index pull model |
| **Step execution mode** | Missing | Missing | **Present** — `--step` CLI flag | Missing | synthesized-gemini |
| **Effort estimates** | Missing | Missing | Missing | **Present** — T-shirt sizes + day estimates | synthesized-deepseek |
| **Machine-readable roadmap** | Missing | ROADMAP.yaml present | Missing | **Present** — ROADMAP.yaml with task groups | synthesized-deepseek |
| **Critical path diagram** | DAG in INDEX | MVP exit criteria | Phased narrative | **Best** — explicit parallel groups + effort | synthesized-deepseek |
| **Concurrency guardrails** | Missing | **Identified** (gap, not speced) | Missing | Missing | synthesized-codex (gap) |
| **Phase count** | 4 phases | 4 phases | 3 phases | 3 phases | synthesized-claude |
| **PRD completeness** | Strong — adds secret/NFR requirements | Focused on gaps | Good narrative | Full PRD with evidence gate | synthesized-deepseek/claude |

---

## Unique Contributions by Source

### synthesized-codex (Critical additions)
1. **Expression DSL + Safe Evaluator (T010)**: Formal grammar for `exit_conditions`; no `eval()`; safe deterministic evaluation. _Security-critical._
2. **Artifact Contract & I/O Schema (T011)**: Versioned, typed task outputs; compatibility checks before handover. _Reliability-critical._
3. **Overlay Composition Matrix (T012)**: Pairwise/full matrix invariant tests; golden trace fixtures; CI gate. _Correctness-critical._
4. **Adapter Reliability Contract (T013)**: Unified error taxonomy; idempotency keys; deterministic error→state mapping.
5. **Cost/token metrics in observability (T014)**: Correlation/run IDs in every event; latency, retry, queue wait, token/cost, loop count metrics.
6. **Prompt injection protection (T015)**: Output sanitization pipeline; prompt injection fixture blocking; policy checks for data egress.
7. **Concurrency budget** (gap): parallel execution needs resource guardrails to prevent cost spikes.
8. **YAML SDK parity tests (T016)**: YAML import/export must produce identical behavior to SDK workflow definitions.

### synthesized-gemini (New capabilities)
1. **Context Window Management**: `ContextReducer`/`SemanticFilter` module; summarize older outputs; filter by relevance; enforce context limits. _Scalability-critical._
2. **`--step` execution mode**: Debug by advancing one task at a time.
3. **Robust replay from any node**: Resume not just from last state, but from any previously completed node.

### synthesized-deepseek (Planning improvements)
1. **Effort estimates per task**: T-shirt sizes (XS/S/M/L) + days estimate.
2. **Machine-readable ROADMAP.yaml**: Enables automated tooling on the roadmap.
3. **Critical path sequencing**: Explicit parallel groups and sequencing diagram.

### synthesized-claude (Retained as base)
1. Full Gherkin ACs with JSON schemas for all tasks.
2. 4-phase delivery (adds Production Hardening).
3. Evidence Policy Gate (T006), Observability (T011) as Phase 1.
4. Reviewer independence rule.
5. Dry-run mode, `validate-config` CLI.
6. TypeScript SDK alongside Python.
7. Secret sanitization spec.
8. 10 gaps documented in GAPS-ANALYSIS.md.

---

## Weaknesses Resolved in Level-2 Synthesis

| Was a Weakness | Resolution |
|---|---|
| Expression DSL grammar only sketched | **Resolved** — T012 defines full formal grammar, safe parser, golden test corpus |
| Context window management underspecified | **Resolved** — T016 specifies constitution-as-index pull model; no ContextReducer |
| Prompt injection spec minimal | **Resolved** — T017 specifies 20-pattern corpus, input/output sanitization pipeline |
| Concurrency/resource budget not speced | **Resolved** — `engine.max_concurrent_tasks` + cost budget in ai-sdd.yaml (PLAN §2.7) |
| Per-tool `install.sh` scripts | **Resolved** — `ai-sdd init --tool <name>` CLI command; tools-first principle |
| MCP server scoped to Roo Code only | **Resolved** — shared `integration/mcp_server/`; used by Roo Code + Claude Code |
| Gemini `generate_modes.py` generator | **Resolved** — static `.roomodes` template; constitution handles dynamic context |
| Interactive ClaudeCodeAdapter | **Resolved** — slash commands drive `ai-sdd` CLI natively; no adapter for interactive path |

## Weaknesses Still Open

1. **No multi-project / shared agent registry**: Uniformly deferred; no forward roadmap note yet.
2. **No schema migration tooling**: `ai-sdd migrate` planned for Phase 5; spec not yet written.
3. **LLM-as-a-judge independence**: When `llm_judge` metric is used, policy on self-evaluation not defined.
4. **Cost/token SDK** (Phase 4): Needs a model pricing table; not yet specified.
