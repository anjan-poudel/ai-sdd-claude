# Ecosystem Proposal: Three Projects, Three Jobs, Zero Overlap

**Date:** 2026-03-08
**Status:** PROPOSAL
**Author:** Generated from ground-truth code analysis of all three repos

---

## The Problem With the Current State

All three projects independently developed graph-based traceability tooling around the same `requirements.lock.yaml` artifact:

| Capability | repeatability-mcp-server | coding-standards | ai-sdd |
|-----------|-------------------------|-----------------|--------|
| Graph storage | InMemory + LadybugDB | InMemory | — |
| MCP tools (graph) | 6 tools | 6 tools (simpler impl) | delegates to CLI |
| Validation rules | 20+ rules, 5 categories | 11 rules, 4 categories | — |
| Query patterns | 14 patterns | 11 methods | — |
| Lock file export | Yes | Yes | — |

The coding-standards graph tools are a **simplified fork** of repeatability-mcp-server. They exist because CS was developed before RMS was mature. This duplication creates confusion about which project owns the graph model, lock format, and validation rules.

Meanwhile, each project also has capabilities **no other project has**:

| Unique to repeatability-mcp-server | Unique to coding-standards | Unique to ai-sdd |
|-----------------------------------|---------------------------|------------------|
| LLM eval framework (N-run stability) | Lock file schema + format specification | Workflow DAG execution |
| AST contract extraction (TS/Java/Kotlin) | Agent prompt library (coder, reviewer, planner) | Task state machine |
| LadybugDB persistent graph | Language standards (Java, Kotlin) | Overlay chain (HIL, gates) |
| Contract evolution tracking | Bash validation scripts (drift, reproducibility) | Constitution resolver |
| Lock diff + canonicalization CLI | Model routing config | Adapter system (claude-code, openai) |
| RUN nodes + GENERATED edges | GO protocol + confidence scoring | Expression DSL |
|  | Requirements input schema | Artifact contracts |
|  | Lock generator agent prompts | Security sanitizers |
|  | PR checklist, commit templates |  |

The solution is to **eliminate the duplication** and give each project one clear job.

---

## The Proposal: One Sentence Per Project

| Project | Role | One-liner |
|---------|------|-----------|
| **repeatability-mcp-server** | Traceability Engine | Builds, validates, queries, and exports requirements traceability graphs |
| **coding-standards** | Standards Library | Provides agent prompts, language-specific coding rules, and CI validation scripts |
| **ai-sdd** | Orchestrator | Dispatches tasks to agents, manages workflow state, and enforces governance |

**The test:** no word in any one-liner applies to another project.

- Does the Traceability Engine orchestrate? No — it provides graph tools; the Orchestrator calls them.
- Does the Standards Library build graphs? No — it provides static reference content.
- Does the Orchestrator define coding rules? No — it consumes them from the Standards Library.

---

## Responsibility Matrix

### repeatability-mcp-server: Traceability Engine

**Owns permanently:**
- Graph data model (11 node types, 12 edge types)
- Graph storage (InMemory for dev, LadybugDB for persistence)
- Graph-to-lock export (serializes graph into `requirements.lock.yaml` per CS schema)
- Validation engine (20+ rules: coverage, justification, anti-overeng, structure, contract)
- Query engine (14 patterns: gaps, impact, coverage, dependencies, orphans, available tasks)
- MCP server exposing all graph, validation, and query tools
- LLM eval framework (contract stability measurement across N runs)
- AST contract extraction (TypeScript, Java, Kotlin)
- Lock CLI (canonicalize, validate, diff, export)

**Does NOT do:**
- Dispatch tasks to agents
- Manage workflow state
- Provide coding rules or agent prompts
- Run CI/CD pipelines
- Make decisions (pass/fail) — it reports; the caller decides

**Interface:** MCP protocol (stdio transport). Agents call tools; ai-sdd calls queries.

### coding-standards: Standards Library

**Owns permanently:**
- **Lock file schema**: `requirements-lock.md`, `requirements-input.schema.yaml`, example lock files — the canonical specification of what a valid lock looks like
- Agent prompt library: `coder.md`, `code-reviewer.md`, `planning-reviewer.md`, `constitution.md`
- Lock generator agents: system/user prompts for generating lock from code evidence
- Language standards: `java/CLAUDE-java.md`, `kotlin/CLAUDE-kotlin.md` (and future languages)
- Model routing: `agents/model-routing.yaml` (phase → provider/model/temperature)
- CI validation scripts: `reproducibility-check.sh`, `semantic-drift-check.sh`, `spec-hash.sh`
- Requirements input schema: `requirements-input.schema.yaml`
- Templates: PR checklist, commit message, build-feature, release-readiness
- GO protocol: confidence-based human approval flow
- Diff-aware lock regeneration prompts

**Does NOT do:**
- Build or store graphs (use repeatability-mcp-server)
- Run an MCP server with graph tools (use repeatability-mcp-server)
- Execute validation rules programmatically (use repeatability-mcp-server)
- Orchestrate workflows (use ai-sdd)
- Manage task state (use ai-sdd)

**Interface:** Static files consumed by ai-sdd constitution resolver (`standards/**/*.md`) and CI pipelines (bash scripts).

### ai-sdd: Orchestrator

**Owns permanently:**
- Workflow engine: YAML DAG loading, topological sort, concurrent task dispatch
- Task state machine: `VALID_TRANSITIONS`, atomic state persistence, resume from checkpoint
- Overlay chain: HIL → Evidence Gate → Agentic Review → Paired Workflow → Confidence
- Constitution system: multi-source merge (root + feature + standards + CLAUDE.md)
- CLI: `run`, `status`, `complete-task`, `hil`, `init`, `serve`, `migrate`
- Adapter system: abstract LLM dispatch (claude-code, openai, mock)
- Expression DSL: safe evaluator for exit conditions and gate expressions
- Artifact contracts: producer/consumer compatibility validation
- Security: input/output sanitizers, secret detection, prompt injection detection
- Observability: structured events, cost/token tracking, run correlation IDs
- `complete-task` transaction boundary: allowlist → sanitize → validate → write → update

**Does NOT do:**
- Define coding rules or agent behavior (consume from coding-standards)
- Build traceability graphs (delegate to repeatability-mcp-server)
- Validate lock file content (delegate to repeatability-mcp-server or coding-standards scripts)
- Extract contracts from source code (delegate to repeatability-mcp-server)
- Provide language-specific guidance (consume from coding-standards)

**Interface:** CLI commands + MCP server (stdio). Consumes standards via file read. Consumes graph tools via MCP client.

---

## Integration Architecture

```
                          Developer
                             │
                         /sdd-run
                             │
                             ▼
    ╔════════════════════════════════════════════════════╗
    ║               ai-sdd (Orchestrator)                ║
    ║                                                    ║
    ║  workflow.yaml → engine → state-manager             ║
    ║  overlay chain: HIL → Gate → Review → Paired        ║
    ║                                                    ║
    ║  Constitution resolver merges:                      ║
    ║  ┌─────────────────────────────────────────┐       ║
    ║  │ root constitution.md                     │       ║
    ║  │ + standards/java/CLAUDE-java.md    ◄─── CS      ║
    ║  │ + agents/coder.md                 ◄─── CS      ║
    ║  │ + agents/constitution.md          ◄─── CS      ║
    ║  │ + feature constitutions                  │       ║
    ║  └─────────────────────────────────────────┘       ║
    ╚══════╤══════════════════════════╤══════════════════╝
           │                          │
     MCP protocol              Bash calls (hooks)
           │                          │
           ▼                          ▼
    ╔══════════════════╗    ╔═══════════════════════╗
    ║  repeatability-  ║    ║  coding-standards     ║
    ║  mcp-server      ║    ║  (Standards Library)  ║
    ║  (Traceability   ║    ║                       ║
    ║   Engine)        ║    ║  Bash scripts:        ║
    ║                  ║    ║  • reproducibility-   ║
    ║  MCP tools:      ║    ║    check.sh           ║
    ║  • graph_init    ║    ║  • semantic-drift-    ║
    ║  • graph_add_*   ║    ║    check.sh           ║
    ║  • graph_validate║    ║  • spec-hash.sh       ║
    ║  • graph_query   ║    ║                       ║
    ║  • graph_export  ║    ║  Static files:        ║
    ║                  ║    ║  • Agent prompts      ║
    ║  Also:           ║    ║  • Language standards  ║
    ║  • LLM eval      ║    ║  • Model routing      ║
    ║  • AST extract   ║    ║  • Schemas/templates  ║
    ║  • Lock CLI      ║    ║                       ║
    ╚════════╤═════════╝    ╚═══════════════════════╝
             │
             ▼
    requirements.lock.yaml
    (shared artifact — schema defined by CS,
     built/queried by RMS, tracked by ai-sdd,
     validated by CS scripts)
```

**Key properties of this architecture:**

1. **Arrows go one direction.** ai-sdd calls both. Neither calls the other. Neither calls ai-sdd. No circular dependencies.

2. **Each project has one interface type.** RMS exposes MCP tools. CS provides static files + bash scripts. ai-sdd exposes CLI commands.

3. **The lock file is the only shared artifact.** CS defines the schema. RMS builds graphs and exports them as lock files. ai-sdd tracks the lock as a workflow artifact. CS scripts validate it for drift.

---

## How Integration Works (Concrete)

### Planning Phase: Agent Builds Lock via RMS

```yaml
# ai-sdd workflow task
tasks:
  define-requirements:
    use: define-requirements
    agent: ba
    description: |
      Build requirements graph using the traceability MCP server.
      Use graph_init → graph_add_node → graph_add_edge → graph_validate → graph_export.
      Export as requirements.lock.yaml.
```

The BA agent receives:
- Constitution (which includes `agents/constitution.md` + `planning-reviewer.md` from CS)
- Access to RMS MCP tools (graph_init, add_node, add_edge, validate, export)
- Output path: `specs/requirements.lock.yaml`

The agent calls RMS tools incrementally to build the graph, validates it, and exports the lock file. ai-sdd's `complete-task` writes the lock file through its transaction boundary.

### Evidence Gate: ai-sdd Queries RMS

When the `design-architecture` task is about to start, ai-sdd's PolicyGateOverlay can query RMS for coverage:

```typescript
// In PolicyGateOverlay or a pre-task hook
const gaps = await mcpClient.callTool("graph_query", {
  sessionId,
  pattern: "gaps"
});
if (gaps.reqsWithoutTasks.length > 0) {
  return { verdict: "FAIL", reason: "Requirements without implementing tasks" };
}
```

This uses the existing `McpOverlayProvider` abstraction — RMS becomes just another overlay provider in the chain.

### Implementation Phase: Agent Gets CS Standards

```yaml
# ai-sdd workflow task
tasks:
  implement:
    use: standard-implement
    agent: dev
```

The Dev agent receives:
- Constitution (which includes `coder.md` + `CLAUDE-java.md` from CS, auto-merged)
- Lock file path in context (from prior task's output)
- No MCP tools needed — just implement per the locked requirements

### Post-Implementation: CS Scripts as Hooks

```yaml
# ai-sdd.yaml or workflow-level hooks
hooks:
  post_task:
    implement:
      - command: scripts/semantic-drift-check.sh
        on_failure: needs_rework
      - command: scripts/reproducibility-check.sh
        on_failure: hil_pending
```

ai-sdd's hook system calls CS bash scripts. Scripts read the lock file, check for drift, and return exit codes. ai-sdd maps exit codes to state transitions.

### Review Phase: Agent Gets CS Reviewer Prompt

The Reviewer agent receives `code-reviewer.md` from CS via constitution. It checks:
- Spec was updated during work (not bulk at end) — per CS reviewer contract
- All acceptance criteria implemented — per lock file
- No gold-plating — per CS anti-overengineering rules
- Language standards followed — per `CLAUDE-java.md`

### Repeatability Measurement (Optional)

After implementation, RMS eval framework can measure contract stability:
1. Extract contracts from generated code via AST extractors
2. Compare against lock file contracts
3. Report stability metrics to ai-sdd observability

This is an optional post-workflow step, not part of the critical path.

---

## Migration Path

### Phase 1: Current (mostly done)

- ai-sdd consumes CS standards via constitution resolver
- ai-sdd's engine handles orchestration (CS workflow/state-machine.yaml being archived)
- CS graph tools remain functional but get no new features
- RMS operates standalone

### Phase 2: Connect RMS to ai-sdd

- Add RMS as an MCP server dependency in `ai-sdd init`
- Update `define-requirements` task template to instruct agents to use RMS MCP tools
- Wire RMS gap queries into PolicyGateOverlay evidence checks
- CS bash scripts wired as ai-sdd post-task hooks

### Phase 3: Consolidate Graph Tooling

- CS `tools/mcp-server` deprecated — planning agents use RMS directly
- CS `tools/validators` deprecated — ai-sdd queries RMS validation instead
- CS `tools/query-engine` deprecated — ai-sdd queries RMS query engine instead
- CS becomes a pure knowledge base: prompts + standards + scripts + schemas

### What RCS-009 Becomes

The RCS-009 task (add 6 high-level query tools to CS MCP server) should be **redirected to RMS**. RMS already has the equivalent methods:

| Proposed CS Tool | RMS Equivalent |
|-----------------|----------------|
| `validate_lock` | `graph_validate` with all rulesets |
| `find_gaps` | `graph_query` pattern `gaps` / `QueryEngine.findAllGaps()` |
| `impact_analysis` | `graph_query` pattern `impact_chain` / `QueryEngine.getImpactChain()` |
| `coverage_report` | `QueryEngine.getRequirementCoverage()` / `getFullyCoveredRequirements()` |
| `dependency_chain` | `graph_query` pattern `dependency_chain` / `QueryEngine.getDependencyChain()` |
| `available_tasks` | `graph_query` pattern `available_tasks` / `QueryEngine.getAvailableTasks()` |

Adding these as convenience wrappers in RMS (loading lock file → building graph → running query → returning JSON) is the right move. CS doesn't need to duplicate this.

---

## What Does NOT Change

- ai-sdd's overlay chain, state machine, CLI, adapters — untouched
- coding-standards' agent prompts, language standards, bash scripts — untouched
- repeatability-mcp-server's graph model, eval framework, extractors — untouched
- The `requirements.lock.yaml` format — already aligned between RMS and CS
- Each project's independent usability — RMS works without ai-sdd, CS works without ai-sdd

---

## Decision Criteria: Where Does X Belong?

When you build a new feature, ask:

| Question | Answer → Project |
|----------|-----------------|
| Does it build, query, or validate a traceability graph? | **repeatability-mcp-server** |
| Does it define how an agent should behave or write code? | **coding-standards** |
| Does it decide when a task runs, stops, or transitions? | **ai-sdd** |
| Does it define the lock file schema/format? | **coding-standards** (schema is a standard) |
| Does it build, export, or diff lock files from a graph? | **repeatability-mcp-server** (tooling) |
| Does it check for drift or reproducibility in CI? | **coding-standards** (bash scripts) |
| Does it measure LLM output stability? | **repeatability-mcp-server** |
| Does it route a task to a specific LLM model? | **coding-standards** (config), **ai-sdd** (execution) |
| Does it manage human-in-the-loop approvals? | **ai-sdd** |
| Does it extract contracts from source code? | **repeatability-mcp-server** |
| Does it enforce governance policies at runtime? | **ai-sdd** |

---

## Risks

| Risk | Mitigation |
|------|-----------|
| RMS MCP server adds latency to planning | Graph built incrementally; InMemory backend is <2ms per op |
| CS tool deprecation breaks existing CI | Gradual: CS tools work indefinitely; deprecation is a recommendation, not a deadline |
| Three repos to coordinate | Lock file format is the only shared contract; versioned with `metadata.version` |
| RMS not ready for ai-sdd integration | ai-sdd already works without RMS; integration is additive |
| CS scripts need lock file that RMS produces | Lock format is already aligned; CS scripts read the same YAML |
