# AI Agentic Coding Ecosystem Analysis

This document reviews three related projects and proposes a clean ecosystem model for requirement-driven, agentic software development without collapsing them into one oversized system.

Projects reviewed:

- `ai-sdd`
- `coding-standards`
- `repeatability-mcp-server`

Reference used only as prior context:

- `docs/ecosystem-analysis.md`

## Executive View

The earlier framing was directionally useful but too blended. These three repos should not be merged into one "super-framework". They are strongest when assigned distinct roles:

- `ai-sdd` is the execution and orchestration plane.
- `coding-standards` is the governance and policy plane.
- `repeatability-mcp-server` is the planning memory, lock, and repeatability plane.

That separation matters because the core failure mode here is not missing features. It is role confusion:

- if `ai-sdd` absorbs too much governance logic, it becomes heavy and brittle
- if `coding-standards` tries to orchestrate execution, it duplicates runtime concerns
- if `repeatability-mcp-server` becomes a general workflow engine, it stops being a reliable planning substrate

The right ecosystem is compositional, not monolithic.

## Project Review

## `ai-sdd`

### What it is

`ai-sdd` is already a real orchestrator:

- YAML-defined workflow execution
- DAG scheduling and dependency management
- task state machine
- runtime adapters for multiple coding agents
- HIL queue and resolution flow
- overlay chain and remote overlay abstraction work
- MCP exposure for workflow operations

### What it is good at

- coordinating multi-step delivery work
- maintaining execution state and resumability
- normalizing runtime behavior across tools and models
- enforcing task sequencing, retries, rework, and human approvals
- acting as the shell that agents and external services plug into

### What it is not good at

- being the canonical source of requirements truth
- holding the full burden of repeatability analysis
- embedding every governance check as in-process logic
- becoming a second requirements-graph platform

### Correct role

`ai-sdd` should be the control plane and execution runtime.

It should own:

- workflow graph
- task lifecycle
- handover state
- adapter dispatch
- HIL state transitions
- verdict consumption from overlays/providers

It should not own all domain-specific validation logic.

## `coding-standards`

### What it is

`coding-standards` is a requirements-first governance framework with:

- requirements lock conventions
- validation gates and drift checks
- requirements input validation
- query/traceability tooling
- agent constitutions and planning-review prompts
- MCP graph tooling
- CI and reproducibility scripts

### What it is good at

- preventing scope creep and gold-plating
- enforcing explicit requirements and exclusions
- making planning review and “GO” style approval concrete
- providing repeatable policy gates
- expressing rules that should stay stable across orchestrators

### What it is not good at

- runtime orchestration
- task scheduling
- multi-agent execution state management
- being the primary long-running workflow engine

### Correct role

`coding-standards` should be the policy and governance service layer.

It should own:

- policy definitions
- validation rules
- planning review contracts
- scope compliance checks
- requirements-first review heuristics
- reusable governance MCP/CLI tools

It should not become the place that runs end-to-end agent workflows.

## `repeatability-mcp-server`

### What it is

`repeatability-mcp-server` is a graph- and lock-centric planning substrate with:

- requirement graph construction
- typed traceability edges
- requirements lock export
- validation and query engine
- evaluation framework for repeatability/stability
- constitution-serving experiments
- plan/lock CLI tooling

### What it is good at

- representing planning artifacts as a durable graph
- exporting canonical lock artifacts
- measuring determinism and semantic drift across runs
- querying coverage, dependency, and traceability gaps
- acting as the system of record for planning relationships

### What it is not good at

- workflow orchestration
- task execution lifecycle
- agent runtime management
- being a policy engine for every governance concern

### Correct role

`repeatability-mcp-server` should be the planning memory and repeatability authority.

It should own:

- planning graph state
- lock generation/export
- graph validation/query
- repeatability metrics
- contract/requirements provenance

It should not absorb general governance or workflow scheduling.

## Main Overlaps

There is real overlap, but most of it is superficial rather than fatal.

### Shared themes

- requirements-first development
- graph or lock representations
- MCP integration
- agent-facing constraints
- traceability and validation

### The actual overlap problems

#### 1. Lock and graph duplication

Both `coding-standards` and `repeatability-mcp-server` work with graph/lock concepts.

Interpretation:

- `repeatability-mcp-server` should become the canonical graph/lock system
- `coding-standards` should consume or validate that data, not redefine it independently long term

#### 2. MCP capability duplication

Both `ai-sdd` and the external repos can expose MCP tools.

Interpretation:

- `ai-sdd` should expose workflow/runtime tools
- external repos should expose governance/planning tools

Do not make all three expose the same conceptual tool surface.

#### 3. Agent constitution duplication

Both `coding-standards` and `repeatability-mcp-server` contain constitution-like ideas.

Interpretation:

- `coding-standards` should remain the primary home for agent governance prompts and constitutions
- `repeatability-mcp-server` can store planning-time constitution metadata if useful, but should not be the main policy authoring repo

## Proposed Ecosystem Model

Use a three-plane architecture.

### 1. Execution Plane: `ai-sdd`

Responsibilities:

- run workflow DAGs
- dispatch coding/review agents
- maintain run state
- apply overlay/provider verdicts
- gate execution on approvals or failures
- present a single operator interface

Outputs:

- task status
- artifacts
- execution telemetry
- HIL items

### 2. Governance Plane: `coding-standards`

Responsibilities:

- evaluate whether planned or generated work complies with requirements-first rules
- validate exclusions, scope, justification, and planning completeness
- provide reusable governance checks through CLI and MCP
- define constitutions and phase-specific agent contracts

Outputs:

- governance verdicts
- rework guidance
- compliance reports
- policy metadata

### 3. Planning and Repeatability Plane: `repeatability-mcp-server`

Responsibilities:

- maintain the requirements graph
- export and validate requirements locks
- answer traceability and dependency queries
- evaluate reproducibility and stability across runs
- preserve planning provenance

Outputs:

- requirements graph state
- lock files
- traceability views
- repeatability metrics

## The Backbone Abstraction

The ecosystem needs one shared abstraction so local and remote capabilities feel coherent.

The most useful abstraction is:

`Requirement Backbone`

It is not another framework. It is a normalized contract that all three systems can use.

### Backbone responsibilities

- identify the current approved requirement set
- expose scope inclusion and exclusion
- provide traceability links
- surface validation/review verdicts
- support deterministic export and comparison

### Backbone components

#### A. `BackboneReference`

Identifies the active planning baseline.

Example fields:

- `backbone_id`
- `project_id`
- `version`
- `source`
- `lock_hash`
- `approved_at`

#### B. `BackboneQuery`

A transport-neutral request for planning/governance operations.

Examples:

- `validate_scope`
- `find_gaps`
- `export_lock`
- `trace_requirement`
- `check_repeatability`
- `planning_review`

#### C. `BackboneDecision`

A normalized verdict returned to `ai-sdd`.

Suggested shape:

```ts
type BackboneVerdict = "PASS" | "REWORK" | "FAIL" | "HIL";

interface BackboneDecision {
  verdict: BackboneVerdict;
  summary: string;
  reasons?: string[];
  evidence?: Record<string, unknown>;
  source: "local" | "cli" | "mcp";
  provider: string;
}
```

This is the key integration move. `ai-sdd` should consume normalized decisions, not vendor-specific outputs.

#### D. `BackboneProvider`

A transport-neutral provider interface:

- local provider
- CLI sidecar provider
- MCP provider

This lets the ecosystem evolve without rewriting `ai-sdd` each time.

## Recommended Boundaries

## What should stay in `ai-sdd`

Only the minimum required to make the ecosystem operable:

- overlay/provider abstraction
- verdict mapping into task states
- governance mode in runtime config
- task metadata fields needed for orchestration
- operator-visible run state and HIL integration
- adapter and workflow execution logic

This keeps `ai-sdd` small and opinionated.

## What should move or remain external in `coding-standards`

- planning review
- scope enforcement
- excluded-capability checks
- justification checks
- drift and reproducibility policy scripts
- requirements-input validation
- agent constitutions and GO protocol

These are policy concerns and should remain portable.

## What should move or remain external in `repeatability-mcp-server`

- planning graph storage
- requirements lock export
- traceability and dependency queries
- repeatability metrics
- contract/lock comparison
- graph-backed planning sessions

These are substrate concerns and benefit from being canonical.

## How They Complement Each Other

The cleanest end-state workflow is:

1. `repeatability-mcp-server` creates or updates the requirement graph.
2. `repeatability-mcp-server` exports the approved lock/backbone snapshot.
3. `coding-standards` validates that snapshot and/or the proposed plan against governance policies.
4. `ai-sdd` consumes the approved backbone reference and runs the implementation workflow.
5. Before and after key tasks, `ai-sdd` calls governance and traceability providers through the same provider contract.
6. If a provider returns `REWORK`, `FAIL`, or `HIL`, `ai-sdd` owns the state transition.
7. After execution, `repeatability-mcp-server` records resulting traceability or contract deltas; `coding-standards` evaluates compliance drift.

That makes the three projects complementary instead of competitive.

## Integration Patterns

There are three viable patterns. One is clearly better.

### Pattern A: Hard merge into `ai-sdd`

Description:

- copy governance and repeatability logic into `ai-sdd`

Pros:

- single repo
- fewer runtime dependencies

Cons:

- highest complexity
- severe ownership blur
- duplicated logic and schemas
- slower evolution
- likely to create a second-class copy of two mature domains

Recommendation:

- reject

### Pattern B: Pure external tools with no shared abstraction

Description:

- keep all repos separate and invoke them ad hoc

Pros:

- minimal code changes
- preserves repo independence

Cons:

- inconsistent operator experience
- brittle tool coupling
- duplicated parsing and mapping logic in workflows
- no unified verdict model

Recommendation:

- insufficient

### Pattern C: Thin-core `ai-sdd` with external backbone providers

Description:

- keep `ai-sdd` thin
- add a transport-neutral provider interface
- use `coding-standards` and `repeatability-mcp-server` as external services

Pros:

- best separation of concerns
- supports local, CLI, and MCP overlays cleanly
- preserves existing repo strengths
- incremental adoption path
- easiest to reason about operationally

Cons:

- requires deliberate contract design
- needs good observability and failure handling

Recommendation:

- adopt

## Concrete Ecosystem Design

## `ai-sdd` as the only control plane

Only `ai-sdd` should:

- decide whether a task runs
- decide whether a task moves to `COMPLETED`, `NEEDS_REWORK`, `FAILED`, or `HIL_PENDING`
- manage retries and max-iteration rules
- manage operator interaction

This is non-negotiable. If external services start owning task transitions, the system becomes opaque.

## `coding-standards` as a governance overlay service

Best candidates to expose via CLI or MCP:

- `planning_review`
- `scope_guard`
- `requirements_input_validate`
- `drift_check`
- `reproducibility_check`
- `justification_check`

Expected result:

- normalized `BackboneDecision`

## `repeatability-mcp-server` as the planning substrate service

Best candidates to expose via MCP:

- `graph_init`
- `graph_add_node`
- `graph_add_edge`
- `graph_validate`
- `graph_query`
- `graph_export`
- `lock_compare`
- `repeatability_eval`

Expected result:

- graph state, lock artifacts, traceability data, and repeatability metrics

## Recommended primary interaction model

### Planning phase

- use `repeatability-mcp-server` to build the planning graph and export the lock
- use `coding-standards` to review the lock and plan for governance completeness
- only after approval should `ai-sdd` begin execution

### Execution phase

- `ai-sdd` runs tasks
- before execution, `ai-sdd` may ask governance providers whether the task is in bounds
- after execution, `ai-sdd` may ask governance/repeatability providers for drift or coverage checks

### Audit phase

- `repeatability-mcp-server` compares resulting artifacts against the baseline
- `coding-standards` issues compliance and drift verdicts
- `ai-sdd` records those outcomes in run state and outputs

## Minimal Local Changes Needed in `ai-sdd`

To support this ecosystem, `ai-sdd` only needs a small local surface area:

### Required

- provider abstraction for local/CLI/MCP overlays
- normalized verdict contract
- configuration for provider registry
- mapping from provider verdicts to task transitions
- observability for provider calls and failures

### Helpful but still small

- task metadata fields such as `requirement_ids`, `acceptance_criteria`, `scope_excluded`, `phase`
- governance mode flags
- baseline backbone reference persisted in run state

### Avoid

- importing full validation engines directly
- duplicating graph stores
- duplicating lock exporters
- embedding policy rules that belong in `coding-standards`

## Suggested Canonical Ownership

Use one canonical owner per concern.

| Concern | Canonical owner |
|---------|-----------------|
| Workflow execution | `ai-sdd` |
| Task state transitions | `ai-sdd` |
| Human approval queue | `ai-sdd` |
| Agent constitutions and policy prompts | `coding-standards` |
| Governance rules and drift checks | `coding-standards` |
| Requirements graph | `repeatability-mcp-server` |
| Lock export and lock validation substrate | `repeatability-mcp-server` |
| Repeatability metrics | `repeatability-mcp-server` |
| Unified operator entrypoint | `ai-sdd` |

## Shortcomings in the Earlier Analysis

The earlier ecosystem note was closest to correct when it recognized complementary strengths, but it missed several structural points:

### 1. It over-emphasized “unification”

The target should not be a unified codebase. It should be a unified operating model.

### 2. It treated graph and governance capabilities as more interchangeable than they are

They are related, but they solve different problems:

- graph/lock = planning substrate
- governance = policy evaluation

### 3. It did not make `ai-sdd` the single control plane strongly enough

Without that, the ecosystem becomes a collection of tools rather than a coherent framework.

### 4. It did not define a thin shared contract

Without a normalized decision contract, every integration becomes custom glue.

## Recommended Synthesis

The best synthesis is:

- keep `ai-sdd` lean and orchestration-focused
- keep `coding-standards` external and policy-focused
- keep `repeatability-mcp-server` external and graph/lock-focused
- standardize the interaction through a transport-neutral backbone/provider contract

In practical terms:

1. `ai-sdd` asks external systems questions.
2. External systems return normalized decisions or planning data.
3. `ai-sdd` remains the only system that mutates workflow execution state.

That is the cleanest ecosystem boundary.

## Incremental Adoption Plan

### Phase 1: Make the boundary explicit

- define the shared `BackboneDecision` contract in `ai-sdd`
- add local/CLI/MCP provider support
- map provider verdicts to existing task states

### Phase 2: Externalize governance first

- wire `coding-standards` checks through the provider contract
- start with `planning_review` and `scope_guard`
- run in `warn` mode first, then enforce selectively

### Phase 3: Externalize planning substrate

- integrate `repeatability-mcp-server` for lock export, traceability queries, and gap validation
- treat exported lock hash as the approved baseline for execution runs

### Phase 4: Add audit and repeatability feedback loop

- run repeatability and drift analysis after major workflow milestones
- feed `REWORK` or `HIL` decisions back into `ai-sdd`

### Phase 5: Normalize operator experience

- make `ai-sdd` the single CLI/operator surface
- keep external systems mostly invisible behind provider contracts unless direct use is needed

## Final Recommendation

Do not merge the three repos into one platform.

Build an ecosystem with:

- `ai-sdd` as orchestrator
- `coding-standards` as governance overlay service
- `repeatability-mcp-server` as planning and repeatability substrate

The crucial abstraction is not “more framework”. It is a thin requirement backbone contract that works the same whether the capability is local, CLI-based, or remote over MCP.

That gives you:

- strong requirements-first discipline
- reproducible planning artifacts
- enforceable governance
- agentic workflow orchestration
- lower overall complexity than a hard merge

That is the best way to get the strengths of all three repos without creating a system that is harder to operate than the problems it is supposed to solve.
