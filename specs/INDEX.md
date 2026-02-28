# ai-sdd: Level-2 Synthesized Planning Index

**Version:** 2.0.0-synthesized
**Date:** 2026-02-27
**Synthesized from:** ai-sdd-synthesized-{claude, codex, gemini, deepseek}

---

## Overview Documents

| Doc | Purpose |
|---|---|
| [COMPARISON.md](COMPARISON.md) | Side-by-side assessment of all 4 synthesized plans |
| [PLAN.md](PLAN.md) | Full architecture + 5-phase delivery + effort estimates |
| [ROADMAP.md](ROADMAP.md) | Milestones, task groups, effort, critical path, MVP gate |
| [GAPS-ANALYSIS.md](GAPS-ANALYSIS.md) | 10 gaps found + solutions + prioritized remediation |
| [TASK-VISUALIZATION.md](TASK-VISUALIZATION.md) | Full task dependency graph + greenfield & brownfield project walkthroughs |
| [CONTRACTS.md](CONTRACTS.md) | Canonical contracts appendix: tool names, task states, idempotency keys, CLI flags, transaction boundaries |
| [PRE-IMPLEMENTATION-GATE.md](PRE-IMPLEMENTATION-GATE.md) | Pre-implementation gate — 24 checks from 3 reviews. Must PASS before Phase 1 begins. |
| [REVIEW-FEEDBACK.md](REVIEW-FEEDBACK.md) | Codex review — 9 findings, all addressed |
| [GEMINI-REVIEW.md](GEMINI-REVIEW.md) | Gemini review — 6 findings, all addressed |
| [deepseek-review.md](deepseek-review.md) | DeepSeek review — 10 action items, all addressed |
| [UNIFIED-FEEDBACK-CODEX-DEEPSEEK.md](UNIFIED-FEEDBACK-CODEX-DEEPSEEK.md) | Unified review (Codex + DeepSeek + derailment risks) — 12 findings |
| [unified-feedback-response.md](unified-feedback-response.md) | Response to unified review — 8 fixed, 4 pushed back with justification |
| [feedback-updated-review.md](feedback-updated-review.md) | Post-fix review — 3 spec gaps + 3 safeguards + strategic risks |
| [feedback-updated-review-response.md](feedback-updated-review-response.md) | Response — 5 fixed, 7 pushed back with justification |

---

## Phase 0: Pre-Implementation Gate

| Task | Title | Size | Notes |
|---|---|---|---|
| [T000](tasks/T000-spec-gate.md) | Spec Gate — review sign-off | XS (1d) | **T2 HIL gate. Blocks all Phase 1 tasks.** |

## Tasks — Phase 1: Core Engine

| Task | Title | Size | Notes |
|---|---|---|---|
| [T001](tasks/T001-agent-system.md) | Agent System — YAML schema, loader, defaults | S (4d) | Unchanged from synthesized-claude |
| [T002](tasks/T002-workflow-system.md) | Workflow System — DAG loader, default template | M (5d) | Unchanged |
| [T003](tasks/T003-constitution-system.md) | Constitution System — recursive resolution + artifact manifest | S (3d) | **Updated**: manifest writer + AUTO-GENERATED exclusion rule |
| [T004](tasks/T004-core-engine.md) | Core Engine — orchestrator, state, hooks | L (8d) | **Updated**: `idempotency_key`, concurrency budget, pull model context |
| [T005](tasks/T005-hil-overlay.md) | HIL Overlay (default ON) | S (4d) | Unchanged |
| [T010](tasks/T010-cli-and-config.md) | CLI + Project Config + RuntimeAdapter | M (7d) | **Updated**: `init`, `step`, `metrics`, `constitution`, `serve --mcp` |
| [T011](tasks/T011-observability.md) | Observability — events + cost/token metrics | S (4d) | **Updated**: `run_id`, `task_run_id`, cost tracking, security events |
| [T012](tasks/T012-expression-dsl.md) | Expression DSL + Safe Evaluator | S (4d) | New |
| [T013](tasks/T013-artifact-contract.md) | Artifact Contract + I/O Schema | S (4d) | New |
| [T016](tasks/T016-constitution-artifact-manifest.md) | Constitution Artifact Manifest Writer | XS (2d) | New |

## Tasks — Phase 2: Overlay Suite

| Task | Title | Size | Notes |
|---|---|---|---|
| [T006](tasks/T006-evidence-policy-gate.md) | Evidence Policy Gate (T0/T1/T2) | M (6d) | Unchanged |
| [T007](tasks/T007-confidence-overlay.md) | Confidence Scoring + Confidence Loop | S (4d) | Unchanged |
| [T008](tasks/T008-paired-workflow-overlay.md) | Paired Workflow Overlay | M (6d) | Unchanged |
| [T009](tasks/T009-agentic-review-overlay.md) | Agentic Review Loop Overlay | S (5d) | Unchanged |
| [T014](tasks/T014-overlay-composition-tests.md) | Overlay Composition Matrix Tests | M (5d) | New |
| [T015](tasks/T015-adapter-reliability.md) | Adapter Reliability Contract | S (4d) | New |
| [T017](tasks/T017-security-prompt-injection.md) | Security — Prompt Injection + Secret Hygiene | M (5d) | New |

## Tasks — Phase 3: Native Integration

| Task | Title | Size | Notes |
|---|---|---|---|
| [T018](tasks/T018-claude-code-integration.md) | Claude Code Native Integration | S (4d) | New |
| [T019](tasks/T019-codex-integration.md) | OpenAI / Codex Integration | M (4d) | New |
| [T020](tasks/T020-roo-code-integration.md) | Roo Code Native Integration | M (5d) | New |

---

## New Tasks (this synthesis)

### Phase 1: Core Engine Additions

| Task | Title | Size | Key Addition |
|---|---|---|---|
| [T012](tasks/T012-expression-dsl.md) | Expression DSL + Safe Evaluator | S (4d) | Formal grammar; no `eval()`; golden corpus |
| [T013](tasks/T013-artifact-contract.md) | Artifact Contract + I/O Schema | S (4d) | Versioned typed task outputs; compatibility checks |
| [T016](tasks/T016-constitution-artifact-manifest.md) | Constitution Artifact Manifest | XS (2d) | Engine writes artifact index into constitution; agents pull via native tools |

*(T011 enhanced: add `run_id`, `task_run_id`, cost/token metrics — update inherited T011)*

### Phase 2: Overlay Suite Additions

| Task | Title | Size | Key Addition |
|---|---|---|---|
| [T014](tasks/T014-overlay-composition-tests.md) | Overlay Composition Matrix Tests | M (5d) | Pairwise matrix; invariants; golden traces; CI gate |
| [T015](tasks/T015-adapter-reliability.md) | Adapter Reliability Contract | S (4d) | Error taxonomy; idempotency; retry/backoff contract |
| [T017](tasks/T017-security-prompt-injection.md) | Security — Prompt Injection + Secret Hygiene | M (5d) | Input sanitization; injection corpus; output scrubbing |

### Phase 3: Native Integration (New Phase)

| Task | Title | Size | Tool |
|---|---|---|---|
| [T018](tasks/T018-claude-code-integration.md) | Claude Code Native Integration | S (4d) | Slash commands + CLAUDE.md; adapter for headless/CI only |
| [T019](tasks/T019-codex-integration.md) | OpenAI / Codex Integration | M (4d) | AGENTS.md template; OpenAIAdapter; shared tool schemas; no Jinja2 |
| [T020](tasks/T020-roo-code-integration.md) | Roo Code Native Integration | M (5d) | Static `.roomodes` template; shared MCP server; no generate_modes.py |

---

## Execution Order

### Phase 0 → Phase 1 (Critical Path)

```
T000 (Spec Gate — T2 HIL, two sign-offs required)
    │
    ▼  [all Phase 1 tasks blocked until T000 = COMPLETED]
T001 ──┐
       ├──► T002 ──► T004 ──► T005 ──► T006 (Phase 2)
T003 ──┘              │
                      ├──► T010 (CLI)
                      ├──► T011 (Observability)
                      ├──► T012 (Expression DSL)  ← required before loops run
                      ├──► T013 (Artifact Contract)
                      └──► T016 (Manifest Writer)
```

T000 is the pre-implementation gate — verified against PRE-IMPLEMENTATION-GATE.md.
T012 (Expression DSL) must complete before any workflow with loop conditions executes.
T013 (Artifact Contract) should complete before T002 (workflow loader) is finalized.

### Phase 2 (Overlays)

```
T004 + T012 ──► T006 (Gate) ──► T007 (Confidence) ──► T008 (Paired) ──► T009 (Review)
                                                                           │
                                                              T014 (Composition Tests) ──► CI gate
T010 ──► T015 (Adapter Reliability)
T011 ──► T017 (Security)
```

### Phase 3 (Native Integration) — parallel with Phase 4

```
T010 (CLI complete) ──► T018 (Claude Code)
                    ──► T019 (Codex)
                    ──► T020 (Roo Code)
```

T018/T019/T020 can run in parallel after the CLI is stable.

---

## Key Design Decisions (Level-2)

1. **Expression DSL is mandatory** — no workflow runs with raw string exit_conditions.
2. **Constitution-as-index, not ContextReducer** — engine writes artifact manifest; agents pull what they need via native tools (Read, Grep, Serena, MCP). No engine-side compression.
3. **Tools-first, custom code as last resort** — use native tool capabilities (Claude Code tools, Roo MCP, Serena) before writing custom infrastructure. ContextReducer was removed for this reason.
4. **Artifact contracts are versioned** — incompatible producer/consumer fails at load time.
5. **Overlay composition is tested in CI** — pairwise matrix must pass before any overlay merges.
6. **Adapter reliability is a contract** — all adapters must pass the same contract test suite.
7. **Native integration via Phase 3** — Claude Code, Codex, Roo Code are first-class targets.
8. **MCP server enables tool-agnostic integration** — any MCP-compatible tool can drive ai-sdd.
9. **Prompt injection is an input problem** — sanitize before it reaches the agent, not after.
10. **Context size tracked in every observability event** — enables cost attribution and debugging.
11. **5 phases; MVP at end of Phase 2** — integration and SDK come after a proven core.

---

## Gaps Still Open (For Future Synthesis)

| Gap | Notes |
|---|---|
| Multi-project / shared agent registry | Uniformly deferred; needs roadmap note |
| Schema migration tooling | `ai-sdd migrate` planned for Phase 5 |
| Cost/token SDK | Phase 4 DX task; needs pricing table per model |
| LLM-as-a-judge independence | Who judges the judge? Needs policy decision |
| Gemini adapter (full impl) | T020 scope includes; Phase 3 |
