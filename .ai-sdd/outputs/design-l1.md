# L1 Architecture — Remote Overlay Abstraction

**Feature**: Remote Overlay Abstraction (ROA)
**Architect review date**: 2026-03-07
**Inputs**: specs/merge-coding-standards/REMOTE-OVERLAY-PLAN.md, specs/remote-overlay-abstraction/FR/*.md, specs/remote-overlay-abstraction/NFR/*.md
**Status**: APPROVED — proceed to L2 component design

---

## 1. System Purpose

Extend ai-sdd with a transport-agnostic overlay provider layer so that external governance services (initially the `coding-standards` repo) can participate in workflow overlay decisions over MCP without merging their internals into ai-sdd.

The invariant that the engine is the **single enforcement point** is preserved: remote overlay providers return normalized `OverlayDecision` verdicts; only the engine maps verdicts to state transitions.

---

## 2. Architectural Principles

| Principle | Implication |
|-----------|-------------|
| Transport agnosticism | `OverlayProvider` interface hides whether the overlay runs in-process, as a CLI subprocess, or over MCP |
| No-mutation invariant | Remote overlays return verdicts only; they cannot write state files, mutate artifacts, or transition tasks |
| Backward compatibility | All 177 existing tests must continue passing; new config sections are optional; absence of remote config = identical behavior |
| Schema as security boundary | Every response from a remote provider is Zod-validated before the engine consumes it; schema violations are always `fail_closed` |
| Engine as single enforcement point | Only `src/core/engine.ts` maps `OverlayDecision` to `TaskStatus` transitions |
| Fail-safe defaults | Default `failure_policy: warn`; transport errors produce PASS + observability event, never silent failures |

---

## 3. Module Boundaries

### 3.1 New Modules (added in this feature)

```
src/types/overlay-protocol.ts
  Exports: OverlayVerdict, OverlayHook, OverlayRuntime, OverlayEvidence,
           OverlayDecision, OverlayContext (extended), OverlayInvokeInput,
           OverlayInvokeOutput (Zod schemas)

src/overlays/provider.ts
  Exports: OverlayProvider interface

src/overlays/local-overlay-provider.ts
  Exports: LocalOverlayProvider class
  Adapts: BaseOverlay → OverlayProvider
  Maps: OverlayResult / PostTaskOverlayResult → OverlayDecision

src/overlays/mcp/mcp-client.ts
  Exports: McpClientWrapper class, McpTimeoutError, McpNotConnectedError
  Dependency: @modelcontextprotocol/sdk (stdio transport only)

src/overlays/mcp/mcp-overlay-provider.ts
  Exports: McpOverlayProvider class
  Uses: McpClientWrapper, OverlayInvokeOutput Zod schema

src/overlays/cli/cli-overlay-provider.ts
  Exports: CliOverlayProvider class
  Uses: Bun subprocess API, OverlayInvokeOutput Zod schema

src/overlays/registry.ts
  Exports: buildProviderChain(config) → OverlayProvider[]
  Consumes: ProjectConfig overlay_backends + remote_overlays
  Produces: ordered provider list ready for chain runner

src/overlays/provider-chain.ts
  Exports: runPreProviderChain, runPostProviderChain
  Replaces: runPreTaskChain / runPostTaskChain in base-overlay.ts
  Extends: composition-rules.ts validation (new rule: remote before policy_gate)

src/config/remote-overlay-schema.ts
  Exports: OverlayBackendConfig, RemoteOverlayConfig, GovernanceConfig Zod schemas
  Used by: config loader (src/config/loader.ts or equivalent)
```

### 3.2 Modified Modules

```
src/types/index.ts
  + TaskStatus: add "CANCELLED"
  + VALID_TRANSITIONS: CANCELLED reachable from all non-terminal states; terminal
  + TaskDefinition: add requirement_ids, acceptance_criteria, scope_excluded,
                    budget, phase (all optional)
  + GatedHandoverState interface
  + ProjectConfig: add governance block, overlay_backends, remote_overlays

src/core/engine.ts
  - Replace runPreTaskChain / runPostTaskChain calls
  + Call runPreProviderChain / runPostProviderChain from provider-chain.ts
  + Exhaustive switch on OverlayVerdict → TaskStatus transition
  + Persist OverlayDecision.evidence to task state record
  + Guard: updated_context from remote may not overwrite state identity fields

src/observability/events.ts (or equivalent EventType union)
  + overlay.remote.connecting, overlay.remote.connected, overlay.remote.invoked,
    overlay.remote.decision, overlay.remote.failed, overlay.remote.fallback

src/overlays/composition-rules.ts
  + New invariant: remote overlays must slot between HIL and policy_gate
  + Extended validateOverlayCombination to accept OverlayProvider[] alongside BaseOverlay[]
```

### 3.3 Unchanged Modules

All existing overlay implementations (hil/, policy-gate/, review/, paired/, confidence/) are unchanged. They continue to implement `BaseOverlay` and are wrapped transparently by `LocalOverlayProvider`. The existing `runPreTaskChain` / `runPostTaskChain` functions in `base-overlay.ts` are retained (not deleted) for backward compatibility but are no longer called by the engine directly.

---

## 4. Data Flow

### 4.1 Pre-task Overlay Chain (new flow)

```
engine.runTask(taskDef)
  │
  ├─ buildProviderChain(config)
  │    ├─ LocalOverlayProvider(hil)
  │    ├─ McpOverlayProvider(requirements_governor) [if configured]
  │    ├─ LocalOverlayProvider(policy_gate)
  │    ├─ LocalOverlayProvider(review) [XOR paired]
  │    ├─ LocalOverlayProvider(paired) [XOR review]
  │    └─ LocalOverlayProvider(confidence)
  │
  ├─ runPreProviderChain(chain, ctx)
  │    for each provider where hook "pre_task" declared and phase matches:
  │      decision = provider.invokePre(ctx)
  │      if decision.verdict != PASS → return decision (short-circuit)
  │    return PASS decision
  │
  └─ mapVerdict(decision.verdict) → state transition
       PASS     → continue to agent dispatch
       REWORK   → transition NEEDS_REWORK, store feedback
       FAIL     → transition FAILED, store evidence
       HIL      → transition HIL_PENDING, enqueue item
```

### 4.2 Remote Provider Invocation (McpOverlayProvider)

```
McpOverlayProvider.invokePre(ctx)
  │
  ├─ emit overlay.remote.connecting
  ├─ client.connect()  [McpClientWrapper]
  ├─ emit overlay.remote.connected
  ├─ emit overlay.remote.invoked
  ├─ client.callTool("overlay.invoke", buildInput(ctx))
  │    [timeout enforced at McpClientWrapper level]
  │
  ├─ [success path]
  │    parse response with OverlayInvokeOutput.parse(raw)  [Zod]
  │    map to OverlayDecision
  │    emit overlay.remote.decision
  │    return OverlayDecision
  │
  └─ [failure paths]
       Transport error (timeout, connection refused)
         → failure_policy == skip    → return PASS (silent)
         → failure_policy == warn    → emit overlay.remote.failed (tier=transport)
                                       emit overlay.remote.fallback
                                       return PASS
         → failure_policy == fail_closed → return FAIL
       Schema violation (Zod fails, unknown verdict, non-JSON)
         → always return FAIL (tier=schema), not governed by failure_policy
         → emit overlay.remote.failed (tier=schema)
```

### 4.3 CANCELLED State Transitions

```
TaskStatus state machine (updated):

  PENDING ──────────────────────────────────────┐
    │ RUNNING                                    │
    ▼                                            │ CANCELLED
  RUNNING ─────────────────────────────────────►│ (from any non-terminal)
    │ COMPLETED / NEEDS_REWORK / HIL_PENDING     │
    │ FAILED                                     │
    ▼                                            │
  NEEDS_REWORK ───────────────────────────────►│
  HIL_PENDING  ───────────────────────────────►│
                                                ▼
                                          CANCELLED (terminal)
```

---

## 5. Technology Stack (unchanged + additions)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Bun | Unchanged |
| Language | TypeScript strict | Unchanged |
| Schema validation | Zod v3 | Unchanged; new schemas added |
| MCP client | @modelcontextprotocol/sdk | New dependency (McpClientWrapper only) |
| CLI subprocess | Bun subprocess API | New usage in CliOverlayProvider |
| Config | YAML + Zod | New config sections parsed by existing loader |

---

## 6. Provider Chain Order (locked invariant)

```
HIL (local, default ON)
  ↓
Remote overlays (insertion order from remote_overlays config)
  ↓
Policy Gate / Evidence Gate (local)
  ↓
Agentic Review (local) [XOR Paired]
  ↓
Paired Workflow (local) [XOR Review]
  ↓
Confidence (local)
  ↓
Agent Dispatch
```

This order is **invariant**. Configuration cannot reorder local overlays relative to each other or to the remote overlay slot. `registry.ts` enforces this at build time. `composition-rules.ts` validates it.

---

## 7. Config Architecture

### 7.1 New Config Sections (all optional)

```yaml
# .ai-sdd/ai-sdd.yaml additions (optional — absence = no change to behavior)

governance:
  requirements_lock: warn   # off | warn | enforce (default: warn)

overlay_backends:
  <backend_id>:
    runtime: cli | mcp
    command: [string]
    tool: string             # required if runtime == mcp
    transport: stdio         # only stdio supported
    timeout_ms: 5000         # default
    failure_policy: warn     # skip | warn | fail_closed (default: warn)
    env: {}                  # env vars for CLI runtime

remote_overlays:
  <overlay_name>:
    backend: <backend_id>
    enabled: true            # default
    hooks: [pre_task, post_task]  # at least one required
    phases: []               # optional phase filter
    blocking: true           # default
    config: {}               # passthrough to remote
```

### 7.2 Config Merge Order (unchanged)

`CLI flags > project .ai-sdd/ai-sdd.yaml > src/config/defaults.ts`

New sections (`governance`, `overlay_backends`, `remote_overlays`) follow the same order. They are validated by `src/config/remote-overlay-schema.ts` Zod schemas as part of the existing config load path.

---

## 8. MCP Protocol Contract

### 8.1 Single Tool: `overlay.invoke`

ai-sdd calls exactly one tool on remote MCP servers. The tool name is configurable per backend (`tool` field in `OverlayBackendConfig`).

**Input** (sent by McpOverlayProvider):
```
protocol_version: "1"
overlay_id: string
hook: "pre_task" | "post_task"
workflow: { id, run_id }
task: { id, phase?, requirement_ids?, acceptance_criteria?, scope_excluded? }
artifacts?: { requirements_lock_path?, state_path?, outputs? }
result?: { outputs?, handover_state? }   # only for post_task
config?: {}  # passthrough from remote_overlays[].config
```

**Output** (received and Zod-validated by McpOverlayProvider):
```
protocol_version: "1"
verdict: "PASS" | "REWORK" | "FAIL" | "HIL"
feedback?: string
evidence?: { overlay_id, checks?, report_ref?, data? }
```

Any deviation from this schema (wrong verdict, missing fields, non-JSON) is a Tier 2 schema violation → always FAIL.

---

## 9. Observability Architecture

New events follow the existing `ObservabilityEvent` structure in `src/types/index.ts`. They must be added to the `EventType` union:

| Event | Emitter | Key payload fields |
|-------|---------|-------------------|
| `overlay.remote.connecting` | McpClientWrapper.connect() | overlay_name, backend_id, task_id |
| `overlay.remote.connected` | McpClientWrapper.connect() | overlay_name, backend_id, duration_ms |
| `overlay.remote.invoked` | McpOverlayProvider / CliOverlayProvider | overlay_name, backend_id, hook |
| `overlay.remote.decision` | McpOverlayProvider / CliOverlayProvider | verdict, duration_ms |
| `overlay.remote.failed` | McpOverlayProvider / CliOverlayProvider | failure_tier, error_message, duration_ms |
| `overlay.remote.fallback` | McpOverlayProvider / CliOverlayProvider | failure_policy |

Secret redaction (existing log sanitizer) applied to all event payloads before emission.

---

## 10. Security Architecture

| Threat | Mitigation |
|--------|-----------|
| Rogue remote returns malformed verdict | Zod validation; schema violation → FAIL (Tier 2, not policy-governed) |
| Remote overlay tries to mutate state fields via updated_context | Engine guards: updated_context may not overwrite task_id, status, workflow_id, run_id |
| Secret leakage in observability | Existing log sanitizer applied to all remote overlay event payloads |
| Remote overlay returns FORCE_ACCEPT or other fake pass | Unknown verdict fails Zod enum check → Tier 2 failure → FAIL |
| Timeout / availability attack via slow remote | Per-call timeout (default 5000ms); failure_policy governs outcome |

---

## 11. Backward Compatibility

| Guarantee | How enforced |
|-----------|-------------|
| All 177 existing tests pass | Phase 1 exit gate — run before any merge |
| Existing overlay behavior unchanged | LocalOverlayProvider wraps BaseOverlay with identity mapping |
| Existing config unchanged | New config sections are optional; their absence = no behavior change |
| Existing state machine unchanged | CANCELLED addition is additive; FAILED/COMPLETED behavior unchanged |
| `buildOverlayChain` / `runPreTaskChain` preserved | Not deleted; engine switches to provider-chain runner but old functions remain for tests |

---

## 12. Implementation Phasing

| Phase | Modules | Exit Gate |
|-------|---------|-----------|
| Phase 1: Types + Provider Abstraction | overlay-protocol.ts, provider.ts, local-overlay-provider.ts, registry.ts, provider-chain.ts, engine.ts integration | 177 tests pass + new local provider tests |
| Phase 2: CANCELLED State | types/index.ts (CANCELLED), state-manager.ts, CLI status | CANCELLED state machine tests |
| Phase 3: CLI Sidecar | cli/cli-overlay-provider.ts, remote-overlay-schema.ts, config integration | Mock CLI tests + config validation tests |
| Phase 4: MCP Provider | mcp/mcp-client.ts, mcp/mcp-overlay-provider.ts | Mock MCP server tests |
| Phase 5 (coding-standards): Overlay Facade | overlay.invoke MCP tool (out of scope for ai-sdd) | Integration test: ai-sdd → coding-standards |
| Phase 6: Integration | E2E tests, observability events, agent prompts | All tests pass; warn-mode remote governance working |

Phases 1 and 2 are independent (parallel). Phase 3 and Phase 4 are independent after Phase 1. Phase 5 (coding-standards server) is independent of all ai-sdd phases except ROA-001 (protocol types).

---

## 13. Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Single `OverlayProvider` interface for all runtimes | Engine calls one interface; transport complexity is encapsulated |
| `LocalOverlayProvider` wraps existing `BaseOverlay` | Zero behavioral change for all existing overlays; no rewrite needed |
| `CliOverlayProvider` as first remote transport | Pragmatic: reuses existing coding-standards CLI tools immediately; no MCP client complexity |
| Registry + chain runner as separate modules | Registry compiles config → providers (build-time); chain runner executes (runtime); clean separation |
| Two-tier failure model (transport vs schema) | Transport errors are tolerable with policy; schema violations are always fail_closed — rogue remotes cannot silently pass |
| Engine remains single enforcement point | Remote overlays return verdicts only; no direct state writes |
| `CANCELLED` as only new state | All other coding-standards states map to existing ai-sdd mechanisms; only CANCELLED is genuinely missing |
| `overlay.invoke` as single MCP tool | ai-sdd stays generic; coding-standards owns routing to its internal tools |
| Remote overlays slot after HIL | Human always has first say; governance before expensive review/paired workflows |
