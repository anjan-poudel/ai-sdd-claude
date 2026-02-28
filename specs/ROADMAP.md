# ai-sdd: Level-2 Synthesized Roadmap

**Version:** 2.0.0-synthesized
**Date:** 2026-02-27

---

## Milestones

| # | Milestone | Outcome | Groups | Effort |
|---|---|---|---|---|
| M1 | Agent + Workflow Foundation | YAML schemas load, validate, DAG resolves | A, B | ~14d |
| M2 | Constitution + Core Engine | End-to-end pipeline executes | C, D | ~21d |
| M3 | Expression DSL + Artifact Contract | Safe loop evaluation; typed handovers | E | ~8d |
| M4 | Safety Layer (HIL + Policy Gate) | Default-ON HIL; evidence gate active | F | ~10d |
| M5 | Context + Observability | Context window managed; run IDs + cost metrics | G | ~11d |
| M6 | CLI + Adapters | Full CLI + Claude Code adapter | H | ~12d |
| **MVP Gate** | **Demo Run** | Reproducible demo satisfying all MVP criteria | — | — |
| M7 | Overlay Suite | All overlays + composition tests | I | ~32d |
| M8 | Security Baseline | Prompt injection + secret hygiene | J | ~5d |
| M9 | Native Integration | Claude Code, OpenAI/Codex, Roo Code native use | K | ~23d |
| M10 | Workflow SDK | Python + TypeScript SDK | L | ~36d |
| M11 | Production Hardening | Reliability, observability, governance | M | ~37d |

---

## Task Groups with Effort Estimates

### A. Agent Foundation (M1)
- YAML schema, default agents (BA/Architect/PE/LE/DEV/Reviewer), `extends` inheritance
- Exit: agent load/override validated; schema violations fail fast
- **Size: S (4d)**

### B. Workflow Foundation (M1)
- DAG schema/loader, cycle detection, loop config, parallel task eligibility
- **Size: M (5d) → total with A: ~9d**

### C. Constitution Resolution (M2)
- Recursive merge (framework → root → sub-module), override precedence
- **Size: XS (3d)**

### D. Core Engine + State (M2)
- Dispatch loop, hook lifecycle, atomic persistence, resume, asyncio parallelism
- RuntimeAdapter ABC + MockAdapter + ClaudeCodeAdapter
- Context Manager + **constitution artifact manifest writer** (pull model; no ContextReducer)
- **Size: L (8d) + M (5d) context = ~13d total with C**

### E. Expression DSL + Artifact Contract (M3)
- Expression DSL: grammar, safe parser, evaluator, golden tests
- Artifact contract: schema.yaml, validator, compatibility checks
- **Size: S+S (4d+4d = 8d)**

### F. Safety Layer (M4)
- HIL default-ON (file-queue, PENDING/ACKED/RESOLVED/REJECTED)
- Evidence policy gate (T0/T1/T2, evidence categories)
- **Size: S+M (4d+6d = 10d)**

### G. Context + Observability (M5)
- Observability: run IDs, task_run_IDs, cost/token metrics, event schema
- Cost tracker + budget threshold
- Concurrency budget config
- **Size: S+XS+XS (4d+2d+2d = 8d — plus manifest writer already in D)**

### H. CLI + Adapters (M6)
- CLI: run, resume, status, validate-config, hil, **step**, metrics
- Config discovery, merge, schema validation
- **Size: M+M (7d+5d = 12d)**

### I. Overlay Suite (M7)
- Confidence overlay (advisory), Evidence gate, Paired workflow, Agentic review
- Enhanced HIL (full state machine)
- **Overlay composition matrix tests (pairwise + golden traces)**
- **Adapter reliability contract (error taxonomy, idempotency, retry)**
- CodexAdapter + GeminiAdapter (full impl)
- **Size: 4+3+6+5+6+3+5+4+6 = ~42d → with some sharing ~32d**

### J. Security Baseline (M8)
- Prompt injection detection + quarantine
- Output sanitization; data egress policy checks
- Security fixture corpus
- **Size: M (5d)**

### K. Native Integration (M9) — New Phase
- Claude Code: slash commands (markdown only) + `CLAUDE.md` template; headless `ClaudeCodeAdapter` for CI
- OpenAI/Codex: `AGENTS.md` template (for `codex` CLI) + `OpenAIAdapter` (for API); no Jinja2
- Roo Code: static `.roomodes` template (no `generate_modes.py`) + `mcp_config.json`
- **Shared MCP server** (`integration/mcp_server/`) — ~100 lines; delegates to `ai-sdd` CLI; used by both Roo Code and Claude Code
- Shared tool schemas (`integration/shared/`) reused by OpenAI function calling + MCP
- `ai-sdd init --tool <name>` CLI command replaces per-tool `install.sh` scripts
- End-to-end integration tests (headless adapters + MCP contract tests)
- **Size: S+S+S+S+XS+S+M = ~23d** *(reduced from 34 — tools-first approach eliminates code generators and install scripts)*

### L. Workflow SDK (M10)
- Python + TypeScript SDK; YAML parity tests; reference projects; cost/latency docs
- **Size: L+L+M+M+S = ~36d**

### M. Production Hardening (M11)
- Reliability, extended observability, governance, schema migration (`ai-sdd migrate`)
- **Size: ~37d**

### N. Multi-Project Support (Post-M11 — not yet scheduled)
**Deliberately deferred.** The framework currently assumes single-project deployment.
Multi-project scenarios are on the roadmap but require design decisions not yet resolved:

| Question | Options |
|---|---|
| Agent registry scope | Per-repo, per-org, or configurable? |
| Constitution inheritance | Cross-repo constitution hierarchy? |
| Workflow sharing | Shared workflow templates across repos? |
| State isolation | Separate state per project, or shared orchestrator? |

When multi-project support is prioritised, the design should start from these questions.
The MCP server (`ai-sdd serve --mcp`) already provides a network-accessible interface
that could serve as a cross-project orchestration surface with minimal new work.

---

## Phase Critical Paths

### Phase 1 Critical Path (MVP)

```
A (Agent) ──┐
            ├──► B (Workflow) ──► D (Core Engine) ──► F (HIL+Gate) ──► H (CLI)
C (Const.) ─┘                       │
                                     └──► E (DSL+Artifact)
                                     └──► G (Observability)
```

A and C have no dependencies — run in parallel.
D depends on A, B, C. E, F, G, H all depend on D.
F depends on E (HIL gate uses DSL for conditions).

**Phase 1 duration on critical path: ~40d** (A||C → B → D → E → F → H)

### Phase 2 (Overlays) starts after M4 (HIL active)

```
D+E+F ──► I (Overlay Suite) ──► J (Security)
```

### Phase 3 (Native Integration) can start after M6 (CLI usable)

```
H ──► K (Integration)
```

Phases 3 and 4 (SDK) can proceed in parallel after M6.

---

## MVP Gate Checklist

The following must all be green before MVP is declared:

- [ ] End-to-end YAML workflow (BA → Architect → PE → DEV → Reviewer)
- [ ] Resume from checkpoint after simulated crash
- [ ] HIL queue: create, list, resolve, reject
- [ ] Expression DSL: 20 golden test expressions pass; no `eval()` in codebase
- [ ] Artifact contract: incompatible producer/consumer fails at load time
- [ ] Evidence gate: T1 pass and T2 requires HIL demonstrated
- [ ] Observability: run_id present in all events; cost visible in `status --metrics`
- [ ] Mock adapter + Claude Code adapter verified
- [ ] Constitution artifact manifest updated after each task; agents read only relevant artifacts via native tools
- [ ] Config errors fail fast with actionable messages
