# L1 Architecture — Remote Overlay Abstraction

## Overview

The Remote Overlay Abstraction adds a transport-agnostic overlay provider system to ai-sdd.
The core insight is that governance decisions (proceed/rework/fail) should be separable from
where they are computed — in-process, or on a remote MCP server. The engine becomes a pure
consumer of `OverlayDecision` values regardless of origin.

The feature is entirely additive: no existing behavior changes when the new config sections
are absent. All 177 existing tests must pass unmodified after Phase 1.

---

## Architecture

### Guiding principles

1. **Single enforcement point** — the engine is the only code that calls `StateManager.transition()`.
   Providers return decisions; they never mutate state.
2. **Locked chain order** — `HIL → Remote overlays → Policy Gate → Review/Paired → Confidence`.
   This order is an invariant enforced at chain-build time.
3. **Fail-safe defaults** — schema violations always fail closed; transport failures default to `warn`.
4. **Zero behavioral change without config** — absence of `overlay_backends` / `remote_overlays`
   in `ai-sdd.yaml` must produce identical runtime behavior to the pre-feature baseline.

### Conceptual model

```
                    ┌──────────────────────────────────────────────┐
                    │  Engine (src/core/engine.ts)                 │
                    │                                              │
                    │  runPreProviderChain(chain, ctx)             │
                    │      ↓ OverlayDecision                       │
                    │  applyPreDecision(verdict) → state trans.    │
                    │                                              │
                    │  runPostProviderChain(chain, ctx, result)    │
                    │      ↓ OverlayDecision                       │
                    │  applyPostDecision(verdict) → state trans.   │
                    └──────────────────────────────────────────────┘
                               ↑  OverlayProvider[]
                    ┌──────────────────────────────────────────────┐
                    │  Provider Chain (src/overlays/)              │
                    │                                              │
                    │  [0] LocalOverlayProvider (HIL)              │
                    │  [1] McpOverlayProvider (coding-standards)   │ ← remote
                    │  [2] LocalOverlayProvider (policy_gate)      │
                    │  [3] LocalOverlayProvider (review/paired)    │
                    │  [4] LocalOverlayProvider (confidence)       │
                    └──────────────────────────────────────────────┘
                               ↑ MCP stdio
                    ┌──────────────────────────────────────────────┐
                    │  Remote MCP Server (coding-standards repo)   │
                    │  overlay.invoke tool                         │
                    └──────────────────────────────────────────────┘
```

---

## Components

### 1. `OverlayProvider` interface (`src/types/overlay-protocol.ts`)

**Role:** The single contract all overlays satisfy.

**Key members:**
- `id: string` — unique name within the chain
- `runtime: "local" | "cli" | "mcp"` — string union (not enum) for TypeScript exhaustiveness
- `hooks: ("pre_task" | "post_task")[]`
- `enabled: boolean`
- `phases?: string[]` — optional phase filter; absent = all phases
- `invokePre?(ctx: OverlayContext): Promise<OverlayDecision>`
- `invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>`

All types in this file are re-exported from `src/types/index.ts`.

**Design decision:** String union rather than `enum` keyword so the TypeScript compiler
enforces exhaustiveness checking in switch statements over `runtime`.

---

### 2. `OverlayDecision` + `OverlayVerdict` (`src/types/overlay-protocol.ts`)

**Role:** The normalized return type produced by every provider and consumed by the engine.

**OverlayVerdict:** `"PASS" | "REWORK" | "FAIL" | "HIL"` — exactly four values.

**OverlayDecision:**
```typescript
interface OverlayDecision {
  verdict: OverlayVerdict;
  feedback?: string;
  updated_context?: Partial<AgentContext>;   // identity fields stripped before engine applies
  evidence?: OverlayEvidence;
}
```

**MCP wire format:** `OverlayInvokeOutputSchema` (Zod) validates every remote response. Any
schema violation produces `{ verdict: "FAIL" }` — this is not overridable by `failure_policy`.

---

### 3. `LocalOverlayProvider` (`src/overlays/local-overlay-provider.ts`)

**Role:** Wraps an existing `BaseOverlay` in the `OverlayProvider` interface. This is the
backward-compatibility shim — all existing overlays (HIL, policy_gate, review, etc.) are
wrapped at chain-build time.

**Key behaviors:**
- `inner` property exposes the wrapped `BaseOverlay` so the engine can call `awaitResolution` on HIL
- Deterministic verdict mapping: `proceed: true` → `PASS`; `proceed: false, hil_trigger: true` → `HIL`; etc.
- Constructor throws `TypeError` if the wrapped overlay implements neither `preTask` nor `postTask`

---

### 4. `McpOverlayProvider` (`src/overlays/mcp/mcp-overlay-provider.ts`)

**Role:** Delegates pre/post-task overlay invocations to a remote MCP server via `McpClientWrapper`.
Implements the two-tier failure model (transport vs. schema).

**Key behaviors:**
- No MCP SDK imports — all SDK calls are delegated to `McpClientWrapper`
- Injectable `clientFactory` parameter for testability
- Computes `effectivePolicy = blocking ? backendConfig.failure_policy : "warn"` before the call
- Tier 1 (transport): governs by effective policy
- Tier 2 (schema): always returns `FAIL` regardless of policy
- Emits six observability events through the injected `ObservabilityEmitter`
- Calls `disconnect()` (best-effort) after every invocation

---

### 5. `McpClientWrapper` (`src/overlays/mcp/mcp-client.ts`)

**Role:** Encapsulates the full MCP stdio connection lifecycle for a single backend. The single
point of contact with `@modelcontextprotocol/sdk`.

**Key behaviors:**
- Validates `transport === "stdio"` at construction time (throws `TypeError` for unsupported transports)
- `connect()` / `callTool()` / `disconnect()` lifecycle; connection is fresh per invocation
- Per-call timeout enforcement (`McpTimeoutError` on expiry)
- `McpNotConnectedError` if `callTool` is called before `connect()`
- Unwraps the SDK `{ content: [...] }` envelope before returning
- Three named error classes: `McpTimeoutError`, `McpNotConnectedError`, `McpSchemaError`

**Wire protocol** (`overlay.invoke` tool):
- Input: `OverlayInvokeInput` — `protocol_version: "1"`, overlay_id, hook, workflow, task, artifacts/result, config
- Output: validated by `OverlayInvokeOutputSchema` (Zod) in `McpOverlayProvider`

---

### 6. Provider Chain Builder (`src/overlays/registry.ts` — `buildProviderChain`)

**Role:** Assembles the full `OverlayProvider[]` in locked order from local and remote config.

**Assembly order:**
1. HIL (`LocalOverlayProvider`)
2. Remote overlays from `remote_overlays` config in declaration order (`McpOverlayProvider`)
3. Policy Gate (`LocalOverlayProvider`)
4. Review OR Paired — mutual exclusion enforced here
5. Confidence (`LocalOverlayProvider`)

**Invariants enforced at build time:**
- Unknown backend reference → `RegistryError`
- Unsupported backend runtime → `RegistryError`
- Remote overlay after policy_gate → `RegistryError` (Invariant 6)
- Review + Paired both enabled → `RegistryError` (Invariant 5)
- Remote overlays present without `ObservabilityEmitter` → `RegistryError`

---

### 7. Chain Runner (`src/overlays/provider-chain.ts`)

**Role:** Executes the provider chain; enforces short-circuit and context-forwarding semantics.

**`runPreProviderChain` and `runPostProviderChain` rules:**
1. Skip `enabled: false` providers
2. Skip providers not declaring the relevant hook
3. Skip providers with `phases` set and current phase not in list
4. Invoke provider; catch any thrown exception → `{ verdict: "FAIL" }`
5. First non-PASS verdict short-circuits (returns immediately)
6. PASS with `updated_context` → apply via `mergeContextUpdate` before next provider
7. All PASS → return `{ verdict: "PASS" }`

**`mergeContextUpdate`:** Strips `task_id`, `workflow_id`, `run_id`, `status` from
`updated_context` before merging. This is the no-mutation invariant for context forwarding.

---

### 8. Config Schema (`src/config/remote-overlay-schema.ts`)

**Role:** Zod schemas for the new optional config sections; parsed independently from `ProjectConfig`.

**Three sections:**
- `overlay_backends: Record<string, OverlayBackendConfig>` — backend definitions with transport, timeout, failure_policy
- `remote_overlays: Record<string, RemoteOverlayConfig>` — overlay bindings with hooks, phases, blocking
- `governance: { requirements_lock: "off" | "warn" | "enforce" }` — defaults to `"warn"`

**Backward compatibility:** absence of all three sections → `parseRemoteOverlayConfig` returns
`undefined` with no errors or warnings.

---

### 9. `CANCELLED` Task State (`src/types/index.ts`)

**Role:** A clean terminal state for deliberate operator-initiated cancellations, distinct from `FAILED`.

**Updated `VALID_TRANSITIONS`:**
```
PENDING      → [RUNNING, CANCELLED]
RUNNING      → [COMPLETED, NEEDS_REWORK, HIL_PENDING, FAILED, CANCELLED]
COMPLETED    → []
NEEDS_REWORK → [RUNNING, FAILED, CANCELLED]
HIL_PENDING  → [RUNNING, FAILED, CANCELLED]
FAILED       → []
CANCELLED    → []   // terminal — no outgoing transitions
```

Downstream tasks treat `CANCELLED` the same as `FAILED` (skip, count in failed list).
`ai-sdd status` displays `CANCELLED` as a separate category.

---

### 10. Engine Verdict Mapping (`src/core/engine.ts`)

**Role:** The single enforcement point for translating `OverlayDecision` → state transitions.

**`applyPreDecision` table:**
| Verdict | Action |
|---------|--------|
| `PASS` | Continue to agent dispatch |
| `REWORK` | `RUNNING → NEEDS_REWORK → RUNNING`; emit `task.rework` |
| `FAIL` | `RUNNING → FAILED`; emit `task.failed` |
| `HIL` | `RUNNING → HIL_PENDING`; emit `task.hil_pending`; await resolution |

**`applyPostDecision` table:**
| Verdict | Action |
|---------|--------|
| `PASS` | Continue to `COMPLETED` |
| `REWORK` | `RUNNING → NEEDS_REWORK → RUNNING`; emit `task.rework` |
| `FAIL` | `RUNNING → FAILED`; emit `task.failed` |
| `HIL` | Treated as `REWORK` (conservative; post-task HIL not fully specified) |

Both functions use exhaustive switch over `OverlayVerdict` with a `never` default branch.
TypeScript compilation fails if a new verdict is added without a handler.

**HIL resume path:** On `--resume` with a `HIL_PENDING` task, the engine skips the
pre-overlay chain and calls `awaitResolution` directly with the stored `hil_item_id`.

---

### 11. Observability Events (`src/types/index.ts`, `src/overlays/mcp/mcp-overlay-provider.ts`)

**Role:** Six new event types added to `EventType` string union.

| Event | Level | When |
|-------|-------|------|
| `overlay.remote.connecting` | INFO | Before MCP connect |
| `overlay.remote.connected` | INFO | After connect (includes `duration_ms`) |
| `overlay.remote.invoked` | INFO | After `callTool` sent |
| `overlay.remote.decision` | INFO | After valid response received |
| `overlay.remote.failed` | ERROR | Transport error or schema violation |
| `overlay.remote.fallback` | WARN | When skip/warn policy applied |

`overlay.remote.failed` carries `failure_tier: "transport" | "schema"` to distinguish
connection failures from malformed responses without parsing `error_message`.

All event payloads pass through the existing `src/observability/sanitizer.ts` before emission.

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Bun | No Node.js-specific APIs |
| Language | TypeScript strict mode | No `any` without justification |
| Schema validation | Zod v3 | Used for all remote response validation |
| MCP SDK | `@modelcontextprotocol/sdk` | Already in package.json; no new deps |
| Transport | stdio only | SSE/HTTP out of scope for this release |

---

## Integration Points

### Engine integration
`engine.ts` replaces direct `BaseOverlay.preTask/postTask` calls with `runPreProviderChain`/
`runPostProviderChain`. The `providerChain: OverlayProvider[]` is built once at workflow start
by `buildProviderChain`.

### Config integration
`src/config/` loads `RemoteOverlaysSectionSchema` alongside existing `ProjectConfig`. The
`validate-config` CLI command surfaces validation errors for new sections using the same format.

### Composition rules
`src/overlays/composition-rules.ts` gains `validateProviderCombination(chain: OverlayProvider[])`
alongside the existing `validateOverlayCombination`. The existing function is not modified.

---

## Key Architectural Decisions

### ADR-001: String union over enum for `OverlayVerdict` and `OverlayRuntime`
TypeScript `enum` values are not erased at compile time and do not participate in exhaustiveness
checking the same way string unions do. Using string unions (`"PASS" | "REWORK" | "FAIL" | "HIL"`)
means the compiler catches unhandled cases in switch statements without a `default` branch.

### ADR-002: Per-invocation MCP connection (no connection pooling)
`McpClientWrapper` opens and closes a connection for every overlay invocation. This avoids
connection state management complexity and zombie connections, at the cost of connection
overhead per call. Acceptable given that remote overlays run at most twice per task (pre + post)
and the feature is additive — no existing path pays this cost.

### ADR-003: Two-tier failure model with schema always fail_closed
Transport errors (Tier 1) are policy-governed because they represent infrastructure issues
where failing open may be acceptable. Schema violations (Tier 2) always fail closed because
a corrupt or adversarial response that passes governance checks is a security issue, not an
infrastructure issue. The `blocking: false` flag only affects Tier 1.

### ADR-004: `LocalOverlayProvider` as the backward-compatibility adapter
Rather than changing all existing overlays to implement `OverlayProvider`, we wrap them.
This means zero changes to `HilOverlay`, `PolicyGateOverlay`, etc. The adapter exposes `inner`
so the engine can still access `awaitResolution` on the HIL overlay — a typed escape hatch
that preserves the existing HIL resume path.

### ADR-005: `CANCELLED` as a distinct terminal state (not FAILED)
`FAILED` represents an error condition. `CANCELLED` represents a deliberate operator action.
Mixing them makes reporting and future governance (skip decisions) harder to reason about.
The cost is one new terminal state in the type system; the benefit is clean separation of
intent vs. error.
