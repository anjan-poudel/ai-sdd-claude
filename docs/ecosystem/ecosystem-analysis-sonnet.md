# AI-Driven Agentic Development Ecosystem Analysis

> Comprehensive analysis of `repeatability-mcp-server`, `coding-standards`, and `ai-sdd` —
> their origins, what each does, how they relate, what has already been merged, and a detailed
> proposal for a unified ecosystem.

**Last updated:** 2026-03-08

---

## Background: Why These Three Projects Exist

All three projects were built independently to attack the same cluster of problems with AI-assisted software development:

1. **Hallucination and requirement drift** — LLMs invent requirements, silently drop constraints, or "improve" things that weren't asked for.
2. **Gold-plating** — agents add logging, retry logic, caching, and abstractions that were never requested, bloating scope and introducing hidden decisions.
3. **Non-reproducibility** — the same prompt given twice produces different outputs; there is no stable anchor.
4. **Lack of traceability** — generated code cannot be audited back to a stated requirement.
5. **Governance gaps** — human sign-off is informal or bypassed; no audit trail.

Each project explored a different angle:

| Project | Primary Lens |
|---------|-------------|
| `coding-standards` | Discipline and contracts for AI coding agents — prevent problems through strict prompting and locked requirements |
| `repeatability-mcp-server` | Structural enforcement through graph-based planning — make the planning session itself typed, validated, and measurable |
| `ai-sdd` | Workflow orchestration — coordinate multi-agent pipelines with state management, overlays, and human gates |

They were deliberately kept separate as experiments. `coding-standards` and `repeatability-mcp-server` share significant conceptual overlap (they were co-developed around the same time) — this convergence is not accidental but reflects a genuine shared understanding of what traceable AI development requires. The decision to merge their best ideas into `ai-sdd` is the natural next step.

---

## Part 1: `repeatability-mcp-server` — Deep Analysis

### 1.1 Core Mission

**Make LLM-assisted software planning deterministic and traceable.** The central insight is: given identical, well-formed requirements, the same contracts (APIs, interfaces) should be produced every time. Variability is a signal — of vague requirements or uncontrolled generation. The project attacks this by:

1. Forcing planning output into a **typed property graph** with explicit traceability relationships
2. Producing a **requirements lock file** that captures not just the plan but the LLM parameters, governance approvals, and provenance — so every output is auditable and repeatable

### 1.2 Monorepo Structure

```
repeatability-mcp-server/
├── packages/
│   ├── requirement-lock-server/      # Primary MCP server (7 tools)
│   ├── planlock-cli/                 # CLI: lock validation + export
│   └── agent-constitution-server/    # Early-stage: agent governance
├── docs/                             # 39 documentation files
├── tests/                            # Integration tests
├── plans/                            # Example plans + templates
├── collaboration-model/              # LLM coordination models
└── examples/                         # Usage examples
```

**Tech stack:** TypeScript (strict), Node.js/tsx, pnpm workspaces, `@modelcontextprotocol/sdk` v1.26.0, Zod v4.3.6, `js-yaml`, Pino, LadybugDB (WASM embedded graph DB), `@anthropic-ai/sdk`.

### 1.3 Core Data Model: Typed Property Graph

Every planning session is a **typed property graph** with validated node and edge schemas.

**Node types (11):**

| Type | Meaning | ID Pattern |
|------|---------|------------|
| `REQ` | Functional requirement | `REQ-001` |
| `NFR` | Non-functional requirement | `NFR-001` |
| `AC` | Acceptance criterion | `AC-001` |
| `TASK` | Implementation task | `TASK-001` |
| `TESTSPEC` | Test specification | `TESTSPEC-001` |
| `CONTRACT` | API/interface contract | `CONTRACT-001` |
| `MODEL` | Domain data model | `MODEL-001` |
| `DEC` | Architecture decision | `DEC-001` |
| `ASSUMPTION` | Risky planning assumption | `ASSUMPTION-001` |
| `CONSTRAINT` | Hard limitation | `CONSTRAINT-001` |
| `RUN` | Evaluation/test run | `RUN-001` |

Node IDs enforce `^[A-Z]+-\d{3,}$` via Zod schema — no freeform naming.

**Edge types (12) with type-compatibility enforcement:**

| Edge | Source → Target | Semantics |
|------|----------------|-----------|
| `IMPLEMENTS` | TASK → REQ/NFR | Task delivers the requirement |
| `VERIFIES` | AC → TASK | Criterion verifies the task |
| `COVERS` | TESTSPEC → REQ/AC/NFR | Test covers requirement |
| `JUSTIFIED_BY` | CONTRACT/MODEL → REQ/NFR | Design element backed by requirement |
| `DEPENDS_ON` | TASK/REQ → TASK/REQ | Ordering constraint |
| `SUPPORTS` | DEC/ASSUMPTION → DEC/REQ/NFR | Evidence for decision |
| `CONTRADICTS` | DEC/ASSUMPTION → REQ/NFR/DEC | Conflict marker |
| `REFINES` | any → any | Constraint refinement |
| `ALTERNATIVE` | DEC → DEC | Considered alternative |
| `DERIVES_FROM` | CONTRACT → CONTRACT | Version history / lineage |
| `VALIDATED_BY` | CONTRACT → CONTRACT | Validation result |
| `GENERATED` | RUN → CONTRACT | Test-generated contract |

Edge type compatibility is enforced at insertion time — `VERIFIES` from a `DEC` node is rejected.

### 1.4 MCP Server: 7 Tools

The primary package exposes a stdio MCP server:

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `graph_init` | metadata, backend? | Create session; choose `memory` or `ladybug` backend |
| `graph_add_node` | sessionId, node | Add typed, validated node |
| `graph_add_edge` | sessionId, edge | Add validated, type-compatible relationship |
| `graph_validate` | sessionId, rulesets? | Run 13 validation rules |
| `graph_query` | sessionId, pattern, params? | Execute 14 named query patterns |
| `graph_export` | sessionId, format, options? | Export as YAML/JSON/requirements_lock |
| `graph_health_check` | — | Server uptime, memory, active sessions |

### 1.5 Storage Backends

Two interchangeable backends implement `IGraphStore`:

**InMemoryGraph** — Map-based with adjacency lists (outgoing and incoming) and a type index. O(1) node lookup, O(k) edge lookup. No persistence; < 2ms per operation. Used for testing and ephemeral sessions.

**LadybugAdapter** — Wraps `@lbug/lbug-wasm` in `.ldb` files. Persistent, git-friendly, supports Cypher queries optionally. ~10ms overhead vs in-memory. Falls back to InMemoryGraph if initialization fails.

### 1.6 Validation Engine (13 Rules, 5 Categories)

```
ValidationEngine
├── Coverage (4 rules)
│   ├── coverage-req-tasks    [ERROR]  Every REQ needs ≥1 TASK
│   ├── coverage-task-ac      [ERROR]  Every TASK needs ≥1 AC
│   ├── coverage-req-tests    [ERROR]  Every REQ needs ≥1 TESTSPEC
│   └── coverage-nfr-tests    [WARN]   NFRs should have test coverage
├── Justification (2 rules)
│   ├── justification-contracts [ERROR]  CONTRACT needs JUSTIFIED_BY edge
│   └── justification-models    [ERROR]  MODEL needs JUSTIFIED_BY edge
├── Structure (2 rules)
│   ├── structure-orphans      [WARN]   No disconnected nodes
│   └── structure-task-deps    [WARN]   TASK with >3 deps → complexity flag
├── Anti-over-engineering (1 rule)
│   └── anti-overeng-abstractions [WARN]  Abstraction DEC needs ≥2 REQs or ≥1 NFR
└── Contract (4 rules)
    ├── contract-stability
    ├── contract-justification
    ├── contract-validation
    └── contract-version-chain
```

Validation returns `{ passed: boolean, errors: Violation[], warnings: Violation[], summary: string }`. Violations include `suggestion` field for actionable remediation.

### 1.7 Query Engine (14 Patterns)

```
Gap detection:      findAllGaps(), orphans, unjustifiedContracts
Traceability:       implementing_tasks, covering_tests, dependent_tasks
Impact analysis:    impact_chain, dependency_chain
Planning:           available_tasks (no blockers, not deprecated)
Coverage:           fully_covered (REQs with both TASKs and TESTs)
Navigation:         by_type, incoming, outgoing, path
```

`getAvailableTasks()` enables work-queue semantics — the agent only sees tasks it can actually start, preventing work on blocked dependencies.

`getImpactChain(reqId)` answers "what breaks if this requirement changes?" — implementing tasks, covering tests, justified contracts. Critical for change impact analysis.

### 1.8 Requirements Lock File Format

The canonical export captures reproducibility metadata explicitly:

```yaml
metadata:
  generated_by: requirement-lock-server
  generator_version: 1.0.0
  source_commit: abc123
  generated_at_utc: 2026-02-15T10:30:00Z

governance:
  mode: greenfield | brownfield
  confidence: 0.95
  approved_by: user-id
  approval_token: GO

llm:
  coder:    { model: claude-opus-4-6 }
  reviewer: { model: claude-opus-4-6 }
  temperature: 0.0
  topP: 0.9
  seed: 42         # ← explicit seed for reproducibility

scope:
  included: [feature-a, feature-b]
  excluded: [feature-c]            # explicitly forbidden

requirements: [...]
decisions: [...]
contracts: [...]
tasks: [...]
```

The `seed` and `temperature: 0.0` fields are first-class — the "repeatability" in the project name. With these pinned, the same requirements + same prompt → same contracts.

### 1.9 LLM Evaluation Framework

`src/eval/` is a complete measurement system:

- **`LLMGenerator.ts`** — calls Claude API N times with identical prompts
- **`MetricsEngine.ts`** — measures contract stability (% identical across runs), drift rate (% unjustified changes), contract churn
- **`SemanticAnalyzer.ts`** — semantic similarity across runs using embedding distance
- **`AutomatedEvalRunner.ts`** — multi-iteration orchestration with result aggregation

Key empirical finding (from project docs): **well-formed requirements → 80–100% stability**; vague requirements → 40–70%. This validates the lock-first approach.

### 1.10 Contract Extraction

AST-based extractors for TypeScript, Java, and Kotlin pull contract signatures from source files, compute SHA256 hashes, and track:
- `version`: monotonic integer
- `previousHash`: SHA256 of prior version
- `stabilityRate`: proportion of runs producing identical output
- `changeReason`: documented rationale for each hash change

This builds a **contract evolution history** — any unintended change is detectable because it lacks a documented `changeReason`.

### 1.11 Export Formats

**YamlExporter** — deterministic YAML (nodes sorted by ID, edges by from→type→to). Produces SHA256 hash of content for integrity checking. Suitable for git-diffing and CI comparison.

**RequirementsLockExporter** — evidence-oriented snapshot with grouped sections (requirements, decisions, acceptance criteria, test specs). Suitable for human review and compliance.

---

## Part 2: `coding-standards` — Deep Analysis

### 2.1 Core Mission

**Enforce specification-first discipline over AI coding agents.** The problem: without external constraints, LLMs implement what they imagine the user wants, not what was explicitly stated. They add unrequested logging, catch blocks, retry logic, and architectural layers. They make architectural decisions silently. Across runs, they produce semantically different outputs for the same input.

The solution: anchor every implementation session to an immutable `requirements.lock.yaml`. The lock is the law — nothing outside it is built; everything inside it must be traceable; any deviation is a gate failure.

### 2.2 Structure

```
coding-standards/
├── CLAUDE.md                       # Full AI coding contract (199+ lines)
├── CLAUDE-lite.md                  # Condensed version
├── agents/
│   ├── constitution.md             # Baseline rules for ALL agents
│   ├── coder.md                    # Implementation agent contract
│   ├── code-reviewer.md            # Review agent contract
│   ├── planning-reviewer.md        # Pre-implementation planning validator
│   ├── model-routing.yaml          # Phase → model/temperature mapping
│   └── requirements-lock/
│       ├── system-prompt.md        # Lock generator (extract from evidence only)
│       └── diff-aware/             # Diff-aware variant for brownfield changes
├── rules/
│   ├── requirements-lock.md        # Lock schema documentation
│   ├── example.requirements.lock.yaml  # Complete example (1036 lines)
│   └── acceptance-criteria-format.md  # Gherkin BDD format spec
├── java/CLAUDE-java.md             # Java-specific coding standards
├── kotlin/CLAUDE-kotlin.md         # Kotlin-specific coding standards
├── tools/
│   ├── validators/                 # TypeScript: 12 validation rules
│   ├── query-engine/               # TypeScript: 8 graph query commands
│   └── mcp-server/                 # Optional MCP runtime (6 tools)
├── scripts/
│   ├── reproducibility-check.sh    # Pre-merge gate
│   ├── semantic-drift-check.sh     # 6-gate drift detection
│   ├── spec-hash.sh / spec-hash-verify.sh
│   └── [phase routing, circuit-breaker, schema validation scripts]
└── workflow/
    ├── state-machine.yaml          # 14-state workflow model
    ├── context.schema.json         # Agent handoff context contract
    └── events-contract.md          # Event stream definition
```

### 2.3 The Requirements Lock Schema

The lock is a YAML document that encodes a graph in document form:

```yaml
metadata:
  version: "2.0.0"
  spec_hash: sha256:<hash>          # SHA256(lock + openapi)
  previous_hash: sha256:<prev>
  change_reason: <documented reason>
  approved_by: <name>
  approval_token: GO                 # Human sign-off

requirements:
  - id: REQ-001
    type: functional | non-functional
    priority: high | medium | low
    acceptance_criteria:
      - scenario: "Create order successfully"
        given: "I am authenticated, product exists"
        when: "I POST /api/orders with quantity 5"
        then:
          - "Response status is 201"
          - "Response contains orderId"
          - "Order is persisted"

scope:
  included: [order-management]
  excluded: [payment-processing]    # Explicitly forbidden

decisions:
  - id: DEC-001
    rationale: <reason>
    alternatives_considered: [...]
    satisfies: [REQ-001]

contracts:
  - id: CONTRACT-001
    format: typescript | openapi | kotlin
    version: 1
    hash: sha256:<hash>
    previous_hash: null
    change_reason: <reason>
    spec: |
      <interface/schema definition>

tasks:
  - id: TASK-001
    implements: [REQ-001]
    depends_on: []

testspecs:
  - id: TESTSPEC-001
    covers: [REQ-001]
    test_file: src/test/OrderControllerTest.java
    test_method: testCreateOrderSuccessfully

out_of_scope:
  - "Payment processing"
  - "Email notifications"
```

**Key invariants:**
- Immutable once `approval_token: GO` is set
- Conservative: better to under-specify than over-specify
- Every field changes the spec hash → triggers drift detection

### 2.4 The AI Coding Contract (CLAUDE.md)

The core of the project: a detailed behavioral contract for AI coding agents.

#### The 90% Rule

AI must reach 90% confidence before writing code. Confidence = all of:
- Requirements explicitly stated
- Acceptance criteria defined in Gherkin BDD
- Scope clear (what to change AND what NOT to change)
- Implementation approach unambiguous
- Edge cases and error handling specified

STOP and clarify when: vague verbs ("improve", "enhance", "fix"), multiple valid interpretations, undefined types/APIs, or undocumented error handling.

#### The GO Protocol

Before writing any code, the agent outputs:
1. **Clarifying Questions** (minimum necessary, option-based not open-ended)
2. **Draft Requirements Checklist** (explicit, testable)
3. **Confidence Score** with reasoning

User replies "GO" (or answers questions). Only then does code get written.

The first line of any implementation response must be: `LOCKED REQUIREMENTS`. What follows is exactly those requirements — nothing more.

#### Anti-Patterns (Strictly Forbidden)

| Pattern | Why Forbidden |
|---------|--------------|
| Unrequested error handling | Invisible scope expansion |
| Logging not in spec | Adds side effects |
| "Improve" things not asked | Gold-plating |
| Multiple implementations "just in case" | Decision not delegated |
| TODOs / stubs | Incomplete delivery |
| "Assume now, apologize later" | Traceability broken |
| Silent architectural decisions | No audit trail |

### 2.5 Six-Gate Validation Pipeline

| Gate | Name | Cost | What It Checks |
|------|------|------|----------------|
| **0** | Spec Identity | Fast | SHA256(lock + openapi): intended vs. unintended change |
| **1** | Contract Drift | Fast | OpenAPI compatibility; removed endpoints, changed types |
| **2** | Scope Drift | Fast | Scan for excluded-scope terms in source code (ripgrep) |
| **3** | Architecture Drift | Medium | Layer violations, dependency directions |
| **4** | Behavior Drift | Expensive | Acceptance test immutability (same spec → same tests) |
| **5** | Non-Functional Drift | Optional | Locked perf targets, threading model |

Gates run in order — fast gates prevent expensive gates from running when early failures exist. This is a CI/CD pipeline as well as a local development check.

### 2.6 Agent Prompt Library

| Agent | File | Role |
|-------|------|------|
| Coder | `agents/coder.md` | Implement spec, zero shortcuts, progress tracking |
| Code Reviewer | `agents/code-reviewer.md` | Verify implementation against lock, no gold-plating |
| Planning Reviewer | `agents/planning-reviewer.md` | Validate ACs, scope, architecture before implementation |
| Lock Generator | `agents/requirements-lock/system-prompt.md` | Extract from evidence only, never infer |
| Diff-Aware Lock Generator | `agents/requirements-lock/diff-aware/` | Brownfield: produce lock diff with severity |

**Lock Generator principles:** extract from observables only (OpenAPI, tests, interfaces), never infer intent, never add "likely" requirements. Output "unspecified" for unknowns rather than guessing.

### 2.7 Language-Specific Standards

**Java (`java/CLAUDE-java.md`):**
- Hexagonal architecture (API → Application → Domain → Ports → Infrastructure)
- Domain must be framework-agnostic (no Spring annotations in domain layer)
- OpenAPI 3 as source of truth (contract-first)
- Java 25 virtual threads
- Records for immutable DTOs
- Pluggable Spring Data repositories

**Kotlin (`kotlin/CLAUDE-kotlin.md`):**
- Same hexagonal architecture
- Extension functions mandatory (replace conditionals with intention-revealing names)
- Sealed classes for algebraic types
- Null safety enforced at all boundaries
- Gradle Kotlin DSL
- No generic `Utils` dumping grounds

Both: forbidden to add framework annotations to domain classes, forbidden to add unrequested error handling, forbidden to import infrastructure in domain.

### 2.8 Workflow State Machine

14 states covering the full development lifecycle:

```
PLANNING_IN_PROGRESS → PLANNING_REVIEW_PENDING → PLANNING_CHANGES_REQUESTED
                     → PLANNING_APPROVED → LOCK_READY → IMPLEMENTATION_READY
                     → IMPLEMENTATION_IN_PROGRESS → PAIR_REVIEW_PENDING
                     → CODE_REVIEW_PENDING → CHANGES_REQUESTED → GATES_PENDING
                     → READY_FOR_GO → COMPLETED | CANCELLED
```

Mandatory invariant: planning review cannot be bypassed even at 100% confidence. GO Protocol required before implementation begins.

### 2.9 Model Routing

`agents/model-routing.yaml` maps workflow phases to specific providers and models:

```yaml
phases:
  planning:
    provider: anthropic
    model: claude-opus-4-6
    temperature: 0.3
  implementation:
    provider: anthropic
    model: claude-sonnet-4-6
    temperature: 0.1
  review:
    provider: anthropic
    model: claude-opus-4-6
    temperature: 0.2
```

This is the bridge between workflow state and LLM configuration — each phase gets the right model for its task characteristics.

---

## Part 3: Comparison — `repeatability-mcp-server` vs. `coding-standards`

### 3.1 Side-by-Side Summary

| Dimension | `repeatability-mcp-server` | `coding-standards` |
|-----------|---------------------------|-------------------|
| **Primary artifact** | Typed property graph (live session) | Requirements lock YAML (file) |
| **Interface to AI** | MCP tools (interactive, incremental) | Markdown prompts + YAML files (read once) |
| **Validation timing** | Real-time during graph construction | Batch: pre-merge, CI/CD |
| **Storage** | In-memory or LadybugDB (`.ldb`) | YAML files in git (always persistent) |
| **Graph model** | 11 node types, 12 edge types, enforced | Implicit in YAML sections |
| **Query capability** | 14 named graph traversal patterns | 8 CLI commands on YAML |
| **Validation rules** | 13 rules, 5 categories | 12 rules, 4 categories + 6 drift gates |
| **Contract extraction** | AST extractors (TS, Java, Kotlin) | Manual entry + hash tracking |
| **LLM eval framework** | Full (stability rate, drift rate, semantic similarity) | Gate 4: behavior immutability |
| **Repeatability mechanisms** | seed + temperature in lock; eval framework | spec-hash + drift gates |
| **Language standards** | None (framework-agnostic) | Java, Kotlin |
| **Agent prompt library** | None | Full (coder, reviewer, planner, lock generator) |
| **Model routing** | Captured in lock file (`llm:` section) | Explicit `model-routing.yaml` by phase |
| **CI/CD integration** | None | Full bash scripts, GitHub Actions templates |
| **Human governance** | `approval_token` in lock | GO Protocol + CODEOWNERS |
| **Maturity** | v0.x, active | v1.0+, production-oriented |

### 3.2 Deep Convergence: The Same Graph Model, Independently Derived

Both projects independently arrived at an **identical conceptual graph**:

| Concept | `repeatability-mcp-server` | `coding-standards` |
|---------|---------------------------|-------------------|
| Functional requirement | `REQ` node | `requirements[].id: REQ-NNN` |
| Non-functional req | `NFR` node | `requirements[].type: non-functional` |
| Acceptance criterion | `AC` node | `requirements[].acceptance_criteria[]` |
| Implementation task | `TASK` node | `tasks[].id: TASK-NNN` |
| Test specification | `TESTSPEC` node | `testspecs[].id: TESTSPEC-NNN` |
| Interface contract | `CONTRACT` node | `contracts[].id: CONTRACT-NNN` |
| Architecture decision | `DEC` node | `decisions[].id: DEC-NNN` |
| Task → Req | `IMPLEMENTS` edge | `tasks[].implements: [REQ-NNN]` |
| Test → Req | `COVERS` edge | `testspecs[].covers: [REQ-NNN]` |
| Contract → Req | `JUSTIFIED_BY` edge | `contracts[].justified_by: [REQ-NNN]` |

This is not coincidence. It reflects the genuine structure of traceable software development: every implementation element (task, test, contract) must connect to a stated requirement. One project represents this as a live graph with typed edges; the other embeds the same graph in a YAML document with foreign-key-style references.

### 3.3 Complementary Strengths

| Capability | Where It Lives |
|-----------|---------------|
| Interactive graph building (agent builds incrementally with real-time feedback) | `repeatability-mcp-server` |
| Session-scoped planning with rich graph traversal | `repeatability-mcp-server` |
| LLM repeatability measurement (stability rate, drift rate) | `repeatability-mcp-server` |
| AST-based contract extraction with version lineage | `repeatability-mcp-server` |
| Anti-overengineering: `JUSTIFIED_BY` enforcement at add time | `repeatability-mcp-server` |
| Agent prompt library (system prompts, behavioral contracts) | `coding-standards` |
| Language-specific implementation guidance | `coding-standards` |
| Phase-to-model routing | `coding-standards` |
| Drift detection gates (6-gate CI/CD pipeline) | `coding-standards` |
| Pre-merge reproducibility checks | `coding-standards` |
| Spec hash (intent vs. unintended change detection) | `coding-standards` |
| 90% rule + GO Protocol (human approval governance) | `coding-standards` |

### 3.4 Gaps in Each Project

**`repeatability-mcp-server` gaps:**
- No agent prompt library — tools exist but no guidance on how agents should use them
- No language-specific coding standards
- No CI/CD integration scripts
- No model routing — captures LLM params retrospectively, not prescriptively
- No human-in-the-loop workflow integration
- `agent-constitution-server` is early/incomplete

**`coding-standards` gaps:**
- Lock YAML is flat — no live graph traversal during the planning session itself
- No interactive MCP tools for incremental graph construction
- No LLM repeatability measurement
- No task orchestration (just standards + validation scripts)
- No contract evolution history (version lineage across runs)
- Agent constitution is thin (24 lines) — minimal governance rules

### 3.5 Divergence Points

| Topic | `repeatability-mcp-server` | `coding-standards` |
|-------|---------------------------|-------------------|
| **Lock generation** | MCP tools guide incremental graph building | Agent prompt generates full lock in one pass |
| **Validation timing** | Real-time during graph construction | Batch (pre-merge, CI/CD) |
| **State persistence** | In-memory session or embedded DB | YAML in git (always persistent) |
| **Scope enforcement** | `anti-overeng-abstractions` validation rule | Gate 2: excluded-scope term scan |
| **Graph queries** | MCP tool `graph_query` with 14 patterns | CLI commands on YAML structure |
| **Governance** | `governance.approval_token` in lock | GO Protocol + CODEOWNERS + state machine |
| **Reproducibility** | Explicit: seed + temperature captured | Implicit: spec-hash + drift gates |

---

## Part 4: What Has Already Been Merged into `ai-sdd`

### 4.1 From `coding-standards`

The following ideas and artifacts from `coding-standards` are already implemented in `ai-sdd`:

**Standards enforcement** (fully merged, March 2026):
- `standards/java/CLAUDE-java.md` and `standards/kotlin/CLAUDE-kotlin.md` copied from `coding-standards/java/` and `coding-standards/kotlin/`
- `ConstitutionResolver` (`src/constitution/resolver.ts`) now auto-discovers `standards/**/*.md` and appends them to every agent's constitution
- `--standards <paths>` CLI flag on `ai-sdd run` allows override
- `standards.paths` and `standards.strict` in `ai-sdd.yaml` config
- 13 tests in `tests/standards.test.ts` cover auto-discovery, explicit override, disable, strict mode

**Output structure** (fully merged, March 2026):
- Workflow phase outputs now go in `specs/` (not `.ai-sdd/outputs/`) — identical to coding-standards' convention of keeping specs alongside planning docs
- `specs/workflow.yaml` for greenfield, `specs/<FEATURE>/workflow.yaml` for features — mirrors coding-standards' per-feature organization
- Task breakdown goes to `specs/<task-id>/tasks/` with hierarchical T-NNN structure

**Workflow lookup and `--feature` flag** (fully merged, March 2026):
- `ai-sdd run --feature <name>` loads `specs/<feature>/workflow.yaml`
- Same flag on `complete-task --feature <name>` for output path allowlist matching
- Directory prefix allowlist in `complete-task` supports `specs/<task>/tasks/` tree

**Agent constitution pattern** (partially merged):
- `constitution.md` at project root — same as coding-standards' root constitution
- Feature-scoped constitutions: `specs/<feature>/constitution.md` — same as coding-standards' per-feature constitution pattern
- `CLAUDE.md` merged as additional constitution source

**HIL/GO Protocol alignment:**
- ai-sdd's `HIL_PENDING` state and HIL queue correspond directly to coding-standards' GO Protocol — the human is the gate
- T2 risk tier in the evidence gate overlay always requires HIL, aligning with coding-standards' mandatory-review-before-implementation invariant

**Task state machine:**
- `NEEDS_REWORK` state with `max_rework_iterations` maps to coding-standards' `check-iteration-limits.sh` circuit-breaker concept
- `CANCELLED` state (terminal) aligned with workflow `CANCELLED` state

**Not yet merged from `coding-standards`:**
- Agent prompt library (coder.md, code-reviewer.md) as task library templates
- Model routing (`model-routing.yaml`) into per-agent config
- Validation gate scripts as post-task hooks
- Spec hash tracking as a workflow artifact
- Acceptance criteria Gherkin format enforcement in task specs
- Diff-aware requirements lock generator variant
- `out_of_scope` section enforcement (scope drift detection)

### 4.2 From `repeatability-mcp-server`

**Remote overlay abstraction** (fully merged):
- `OverlayProvider` interface with `"local" | "mcp"` runtime — directly enables repeatability-mcp-server to be wired as a remote overlay
- `McpOverlayProvider` with two-tier failure model (transport vs. schema violations)
- `buildProviderChain()` with locked composition order
- `src/types/overlay-protocol.ts` — `OverlayVerdict`, `OverlayDecision`, `OverlayContext`

**Not yet merged from `repeatability-mcp-server`:**
- MCP tools for graph-based planning phase
- Requirements lock file as a first-class workflow artifact type
- LLM evaluation framework (stability rate, drift rate metrics)
- AST contract extractors
- `graph_validate` wired to the evidence gate overlay
- Coverage gap detection via query engine integrated with policy gate

---

## Part 5: Proposal — Unified Ecosystem Architecture

### 5.1 The Vision

These three projects form a natural, non-overlapping stack:

```
╔═══════════════════════════════════════════════════════════════════╗
║                         DEVELOPER                                 ║
║         /sdd-run → HIL approvals → /sdd-status                   ║
╚════════════════════════╤══════════════════════════════════════════╝
                         │
╔════════════════════════▼══════════════════════════════════════════╗
║                   ai-sdd  (Orchestration Layer)                   ║
║                                                                   ║
║  workflow.yaml → engine.ts → state-manager.ts                    ║
║  ├── Task dispatch with assembled context                        ║
║  ├── Overlay chain: HIL → Evidence Gate → Review → Confidence    ║
║  ├── Remote overlays via MCP (OverlayProvider interface)         ║
║  ├── Hook system: pre/post task, pre/post rework                 ║
║  ├── Constitution: merges standards/**/*.md into every prompt    ║
║  └── Artifacts: tracks lock file + all task outputs              ║
╚══════╤═══════════════════════╤═══════════════════════════════╤════╝
       │ planning tasks         │ implement tasks               │ review tasks
       ▼                        ▼                               ▼
╔══════════════════╗  ╔════════════════════════╗  ╔══════════════════════╗
║ repeatability-   ║  ║   coding-standards     ║  ║  coding-standards    ║
║ mcp-server       ║  ║   (coder agent)        ║  ║  (reviewer agent)    ║
║                  ║  ║                        ║  ║                      ║
║ graph_init       ║  ║ • CLAUDE.md contract   ║  ║ • code-reviewer.md   ║
║ graph_add_node   ║  ║ • 90% rule + GO        ║  ║ • 6-gate validation  ║
║ graph_validate   ║  ║ • requirements.lock    ║  ║ • semantic-drift-    ║
║ graph_export     ║  ║   as ground truth      ║  ║   check.sh           ║
║                  ║  ║ • java/kotlin rules    ║  ║ • PR checklist       ║
║ → specs/         ║  ║   (from standards/)    ║  ║                      ║
║   requirements   ║  ║                        ║  ║                      ║
║   .lock.yaml     ║  ║                        ║  ║                      ║
╚══════╤═══════════╝  ╚════════════════════════╝  ╚══════════════════════╝
       │                        │                               │
       └────────────────────────┴───────────────────────────────┘
                            shared artifact:
                      specs/requirements.lock.yaml
                    (first-class ai-sdd artifact, consumed
                     by all downstream tasks via constitution)
```

**Clean layer interfaces:**
- **ai-sdd** controls *when* and *which* agents run, manages state, gates, and HIL
- **repeatability-mcp-server** ensures the *planning phase* produces a typed, validated, reproducible graph
- **coding-standards** ensures *implementation agents* receive the right behavioral contracts, language rules, and validation gates

### 5.2 How `repeatability-mcp-server` Complements `ai-sdd`

#### 5.2.1 Planning Phase: MCP-Guided Graph Construction

Currently, `define-requirements` in ai-sdd dispatches to an agent with a text prompt and expects a markdown output. With repeatability-mcp-server integrated, the task becomes:

```yaml
# specs/workflow.yaml — enhanced define-requirements task
tasks:
  define-requirements:
    agent: ba
    description: |
      Build the requirements graph using the MCP tools, then export the
      requirements lock. Every REQ must have ≥1 TASK and ≥1 TESTSPEC before
      the graph can be exported.
    mcp_servers:
      - name: requirement-lock-server
        transport: stdio
        command: node
        args: [.tools/requirement-lock-server/dist/index.js]
    outputs:
      - path: specs/requirements.lock.yaml
        contract: requirements_lock
    exit_conditions:
      - "graph_validate.passed == true"
      - "graph_export.hash != null"
```

The BA agent:
1. Calls `graph_init` → gets sessionId
2. Iteratively adds `REQ`, `NFR`, `DEC`, `ASSUMPTION` nodes via `graph_add_node`
3. Adds `TASK` and `TESTSPEC` nodes with `IMPLEMENTS` and `COVERS` edges
4. Calls `graph_validate` — if errors, clarifies with HIL before proceeding
5. Calls `graph_export format: requirements_lock`
6. Writes to `specs/requirements.lock.yaml` via `complete-task`

This transforms planning from free-form text generation to a **typed, validated, reproducible artifact**.

#### 5.2.2 Evidence Gate: Query-Based Gap Detection

ai-sdd's evidence gate overlay (`overlays/policy-gate/gate-overlay.ts`) currently checks declared evidence fields in `handover_state`. It can be extended to run the query engine against the lock:

```typescript
// overlays/policy-gate/gate-overlay.ts
async function checkRequirementsLockCoverage(lockPath: string): Promise<GateVerdict> {
  const result = await runQueryEngine("gaps", lockPath);
  const gaps = result.data;

  if (gaps.reqsWithoutTasks.length > 0) {
    return {
      verdict: "REWORK",
      reason: `Requirements without tasks: ${gaps.reqsWithoutTasks.join(", ")}`,
    };
  }
  if (gaps.reqsWithoutTests.length > 0) {
    return {
      verdict: "REWORK",
      reason: `Requirements without tests: ${gaps.reqsWithoutTests.join(", ")}`,
    };
  }
  return { verdict: "PASS" };
}
```

This means `design-l1` cannot start until the requirements lock has **zero coverage gaps** — the evidence gate enforces it.

#### 5.2.3 Lock File as First-Class Workflow Artifact

```yaml
# data/artifacts/schema.yaml — new artifact type
artifact_types:
  requirements_lock:
    version: "1"
    required_sections: [requirements, decisions, tasks, testspecs]
    required_fields:
      metadata: [version, spec_hash, approved_by, approval_token]
    file_format: yaml
```

The constitution manifest writer then tracks the lock like any other artifact:

```markdown
| Task                | Artifact            | Path                           | Status    |
|--------------------|---------------------|--------------------------------|-----------|
| define-requirements | Requirements Lock   | specs/requirements.lock.yaml   | COMPLETED |
| design-l1          | L1 Architecture     | specs/design-l1.md             | COMPLETED |
```

Every downstream task receives `specs/requirements.lock.yaml` as a context anchor — the agent knows exactly what it's allowed to build.

#### 5.2.4 Repeatability Metrics in ai-sdd Observability

ai-sdd already has `ObservabilityEmitter` with structured events. repeatability-mcp-server's eval framework feeds into it:

```typescript
// src/observability/events.ts — new event types
| "repeatability.contract_stability"  // contractStabilityRate per task
| "repeatability.drift_detected"      // unjustified change in contract hash
| "repeatability.run_completed"       // eval run metrics summary
```

These surface in `ai-sdd status --metrics`:
```
Task: standard-implement
  Contract stability rate: 94.2%
  Drift events:            0
  Unique contract versions: 2 (v1 → v2 with documented change reason)
```

#### 5.2.5 MCP Overlay Wiring (Using Existing Infrastructure)

Since ai-sdd already has the `McpOverlayProvider` (merged from the remote overlay abstraction), repeatability-mcp-server can be connected as a **validation overlay** for planning tasks:

```yaml
# ai-sdd.yaml
overlay_backends:
  - id: requirement-lock-server
    transport: stdio
    command: node
    args: [.tools/requirement-lock-server/dist/index.js]

remote_overlays:
  - name: requirements-coverage-check
    backend_id: requirement-lock-server
    hooks: [post_task]
    applies_to_tasks: [define-requirements, design-l1]
    failure_policy: fail_closed
```

The overlay calls `graph_validate` via MCP and maps the result to an `OverlayVerdict` (`PASS`/`REWORK`/`HIL`).

### 5.3 How `coding-standards` Complements `ai-sdd` (Remaining Work)

#### 5.3.1 Agent Prompt Library → ai-sdd Task Library Templates

```yaml
# data/task-library/requirements-driven-implement.yaml
name: requirements-driven-implement
agent: dev
description: |
  Implement tasks from the requirements lock following the 90% rule.
  MUST NOT implement anything outside the lock. Write LOCKED REQUIREMENTS
  at the start of your response. Follow language-specific standards.
context_includes:
  - specs/requirements.lock.yaml    # Ground truth
  - standards/**/*.md               # Injected via constitution
  - agents/coder.md                 # System prompt from coding-standards
overlays:
  hil: { enabled: true }
  policy_gate: { risk_tier: T1 }
outputs:
  - path: "specs/{{task_id}}-notes.md"
    contract: standard_review
exit_conditions:
  - "policy_gate.verdict == PASS"
```

The `agents/coder.md` system prompt from `coding-standards` becomes the behavioral contract for the dev agent in ai-sdd tasks.

#### 5.3.2 Validation Gates as Post-Task Hooks

coding-standards' 6-gate pipeline maps directly to ai-sdd's hook system:

```yaml
# specs/workflow.yaml
defaults:
  hooks:
    post_task:
      - id: gate-0-spec-identity
        command: bash .tools/coding-standards/scripts/spec-hash-verify.sh specs/requirements.lock.yaml
        on_failure: needs_rework
        applies_to: [standard-implement]
      - id: gate-1-contract-drift
        command: bash .tools/coding-standards/scripts/semantic-drift-check.sh --gate contract
        on_failure: hil_pending
        applies_to: [standard-implement]
      - id: gate-2-scope-drift
        command: bash .tools/coding-standards/scripts/semantic-drift-check.sh --gate scope
        on_failure: needs_rework
        applies_to: [standard-implement]
      - id: gate-3-arch-drift
        command: bash .tools/coding-standards/scripts/semantic-drift-check.sh --gate architecture
        on_failure: needs_rework
        applies_to: [standard-implement]
```

Gate failures map to ai-sdd state transitions: `needs_rework` → `NEEDS_REWORK`; `hil_pending` → `HIL_PENDING`.

#### 5.3.3 Model Routing into Per-Agent YAML

```yaml
# data/agents/defaults/dev.yaml
name: dev
display_name: Developer
llm:
  provider: anthropic
  model: claude-sonnet-4-6
  hyperparameters:
    temperature: 0.1       # Low temperature for deterministic implementation

# data/agents/defaults/ba.yaml
name: ba
display_name: Business Analyst
llm:
  provider: anthropic
  model: claude-opus-4-6
  hyperparameters:
    temperature: 0.3       # Higher for exploratory requirements work
```

This is the `model-routing.yaml` pattern from coding-standards applied to ai-sdd's agent YAML system.

#### 5.3.4 Spec Hash as Workflow Artifact

```yaml
# data/artifacts/schema.yaml — new artifact type
artifact_types:
  spec_hash:
    version: "1"
    required_fields: [hash, lock_path, computed_at]
    file_format: text
```

After `define-requirements`, a post-task hook runs `spec-hash.sh` and writes `.spec-hash` as a tracked artifact. All subsequent gates compare against this baseline — unintended changes to the lock are detected automatically.

#### 5.3.5 Rework Circuit-Breaker Alignment

coding-standards' `check-iteration-limits.sh` and ai-sdd's `max_rework_iterations` serve the same purpose. They should be aligned:

```yaml
# task library defaults
max_rework_iterations: 3           # ai-sdd engine enforces via state machine
hooks:
  pre_rework:
    - id: circuit-breaker
      command: bash .tools/coding-standards/scripts/check-iteration-limits.sh
      on_failure: failed           # Final kill switch if script says too many iterations
```

### 5.4 Full Ecosystem Workflow: End-to-End Example

**Scenario:** "Create Order" feature using the unified ecosystem.

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: ai-sdd dispatches define-requirements               │
│                                                             │
│  Agent receives:                                            │
│    • constitution.md (project rules)                        │
│    • standards/java/CLAUDE-java.md (merged automatically)   │
│    • agents/constitution.md (from coding-standards)         │
│                                                             │
│  Agent uses MCP tools:                                      │
│    graph_init → graph_add_node(REQ-001, REQ-002, NFR-001)   │
│    graph_add_node(TASK-001, TASK-002, AC-001, AC-002)       │
│    graph_add_node(TESTSPEC-001, TESTSPEC-002)               │
│    graph_add_edge(TASK-001 IMPLEMENTS REQ-001)              │
│    graph_validate → 0 errors, 1 warning (NFR coverage)     │
│    graph_export → specs/requirements.lock.yaml              │
│                                                             │
│  ai-sdd HIL gate (T2):                                      │
│    Human reviews lock → "GO" → HIL resolved                 │
│    spec-hash.sh runs → .spec-hash stored                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 2: Evidence gate (policy-gate overlay)                 │
│                                                             │
│  query-engine gaps: 0 gaps required → PASS                 │
│  reproducibility-check.sh: OpenAPI baseline set            │
│  Only dispatches design-l1 if gate passes                   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 3: ai-sdd dispatches design-l1                        │
│                                                             │
│  Agent receives requirements.lock.yaml in context           │
│  Agent adds DEC nodes to graph (via MCP)                    │
│  Agent produces specs/design-l1.md                         │
│  Post-task: gate-0 spec-hash-verify.sh → PASS              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 4: ai-sdd dispatches standard-implement                │
│  (per TASK-001, TASK-002 from the lock)                     │
│                                                             │
│  Agent receives:                                            │
│    • requirements.lock.yaml (ground truth)                  │
│    • agents/coder.md system prompt (90% rule, GO protocol)  │
│    • standards/java/CLAUDE-java.md (hexagonal arch rules)   │
│    • constitution.md (artifact manifest)                    │
│                                                             │
│  Agent produces ONLY what is in the lock                    │
│                                                             │
│  Post-task gates run:                                       │
│    Gate 0: spec-hash-verify → PASS                         │
│    Gate 1: contract-drift check → PASS                     │
│    Gate 2: scope-drift scan (no "payment" in code) → PASS  │
│    Gate 3: arch-drift (no spring in domain) → PASS         │
│                                                             │
│  Gate failure → NEEDS_REWORK (max 3 iterations)            │
│  3rd failure → HIL escalation                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 5: ai-sdd dispatches review-implementation             │
│                                                             │
│  Agent receives code + lock + agents/code-reviewer.md       │
│  Agent verifies: all ACs covered, no gold-plating, drift=0  │
│  Output: review report (GO / NO_GO)                         │
│                                                             │
│  Repeatability metrics logged:                              │
│    contractStabilityRate: 96.2%                             │
│    driftEvents: 0                                           │
│    uniqueContractVersions: 1                                │
│                                                             │
│  Constitution manifest updated with all artifacts           │
│  PR created with pull-request-checklist.md applied         │
└─────────────────────────────────────────────────────────────┘
```

### 5.5 Repository Layout for the Integrated Ecosystem

```
my-project/
├── CLAUDE.md                          # From coding-standards (project root)
├── constitution.md                    # ai-sdd project constitution
├── ai-sdd.yaml                        # ai-sdd config (adapter, overlays, engine)
│
├── specs/
│   ├── workflow.yaml                  # ai-sdd workflow (or per-feature)
│   ├── requirements.lock.yaml         # Produced by define-requirements
│   ├── design-l1.md                   # L1 architecture output
│   ├── design-l2.md                   # L2 component design output
│   └── plan-tasks/
│       ├── plan.md                    # Task breakdown index
│       └── tasks/                     # Hierarchical task files (T-NNN)
│           ├── TG-01-order-domain/
│           │   ├── T-001-create-order.md
│           │   └── T-002-cancel-order.md
│           └── TG-02-persistence/
│               └── T-010-order-repository.md
│
├── standards/                         # Auto-merged into constitution
│   ├── java/CLAUDE-java.md            # From coding-standards
│   ├── kotlin/CLAUDE-kotlin.md        # From coding-standards
│   └── general/CLAUDE.md             # General AI coding contract
│
├── agents/                            # From coding-standards
│   ├── constitution.md                # Mandatory baseline for all agents
│   ├── coder.md                       # Coder system prompt (90% rule)
│   ├── code-reviewer.md               # Reviewer system prompt
│   └── model-routing.yaml             # Phase → model mapping
│
├── .ai-sdd/                           # Runtime-only (state, not artifacts)
│   ├── ai-sdd.yaml                    # (if not at root)
│   ├── state/
│   │   ├── workflow-state.json
│   │   └── hil/                       # HIL queue
│   └── workflows/                     # Custom workflow overrides
│
├── .tools/                            # Integrated tools (git-ignored or vendored)
│   ├── requirement-lock-server/       # repeatability-mcp-server package
│   └── coding-standards/
│       └── scripts/                   # Validation gate scripts
│
└── src/                               # Implementation output
```

### 5.6 Integration Roadmap

#### Phase 1 — Already Done ✅

| Item | Status |
|------|--------|
| `standards/**/*.md` auto-merged into constitution | ✅ Done |
| `--standards <paths>` CLI flag | ✅ Done |
| `specs/` as artifact output location | ✅ Done |
| `specs/<feature>/workflow.yaml` lookup | ✅ Done |
| `--feature <name>` CLI flag | ✅ Done |
| Directory prefix allowlist for `tasks/` tree | ✅ Done |
| Remote overlay abstraction (`McpOverlayProvider`) | ✅ Done |
| `CANCELLED` task state | ✅ Done |

#### Phase 2 — Lock File as First-Class Artifact

| Item | Priority |
|------|---------|
| Add `requirements_lock` artifact type to `data/artifacts/schema.yaml` | High |
| Add `spec_hash` artifact type | High |
| Update `define-requirements` task library template to produce lock | High |
| Update downstream task templates to consume lock path in context | High |
| Wire `agents/coder.md` from coding-standards as dev task system prompt | Medium |

#### Phase 3 — Graph MCP Integration

| Item | Priority |
|------|---------|
| Add `requirement-lock-server` as optional dep in `ai-sdd init` | High |
| Add planning task variant that uses graph MCP tools | High |
| Wire `graph_validate` result to evidence gate via `McpOverlayProvider` | High |
| Extend policy gate to run query-engine gaps check on lock | Medium |
| Add `requirements-coverage-check` as a remote overlay type | Medium |

#### Phase 4 — Validation Gates as Hooks

| Item | Priority |
|------|---------|
| Add `spec-hash-verify.sh` as a post-task hook template | High |
| Add gate-1 through gate-4 as configurable post-task hooks | High |
| Map gate failures to `NEEDS_REWORK` / `HIL_PENDING` | High |
| Add `reproducibility-check.sh` to task library post-task hooks | Medium |
| Align `max_rework_iterations` with `check-iteration-limits.sh` | Low |

#### Phase 5 — Repeatability Metrics

| Item | Priority |
|------|---------|
| Add `RepeatabilityMetrics` type to `src/observability/` | Medium |
| New event types: `repeatability.contract_stability`, `repeatability.drift_detected` | Medium |
| Feed metrics into `ai-sdd status --metrics` output | Medium |
| Store per-task stability rates in workflow state | Low |

#### Phase 6 — Model Routing and Advanced Features

| Item | Priority |
|------|---------|
| `agent_routing` config section in `ai-sdd.yaml` (per phase/role) | Medium |
| Phase-to-model mapping in per-agent YAML defaults | Medium |
| AST contract extractors as post-implement hooks | Low |
| Diff-aware lock generator variant for brownfield features | Low |

### 5.7 Integration Points Summary

| Integration Point | Mechanism |
|-------------------|-----------|
| Lock file production | repeatability-mcp-server MCP tools used by planning agent in ai-sdd task |
| Lock file consumption | Constitution manifest injects lock path into downstream task contexts |
| Standards injection | `standards/**/*.md` auto-merged by `ConstitutionResolver` (already done) |
| Validation gates | coding-standards scripts as ai-sdd post-task hooks in workflow.yaml |
| Coverage evidence gate | policy-gate overlay calls query-engine gaps on lock |
| Graph validation overlay | `McpOverlayProvider` calls `graph_validate` post-task |
| Model routing | coding-standards `model-routing.yaml` → ai-sdd per-agent YAML config |
| Rework limits | ai-sdd `max_rework_iterations` + `check-iteration-limits.sh` pre-rework hook |
| Human governance | ai-sdd HIL queue as GO Protocol implementation |
| Contract extraction | AST extractors as post-implement hooks, hash stored as artifact |
| Repeatability metrics | eval framework feeds into ai-sdd `ObservabilityEmitter` |
| Spec hash baseline | post-define-requirements hook writes `.spec-hash`, gate-0 verifies it |

---

## Part 6: Terminology Alignment

| Concept | `ai-sdd` | `repeatability-mcp-server` | `coding-standards` |
|---------|----------|---------------------------|-------------------|
| Task unit | Task (workflow.yaml) | `TASK` node | `tasks[].id: TASK-NNN` |
| Requirement | — (via lock) | `REQ` node | `requirements[].id: REQ-NNN` |
| Acceptance criteria | — (via lock) | `AC` node | `requirements[].acceptance_criteria[]` |
| Test spec | — (via lock) | `TESTSPEC` node | `testspecs[].id: TESTSPEC-NNN` |
| Interface contract | — (via lock) | `CONTRACT` node | `contracts[].id: CONTRACT-NNN` |
| Architecture decision | — (via lock) | `DEC` node | `decisions[].id: DEC-NNN` |
| Evidence | `handover_state` fields | Graph coverage query result | Validation gate pass |
| Rework | `NEEDS_REWORK` state | Validation rule violation | Drift detection failure |
| Human gate | `HIL_PENDING` state | `governance.approval_token: GO` | GO Protocol |
| Agent config | Agent YAML (`agents/defaults/`) | `llm:` section in lock | `model-routing.yaml` |
| Project rules | `constitution.md` | `agent-constitution-server` | `agents/constitution.md` |
| Output artifact | Manifest entry | Exported lock file | Lock file + contract hash |
| Language rules | `standards/**/*.md` (merged) | — | `java/CLAUDE-java.md` etc. |
| Workflow definition | `workflow.yaml` | — | `workflow/state-machine.yaml` |
| Scope control | — (not yet) | `scope.excluded` + validation | Gate 2: scope drift scan |
| Reproducibility | — (planned) | seed + temperature in lock | spec-hash + drift gates |
| State persistence | `.ai-sdd/state/workflow-state.json` | LadybugDB (`.ldb`) / memory | YAML in git |

---

## Conclusion

These three projects form a genuinely complementary ecosystem for AI-driven agentic software development:

- **`coding-standards`** provides the *discipline layer*: behavioral contracts for agents, language-specific rules, validation gates, and the human approval protocol. It is a mature answer to "how do we constrain what AI builds."

- **`repeatability-mcp-server`** provides the *planning layer*: a typed, validated, reproducible graph of requirements and their relationships, with measurement of LLM stability. It is a structural answer to "how do we ensure planning is consistent and traceable."

- **`ai-sdd`** provides the *orchestration layer*: the workflow engine that coordinates agents, manages state, enforces gates, and provides human-in-the-loop integration. It is the answer to "how do we run a multi-agent development pipeline reliably."

The key insight that unifies them: **traceability is the foundation of repeatability**. When every implementation element (task, test, contract) traces back to a stated requirement, and when that requirement is locked with human approval, the scope for AI hallucination, gold-plating, and drift is systematically eliminated — not through better prompting, but through structural constraint.

`ai-sdd` is the right place to integrate the best of all three because it already has the orchestration infrastructure (state machine, overlays, HIL queue, hooks) and has already absorbed the first wave of `coding-standards` features (standards injection, output structure, workflow discovery). The next wave — lock file as artifact, validation gates as hooks, MCP graph planning tools, and repeatability metrics — completes the picture.
