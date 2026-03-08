# Component Design L2 — Remote Overlay Abstraction

## Overview

The Remote Overlay Abstraction (ROA) introduces a transport-agnostic `OverlayProvider` interface so that governance decisions (PASS/REWORK/FAIL/HIL) can be computed either in-process (local) or on a remote MCP server, and the engine consumes `OverlayDecision` values from both sources identically.

**Artifact contract**: `component_design_l2`
**Status**: READY FOR IMPLEMENTATION
**Feature**: Remote Overlay Abstraction
**Inputs consumed**: `design-l1.md`, FR-001 through FR-009, NFR-001 through NFR-004, `review-l1.md`
**L1 review disposition**: GO — two non-blocking suggestions addressed below (connect/disconnect error path guarantees; Zod transform for `mergeContextUpdate` identity stripping)

### L1 Review Suggestions — L2 Disposition

**Review suggestion 1** (connect/disconnect error path guarantees): `McpClientWrapper.connect()` and `disconnect()` lifecycle guarantees are now fully specified. `disconnect()` is always called best-effort in a `finally` block or catch block regardless of the failure tier. Errors from `disconnect()` are swallowed. The caller (`McpOverlayProvider`) never has cleanup responsibility.

**Review suggestion 2** (`mergeContextUpdate` identity stripping via Zod transform): The implementation uses a `Set`-based `IDENTITY_FIELDS` constant rather than a Zod transform, because `mergeContextUpdate` operates on an already-typed `Partial<AgentContext>` — Zod is not appropriate for runtime object manipulation on in-process values. The `IDENTITY_FIELDS` constant is the single authoritative list and cannot drift from a Zod schema definition because it is co-located with `mergeContextUpdate` in `src/overlays/provider-chain.ts`. Zod is used for remote response validation (Tier 2 path), which is the correct location for schema-based guarding.

### Design Principles

1. Engine is the single enforcement point — no provider or chain runner calls `StateManager.transition()`.
2. Schema violations are always `fail_closed` — `failure_policy` governs transport errors (Tier 1) only.
3. `LocalOverlayProvider` wraps existing `BaseOverlay` instances with zero behavioral change.
4. All new source files: TypeScript strict mode, no `any` without justification, no `eval()`, no `require()`.
5. Provider chain order is an invariant enforced at registry build time, not at call time.
6. Entire feature is additive: absence of `overlay_backends` / `remote_overlays` in config produces identical behavior to the pre-feature baseline.

---

## Architecture

### System Context

```
Engine (src/core/engine.ts)
  │
  │  buildProviderChain() called once at engine startup
  ▼
OverlayProvider[]
  ├─ [0] LocalOverlayProvider("hil")          runtime: "local"
  ├─ [1] McpOverlayProvider("coding-standards") runtime: "mcp"   ← new
  ├─ [2] LocalOverlayProvider("policy_gate")  runtime: "local"
  ├─ [3] LocalOverlayProvider("review")       runtime: "local"
  └─ [4] LocalOverlayProvider("confidence")   runtime: "local"
  │
  │  runPreProviderChain / runPostProviderChain called per task
  ▼
OverlayDecision { verdict, feedback, updated_context, evidence }
  │
  ▼
applyPreDecision / applyPostDecision (Engine)
  │
  ▼
StateManager.transition()
```

### File Map

| File | Role | New/Modified |
|------|------|--------------|
| `src/types/overlay-protocol.ts` | Protocol types: `OverlayProvider`, `OverlayDecision`, `OverlayVerdict`, wire schemas | New |
| `src/types/index.ts` | `CANCELLED` state, `VALID_TRANSITIONS`, `EventType` additions, re-export | Modified |
| `src/overlays/local-overlay-provider.ts` | Backward-compat shim wrapping `BaseOverlay` | New |
| `src/overlays/registry.ts` | `buildProviderChain` — assembles chain from config | New |
| `src/overlays/provider-chain.ts` | `runPreProviderChain`, `runPostProviderChain`, `mergeContextUpdate` | New |
| `src/overlays/composition-rules.ts` | `validateProviderCombination` — Invariant 6 enforcement | Modified |
| `src/overlays/mcp/mcp-client.ts` | `McpClientWrapper` — MCP stdio lifecycle | New |
| `src/overlays/mcp/mcp-overlay-provider.ts` | `McpOverlayProvider` — remote provider impl | New |
| `src/config/remote-overlay-schema.ts` | Zod schemas for `overlay_backends`, `remote_overlays`, `governance` | New |
| `src/core/engine.ts` | `applyPreDecision`, `applyPostDecision`, provider chain integration | Modified |

### Integration with Existing Code

The engine's pre-existing `runPreTaskChain` / `runPostTaskChain` calls in `base-overlay.ts` are replaced by `runPreProviderChain` / `runPostProviderChain`. The existing `BaseOverlay` interface and `base-overlay.ts` are not modified. `LocalOverlayProvider` wraps existing overlays so zero changes are required to `HilOverlay`, `PolicyGateOverlay`, `ConfidenceOverlay`, `ReviewOverlay`, or `PairedOverlay`.

---

## Components

### Component A — `src/types/overlay-protocol.ts`

**Role**: Canonical type definitions for the overlay protocol. All types consumed by the engine and chain runner are defined here and re-exported from `src/types/index.ts`.

**Contract**: This is the only file that defines `OverlayProvider`, `OverlayDecision`, `OverlayVerdict`, `OverlayInvokeOutputSchema`, and `OverlayInvokeInput`. No other file defines these.

**Key design decisions**:
- `OverlayVerdict` is a string union, not a TypeScript `enum` keyword, so exhaustiveness checking in switch statements compiles-fail when a new value is added without a handler.
- `OverlayInvokeOutputSchema` uses `z.literal("1")` for `protocol_version` — version mismatch is a Tier 2 schema violation and always returns FAIL regardless of `failure_policy`.
- `updated_context` is typed as `Partial<AgentContext>` (not `Record<string, unknown>`) to prevent remote providers from injecting arbitrary keys.

**Implementation notes**:
- The `OverlayContext` shape in this file is structurally identical to the `OverlayContext` in `base-overlay.ts`. Both must be kept in sync. Long-term, `base-overlay.ts` will import from here, but that migration is outside this release to preserve the baseline test suite.
- All types must be re-exported from `src/types/index.ts` via `export * from "./overlay-protocol.ts"`.

---

### Component B — `src/overlays/local-overlay-provider.ts`

**Role**: Backward-compatibility shim. Wraps a `BaseOverlay` in the `OverlayProvider` interface so the engine can treat local and remote overlays through the same call site.

**Key behaviors**:
- Constructor detects which hook methods are present (`typeof overlay.preTask === "function"`) and populates `this.hooks` accordingly.
- Constructor throws `TypeError` if neither `preTask` nor `postTask` is implemented on the wrapped overlay.
- `invokePre` is assigned as a class method only when `"pre_task"` is in hooks. `invokePost` only when `"post_task"` is in hooks. Methods are `undefined` otherwise — the chain runner checks `provider.hooks.includes("pre_task")` before calling.
- `this.inner` exposes the wrapped `BaseOverlay` for the engine's HIL `awaitResolution` path.
- `this.enabled` is a getter that reads from `overlay.enabled` — not cached, reflects live state.

**`OverlayResult` to `OverlayDecision` mapping** (pre-task):

| Source | Verdict |
|--------|---------|
| `proceed: true` | `"PASS"` |
| `proceed: false, hil_trigger: true` | `"HIL"` |
| `proceed: false, hil_trigger: false/undefined` | `"REWORK"` |

**`PostTaskOverlayResult` to `OverlayDecision` mapping** (post-task):

| Source | Verdict |
|--------|---------|
| `accept: true` | `"PASS"` |
| `accept: false, new_status: "NEEDS_REWORK"` or `undefined` | `"REWORK"` |
| `accept: false, new_status: "FAILED"` | `"FAIL"` |
| `accept: false, new_status: "COMPLETED"` | Throws `TypeError` — only engine may set COMPLETED |

**Context conversion**: The `OverlayContext` (new protocol shape) is converted to `LegacyContext` (base-overlay shape) via an explicit `toLegacyCtx` function. Both are currently structurally identical; the function exists so the conversion can evolve independently.

**Error message contract (enforced by tests)**:
- No-hook TypeError: `"LocalOverlayProvider: overlay '${name}' declares no hooks (preTask/postTask). A provider must implement at least one hook method."`
- COMPLETED rejection TypeError: `"LocalOverlayProvider: overlay '${name}' returned accept:false with new_status:\"COMPLETED\". Only the engine may transition a task to COMPLETED. Use accept:true instead."`

---

### Component C — `src/overlays/registry.ts`

**Role**: Builds the ordered `OverlayProvider[]` chain from resolved config. Runs once at engine startup. Enforces chain order invariant and composition rules at build time.

**`RegistryInput` structure**:
```
{
  localOverlays: {
    hil?: BaseOverlay
    policy_gate?: BaseOverlay
    review?: BaseOverlay
    paired?: BaseOverlay
    confidence?: BaseOverlay
  }
  remoteConfig?: ResolvedOverlayConfig
  emitter?: ObservabilityEmitter  // required when remote_overlays present
}
```

**Chain assembly algorithm** (strict order — deviations are a bug):
1. If `localOverlays.hil` present → wrap in `LocalOverlayProvider`, push.
2. If `remoteConfig.remote_overlays` present, iterate in YAML declaration order:
   - Skip entries with `enabled: false`.
   - Resolve backend from `remoteConfig.overlay_backends[cfg.backend]`. If not found → `RegistryError` naming the missing backend ID.
   - If `backend.runtime === "mcp"` → require `emitter` (throw `RegistryError` if absent), push `McpOverlayProvider(name, cfg, backend, emitter)`.
   - Any other runtime → `RegistryError` naming the unsupported runtime.
3. If `localOverlays.policy_gate` present → wrap, push.
4. Check mutual exclusion before adding review/paired: if both `review.enabled` and `paired.enabled` are true → `RegistryError` (Invariant 5).
5. If `localOverlays.review` present → wrap, push.
6. If `localOverlays.paired` present → wrap, push.
7. If `localOverlays.confidence` present → wrap, push.
8. Call `validateProviderCombination(chain)` — throws `RegistryError` on any invariant violation.
9. Return chain.

**`RegistryError` error class**:
```typescript
export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}
```

**Key invariants enforced here vs in `validateProviderCombination`**:
- Unknown backend reference: enforced in step 2 (registry).
- Unsupported runtime: enforced in step 2 (registry).
- Missing emitter: enforced in step 2 (registry).
- Invariant 5 (Review + Paired mutually exclusive): enforced in step 4 (registry, early fail before wrap).
- Invariant 1 (HIL first): enforced by `validateProviderCombination` (step 8).
- Invariant 6 (remote after policy_gate): enforced by `validateProviderCombination` (step 8).

**`buildProviderChain` is a pure function**, not a class method. The `Engine` constructor receives the pre-built chain.

---

### Component D — `src/overlays/provider-chain.ts`

**Role**: Runtime chain executor. Iterates `OverlayProvider[]` for pre-task and post-task hooks, applies skip rules, short-circuits on non-PASS, and accumulates `updated_context`.

**Functions exported**:
- `runPreProviderChain(chain, ctx) → Promise<OverlayDecision>`
- `runPostProviderChain(chain, ctx, result) → Promise<OverlayDecision>`
- `mergeContextUpdate(ctx, update) → OverlayContext` (exported for testing)

**Per-provider evaluation rules** (applied in this order, all must pass to invoke):
1. `provider.enabled === false` → skip (continue to next).
2. Hook not in `provider.hooks` → skip.
3. `provider.phases !== undefined` AND `task_definition.phase` not in `provider.phases` → skip. When `task_definition.phase` is `undefined`, phase-filtered providers are skipped (conservative).
4. Invoke `invokePre` / `invokePost`. If the invocation throws, catch and normalize:
   ```
   { verdict: "FAIL", feedback: "Provider '${id}' threw unexpectedly: ${message}",
     evidence: { overlay_id: id, source: runtime } }
   ```
5. If verdict is not `"PASS"` → return immediately (short-circuit).
6. If verdict is `"PASS"` and `updated_context` is present → call `mergeContextUpdate` before advancing to next provider.

If all providers return `"PASS"` → return `{ verdict: "PASS" }`.

**`mergeContextUpdate` implementation contract**:
```typescript
const IDENTITY_FIELDS = new Set<string>(["task_id", "workflow_id", "run_id", "status"]);

function mergeContextUpdate(ctx: OverlayContext, update: Partial<AgentContext>): OverlayContext {
  const safeUpdate = Object.fromEntries(
    Object.entries(update).filter(([k]) => !IDENTITY_FIELDS.has(k))
  ) as Partial<AgentContext>;
  return {
    ...ctx,
    agent_context: { ...ctx.agent_context, ...safeUpdate },
  };
}
```

`IDENTITY_FIELDS` is the single authoritative list of protected fields. It must not be split across files or duplicated. The engine's `applyPreDecision` / `applyPostDecision` does not re-apply identity stripping — it relies on the chain runner having already done so when forwarding context to providers.

**This module does not emit observability events.** Remote providers emit their own events internally via the injected `ObservabilityEmitter`. The chain runner is event-free to stay testable without an emitter dependency.

---

### Component E — `src/overlays/mcp/mcp-client.ts`

**Role**: Encapsulates the full MCP stdio connection lifecycle for a single backend. All `@modelcontextprotocol/sdk` imports are confined to this file. Callers receive plain TypeScript values.

**Three error classes** (all use class syntax for `instanceof` compatibility):
```typescript
export class McpTimeoutError extends Error {
  constructor(public readonly toolName: string, public readonly timeoutMs: number)
}
export class McpNotConnectedError extends Error {
  constructor(public readonly backendId: string)
}
export class McpSchemaError extends Error {
  constructor(message: string)
}
```

**`McpClientWrapper` construction contract**:
- Accepts `ResolvedBackendConfig & { runtime: "mcp" }`.
- Validates `config.transport === "stdio"` at construction time, not deferred to `connect()`.
- Throws `TypeError` naming the unsupported transport (e.g., `"sse"`) when transport is not `"stdio"`.

**`connect()` contract**:
- Spawns the stdio subprocess using `config.command[0]` as executable, remainder as args.
- Merges `config.env` with `process.env` (spread over — remote process inherits existing env).
- On success: sets `_connected = true`.
- On failure: throws the underlying SDK error. `_connected` remains false. `disconnect()` is a no-op after a failed `connect()` call.

**`disconnect()` contract** (the L1 review suggestion — now fully specified):
- If `_connected === false` → no-op, returns without error.
- If `_connected === true` → calls `client.close()`, sets `_connected = false`.
- Must never throw. Callers catch with `.catch(() => {})` (best-effort semantics).
- `McpOverlayProvider` always calls `disconnect()` in a `finally`-equivalent path, whether the invocation succeeded or failed. Errors from `disconnect()` are swallowed and must not mask the original error.

**`callTool()` contract**:
- Throws `McpNotConnectedError` if called before `connect()`.
- Enforces `config.timeout_ms` (default `5000`) via `Promise.race` against a `setTimeout`.
- On timeout: throws `McpTimeoutError(toolName, timeoutMs)`.
- Unwraps the SDK `{ content: Array<{ type, text | data }> }` envelope before returning.
  - `content[0].type === "text"`: parse `content[0].text` as JSON; return parsed value. If parse fails, return the raw string.
  - `content[0].type === "json"`: return `content[0].data`.
  - Otherwise: return `content[0]` as-is.
- Returns `unknown` — callers (McpOverlayProvider) are responsible for Zod validation.

**Per-invocation connection model** (ADR-002): A fresh connection is created for every overlay invocation. `McpClientWrapper` is not held open across multiple calls. This avoids connection state management and zombie connections at the cost of connection overhead. Acceptable because remote overlays execute at most twice per task (pre + post).

**SDK confinement rule**: No `McpClientWrapper` method may expose SDK types in its return type or throw types. All thrown errors must be one of the three named error classes, or a plain `Error`. Callers must not import from `@modelcontextprotocol/sdk`.

---

### Component F — `src/overlays/mcp/mcp-overlay-provider.ts`

**Role**: Implements `OverlayProvider` for MCP backends. Delegates communication to `McpClientWrapper`, validates responses with `OverlayInvokeOutputSchema`, applies the two-tier failure model.

**Constructor signature**:
```typescript
constructor(
  overlayName: string,
  private readonly overlayConfig: ResolvedRemoteOverlayConfig,
  private readonly backendConfig: ResolvedBackendConfig & { runtime: "mcp" },
  private readonly emitter: ObservabilityEmitter,
  clientFactory?: (config: ResolvedBackendConfig & { runtime: "mcp" }) => McpClientWrapper,
)
```

`clientFactory` defaults to `(cfg) => new McpClientWrapper(cfg)`. Injecting a factory in tests avoids spawning real subprocesses.

**`invokePre` / `invokePost` delegation**:
Both methods delegate to a shared `invoke(ctx, hook, result?)` private method. `invokePre` is defined on the instance only when `overlayConfig.hooks` includes `"pre_task"`; `invokePost` only when it includes `"post_task"`.

**`invoke` algorithm**:
```
1. start = Date.now()
2. backendId = backendConfig.command[0] ?? "unknown"
3. client = clientFactory(backendConfig)
4. effectivePolicy = overlayConfig.blocking === false ? "warn" : backendConfig.failure_policy
5. connectSucceeded = false

6. [Tier 1 try block]
   emit overlay.remote.connecting
   await client.connect()
   connectSucceeded = true
   emit overlay.remote.connected  (duration_ms = Date.now() - start)
   input = buildInput(ctx, hook, taskResult, overlayName, overlayConfig.config)
   emit overlay.remote.invoked
   raw = await client.callTool(backendConfig.tool, input)

   catch (err):  [Tier 1 — transport error]
     await client.disconnect().catch(() => {})
     emit overlay.remote.failed  (failure_tier: "transport")
     switch effectivePolicy:
       "skip":       emit overlay.remote.fallback; return { verdict: "PASS" }
       "warn":       emit overlay.remote.fallback; return { verdict: "PASS" }
       "fail_closed": return { verdict: "FAIL", feedback: "Transport error: ..." }

   finally:  [success path cleanup]
     if connectSucceeded: await client.disconnect().catch(() => {})

7. [Tier 2 — schema validation, runs only when Tier 1 succeeded]
   parsed = OverlayInvokeOutputSchema.safeParse(raw)
   if !parsed.success:
     emit overlay.remote.failed  (failure_tier: "schema")
     return { verdict: "FAIL", feedback: "Remote overlay response failed schema validation: ..." }

8. emit overlay.remote.decision  (verdict, duration_ms)
9. return mapToDecision(parsed.data, overlayName)
```

**Key invariant**: The Tier 2 path only executes when the Tier 1 `try` block completes without throwing. The two tiers are distinct code paths — not a single monolithic catch block.

**`blocking: false` semantics**: The `effectivePolicy` is computed once before the Tier 1 try block. It downgrades `fail_closed` to `"warn"` for Tier 1 errors when `blocking: false`. Tier 2 schema violations are never affected by `blocking`.

**Evidence population**: The `mapToDecision` helper maps `OverlayInvokeOutput` to `OverlayDecision`, setting `evidence.source = "mcp"`. If the remote response includes `evidence.overlay_id`, that value is preserved; otherwise the local `overlayName` is used.

---

### Component G — `src/config/remote-overlay-schema.ts`

**Role**: Zod schemas for the two new optional config sections. Parsed independently from existing `ProjectConfig` to preserve backward compatibility.

**Key schema decisions**:
- `OverlayBackendConfigSchema` uses `.refine()` to enforce `tool` is required when `runtime === "mcp"`. This validation runs at parse time, not at runtime in `McpOverlayProvider`.
- `transport` defaults to `"stdio"`. Only `"stdio"` is in the enum for this release.
- `timeout_ms` defaults to `5000`. `failure_policy` defaults to `"warn"`. `blocking` defaults to `true`.
- `RemoteOverlaysSectionSchema` is `.optional()` — when all three sections are absent, `parseRemoteOverlayConfig(raw)` returns `undefined` with no errors or warnings.
- `GovernanceConfigSchema` defaults `requirements_lock` to `"warn"`. The `"enforce"` value is in the enum for forward compatibility but is not wired in this release.

**Parsed types exported**:
- `ResolvedBackendConfig` = `z.infer<typeof OverlayBackendConfigSchema>`
- `ResolvedRemoteOverlayConfig` = `z.infer<typeof RemoteOverlayConfigSchema>`
- `ResolvedOverlayConfig` = `NonNullable<z.infer<typeof RemoteOverlaysSectionSchema>>`

**`parseRemoteOverlayConfig(raw: unknown): ResolvedOverlayConfig | undefined`** — the single parse entry point. Returns `undefined` on absent sections. Throws `ZodError` on validation failure. This function is called by the config loader and by the `validate-config` CLI command.

---

### Component H — `CANCELLED` Task State (`src/types/index.ts`)

**Role**: Adds `CANCELLED` as a clean terminal `TaskStatus` distinct from `FAILED`, representing deliberate operator-initiated cancellation.

**Updated `VALID_TRANSITIONS`**:

| From | To |
|------|----|
| `PENDING` | `["RUNNING", "CANCELLED"]` |
| `RUNNING` | `["COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED", "CANCELLED"]` |
| `COMPLETED` | `[]` — terminal |
| `NEEDS_REWORK` | `["RUNNING", "FAILED", "CANCELLED"]` |
| `HIL_PENDING` | `["RUNNING", "FAILED", "CANCELLED"]` |
| `FAILED` | `[]` — terminal |
| `CANCELLED` | `[]` — terminal, no outgoing transitions |

**Behavioral properties**:
- `CANCELLED` is reachable from every non-terminal state.
- `FAILED` and `COMPLETED` cannot be cancelled (already terminal; `VALID_TRANSITIONS` enforcement throws `StateError`).
- Downstream tasks of a `CANCELLED` task behave identically to downstream tasks of `FAILED` — they are skipped and added to the `failed` list in the run result.
- `StateManager.transition()` persists `CANCELLED` atomically using the existing tmp+rename pattern.
- `ai-sdd status` displays `CANCELLED` tasks as a separate category from `FAILED`.

---

### Component I — Engine Integration (`src/core/engine.ts`)

**Role**: Replaces direct `BaseOverlay.preTask/postTask` calls with `runPreProviderChain`/`runPostProviderChain`. Adds `applyPreDecision`/`applyPostDecision` as the single enforcement point for translating `OverlayDecision` → state transitions.

**`Engine` constructor change**: Receives `providerChain: OverlayProvider[] = []` as a final constructor parameter (defaults to empty for backward compatibility when no overlays are configured).

**`runTask` integration points**:
- Before agent dispatch: `runPreProviderChain(this.providerChain, overlayCtx)` → `applyPreDecision(taskId, decision, iteration)`.
- After successful adapter dispatch (when result is not `FAILED` or `NEEDS_REWORK`): `runPostProviderChain(this.providerChain, overlayCtx, result)` → `applyPostDecision(taskId, decision, iteration)`.

**`applyPreDecision` return values and actions**:

| Verdict | Action | Return |
|---------|--------|--------|
| `"PASS"` | Continue to agent dispatch | `"CONTINUE"` |
| `"REWORK"` | `RUNNING → NEEDS_REWORK`; emit `task.rework`; `NEEDS_REWORK → RUNNING` | `"NEEDS_REWORK"` |
| `"FAIL"` | `RUNNING → FAILED`; emit `task.failed`; persist evidence | `"FAILED"` |
| `"HIL"` | `RUNNING → HIL_PENDING`; emit `task.hil_pending`; await `awaitResolution` | `"HIL_AWAITING"` |

**`applyPostDecision` return values and actions**:

| Verdict | Action | Return |
|---------|--------|--------|
| `"PASS"` | Continue to `COMPLETED` | `"PASS"` |
| `"REWORK"` | `RUNNING → NEEDS_REWORK`; emit `task.rework`; `NEEDS_REWORK → RUNNING` | `"NEEDS_REWORK"` |
| `"FAIL"` | `RUNNING → FAILED`; emit `task.failed`; persist evidence | `"FAILED"` |
| `"HIL"` | Conservative: treated as `REWORK` (post-task HIL not fully specified) | `"NEEDS_REWORK"` |

Both functions use exhaustive switch over `OverlayVerdict` with an unreachable `never` default branch:
```typescript
default: {
  const _exhaustive: never = verdict;
  throw new Error(`Unhandled OverlayVerdict: ${String(_exhaustive)}`);
}
```

TypeScript compilation fails if a new `OverlayVerdict` value is added without a handler.

**Evidence persistence**: When `OverlayDecision.evidence` is non-null, the engine writes it to `TaskState.overlay_evidence` during the `stateManager.transition()` call. Evidence is then readable via `getTaskState(taskId).overlay_evidence` and included in `ai-sdd status --json` output.

**HIL resume path** (unchanged from pre-feature): When the engine resumes a `HIL_PENDING` task (`--resume` flag), it skips the pre-overlay chain and calls `awaitResolution` directly on the HIL overlay using the stored `hil_item_id`. To access `awaitResolution`, the engine finds the HIL `LocalOverlayProvider` in the chain via `provider.id === "hil" && provider.runtime === "local"` and accesses `(provider as LocalOverlayProvider).inner.awaitResolution`.

**HIL provider lookup pattern** (used in two places in engine):
```typescript
const hilProvider = this.providerChain.find(
  (p) => p.id === "hil" && p.runtime === "local"
) as (LocalOverlayProvider | undefined);
const hilOverlay = hilProvider?.inner;
```

---

### Component J — Observability Events (`src/types/index.ts`, `src/overlays/mcp/mcp-overlay-provider.ts`)

**Role**: Six new event types added to the `EventType` string union. All emitted by `McpOverlayProvider` via the injected `ObservabilityEmitter`.

**New `EventType` values** added to the string union:
```
| "overlay.remote.connecting"
| "overlay.remote.connected"
| "overlay.remote.invoked"
| "overlay.remote.decision"
| "overlay.remote.failed"
| "overlay.remote.fallback"
```

**Event payloads and timing**:

| Event | Level | When | Required Fields |
|-------|-------|------|-----------------|
| `overlay.remote.connecting` | INFO | Before `client.connect()` | `overlay_name`, `backend_id`, `task_id`, `workflow_id`, `run_id` |
| `overlay.remote.connected` | INFO | After `client.connect()` succeeds | `overlay_name`, `backend_id`, `task_id`, `workflow_id`, `run_id`, `duration_ms` (connect time) |
| `overlay.remote.invoked` | INFO | After `callTool` is called (before response) | `overlay_name`, `backend_id`, `hook`, `task_id` |
| `overlay.remote.decision` | INFO | After valid `OverlayDecision` received | `overlay_name`, `backend_id`, `hook`, `task_id`, `verdict`, `duration_ms` (full invocation) |
| `overlay.remote.failed` | ERROR | Tier 1 transport error or Tier 2 schema violation | `overlay_name`, `backend_id`, `hook`, `task_id`, `failure_tier` (`"transport"` or `"schema"`), `error_message`, `duration_ms` |
| `overlay.remote.fallback` | WARN | When skip or warn policy applied after Tier 1 failure | `overlay_name`, `backend_id`, `hook`, `task_id`, `failure_policy` |

**`duration_ms` measurement**:
- `overlay.remote.connected`: measures connection time only (`Date.now() - start` at point of connected event, where `start` is set at the beginning of `invoke()`).
- `overlay.remote.decision` and `overlay.remote.failed`: measures full invocation duration from start of `invoke()`.

**Log level assignments** in `ObservabilityEmitter.getEventLevel()`:
- `overlay.remote.failed` → `ERROR` (matched by `type.includes("failed")`).
- `overlay.remote.fallback` → `WARN` (matched by explicit `type === "overlay.remote.fallback"` check).
- All four remaining event types → `INFO` (default).

**Secret redaction**: All event payloads pass through `src/observability/sanitizer.ts` via `emitter.emit()`. The `sanitizer.sanitizeObject(data)` call in the emitter is the single redaction point. Config passthrough values matching registered secret patterns are replaced with `"[REDACTED]"` before any handler or log line receives them.

---

### Component K — Composition Rules Extension (`src/overlays/composition-rules.ts`)

**Role**: Adds `validateProviderCombination(chain: OverlayProvider[])` to enforce invariants on the assembled `OverlayProvider[]`. The existing `validateOverlayCombination(overlays: BaseOverlay[])` function is not modified.

**Invariants enforced by `validateProviderCombination`**:
- **Invariant 1**: HIL local provider must be first when present (checks enabled providers only).
- **Invariant 5**: Review and Paired are mutually exclusive — both enabled simultaneously is an error.
- **Invariant 6** (new): No remote provider (`runtime !== "local"`) may appear after the `policy_gate` local provider in the chain.

**Invariant 6 detection logic**:
```typescript
const policyGateIdx = providers.findIndex(p => p.id === "policy_gate" && p.runtime === "local");
const lastRemoteIdx = providers.reduce((max, p, i) => p.runtime !== "local" ? i : max, -1);
if (policyGateIdx >= 0 && lastRemoteIdx > policyGateIdx) {
  errors.push(`Invariant 6 violated: remote overlays must not appear after policy_gate. ...`);
}
```

Error messages must be stable strings (they are part of the error contract — tests assert on them).

---

## Interfaces

All production-ready TypeScript interfaces. These are the exact shapes that implementors must use.

```typescript
// src/types/overlay-protocol.ts

export type OverlayRuntime = "local" | "cli" | "mcp";
export type OverlayHook = "pre_task" | "post_task";
export type OverlayVerdict = "PASS" | "REWORK" | "FAIL" | "HIL";

export interface OverlayEvidence {
  overlay_id: string;
  source: OverlayRuntime;
  checks?: string[];
  report_ref?: string;
  data?: Record<string, unknown>;
}

export interface OverlayDecision {
  verdict: OverlayVerdict;
  feedback?: string;
  /** Engine MUST strip identity fields before applying via mergeContextUpdate. */
  updated_context?: Partial<AgentContext>;
  evidence?: OverlayEvidence;
}

export interface OverlayContext {
  task_id: string;
  workflow_id: string;
  run_id: string;
  task_definition: TaskDefinition;
  agent_context: AgentContext;
}

export interface OverlayProvider {
  readonly id: string;
  readonly runtime: OverlayRuntime;
  readonly hooks: OverlayHook[];  // at least one element required
  readonly enabled: boolean;
  readonly phases?: string[];     // absent = apply to all phases
  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}

// MCP wire format (Zod schema)
export const OverlayInvokeOutputSchema = z.object({
  protocol_version: z.literal("1"),
  verdict: z.enum(["PASS", "REWORK", "FAIL", "HIL"]),
  feedback: z.string().optional(),
  evidence: z.object({
    overlay_id: z.string(),
    checks: z.array(z.string()).optional(),
    report_ref: z.string().optional(),
    data: z.record(z.unknown()).optional(),
  }).optional(),
});

export type OverlayInvokeOutput = z.infer<typeof OverlayInvokeOutputSchema>;

export interface OverlayInvokeInput {
  protocol_version: "1";
  overlay_id: string;
  hook: OverlayHook;
  workflow: { id: string; run_id: string };
  task: {
    id: string;
    phase?: string;
    requirement_ids?: string[];
    acceptance_criteria?: unknown[];
    scope_excluded?: string[];
  };
  artifacts?: {
    requirements_lock_path?: string;
    state_path?: string;
    outputs?: Array<{ path: string; contract?: string }>;
  };
  result?: {
    outputs?: Array<{ path: string; contract?: string }>;
    handover_state?: Record<string, unknown>;
  };
  config?: Record<string, unknown>;
}
```

```typescript
// src/overlays/registry.ts

export interface RegistryInput {
  localOverlays: {
    hil?: BaseOverlay;
    policy_gate?: BaseOverlay;
    review?: BaseOverlay;
    paired?: BaseOverlay;
    confidence?: BaseOverlay;
  };
  remoteConfig?: ResolvedOverlayConfig;
  emitter?: ObservabilityEmitter;
}

export function buildProviderChain(input: RegistryInput): OverlayProvider[];
export class RegistryError extends Error {}
```

```typescript
// src/overlays/provider-chain.ts

export function runPreProviderChain(
  chain: OverlayProvider[],
  ctx: OverlayContext,
): Promise<OverlayDecision>;

export function runPostProviderChain(
  chain: OverlayProvider[],
  ctx: OverlayContext,
  result: TaskResult,
): Promise<OverlayDecision>;

export function mergeContextUpdate(
  ctx: OverlayContext,
  update: Partial<AgentContext>,
): OverlayContext;
```

```typescript
// src/overlays/mcp/mcp-client.ts

export class McpTimeoutError extends Error {
  readonly toolName: string;
  readonly timeoutMs: number;
}
export class McpNotConnectedError extends Error {
  readonly backendId: string;
}
export class McpSchemaError extends Error {}

export class McpClientWrapper {
  constructor(config: ResolvedBackendConfig & { runtime: "mcp" });
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  callTool(toolName: string, input: unknown): Promise<unknown>;
  get isConnected(): boolean;
}
```

```typescript
// src/config/remote-overlay-schema.ts

export const OverlayBackendConfigSchema: z.ZodObject<...>;
export const RemoteOverlayConfigSchema: z.ZodObject<...>;
export const GovernanceConfigSchema: z.ZodObject<...>;
export const RemoteOverlaysSectionSchema: z.ZodOptional<z.ZodObject<...>>;

export type ResolvedBackendConfig = z.infer<typeof OverlayBackendConfigSchema>;
export type ResolvedRemoteOverlayConfig = z.infer<typeof RemoteOverlayConfigSchema>;
export type ResolvedGovernanceConfig = z.infer<typeof GovernanceConfigSchema>;
export type ResolvedOverlayConfig = NonNullable<z.infer<typeof RemoteOverlaysSectionSchema>>;

export function parseRemoteOverlayConfig(raw: unknown): ResolvedOverlayConfig | undefined;
```

---

## Data Flow

### Pre-task overlay chain execution

```
Engine.runTaskIteration()
  │
  ├─ buildOverlayContext(taskId, taskDef, agent_context) → OverlayContext
  │
  ├─ runPreProviderChain(providerChain, ctx) → OverlayDecision
  │     │
  │     ├─ [skip: enabled=false, hook absent, phase mismatch]
  │     │
  │     ├─ LocalOverlayProvider.invokePre(ctx)
  │     │     └─ BaseOverlay.preTask(legacyCtx) → OverlayResult
  │     │     └─ mapPreResult() → OverlayDecision
  │     │
  │     └─ McpOverlayProvider.invokePre(ctx)
  │           ├─ emit overlay.remote.connecting
  │           ├─ McpClientWrapper.connect()
  │           ├─ emit overlay.remote.connected
  │           ├─ emit overlay.remote.invoked
  │           ├─ McpClientWrapper.callTool("overlay.invoke", input) → raw
  │           ├─ [disconnect() best-effort in finally]
  │           ├─ OverlayInvokeOutputSchema.safeParse(raw)
  │           ├─ emit overlay.remote.decision (success) or overlay.remote.failed (schema)
  │           └─ mapToDecision(parsed) → OverlayDecision
  │
  ├─ applyPreDecision(taskId, decision, iteration)
  │     ├─ PASS → return "CONTINUE"
  │     ├─ REWORK → RUNNING→NEEDS_REWORK→RUNNING; return "NEEDS_REWORK"
  │     ├─ FAIL → RUNNING→FAILED; return "FAILED"
  │     └─ HIL → RUNNING→HIL_PENDING; awaitResolution; return "HIL_AWAITING"
  │
  └─ [if "CONTINUE"] → adapter.dispatchWithRetry()
```

### MCP wire format data flow

```
OverlayInvokeInput (TypeScript struct)
  │
  │ JSON serialization (by MCP SDK)
  ▼
MCP stdio transport
  │
  ▼
Remote MCP server overlay.invoke tool
  │
  ▼
MCP stdio response
  │
  │ SDK unwrapping (McpClientWrapper.callTool → unwrapSdkResponse)
  ▼
raw: unknown (JSON-parsed value)
  │
  │ OverlayInvokeOutputSchema.safeParse(raw)
  ▼
OverlayInvokeOutput (typed, validated)
  │
  │ mapToDecision()
  ▼
OverlayDecision { verdict, feedback, evidence }
  │
  │ Engine.applyPreDecision / applyPostDecision
  ▼
StateManager.transition()
```

### Config loading flow

```
.ai-sdd/ai-sdd.yaml (raw YAML)
  │
  ├─ existing ProjectConfig path (unchanged)
  │
  └─ parseRemoteOverlayConfig(raw)
        │
        ├─ absent sections → returns undefined
        │
        └─ present sections → RemoteOverlaysSectionSchema.parse(raw)
              │
              ├─ ZodError on validation failure → surfaced by validate-config
              │
              └─ ResolvedOverlayConfig { overlay_backends, remote_overlays, governance }
                    │
                    └─ buildProviderChain({ localOverlays, remoteConfig, emitter })
                          │
                          └─ OverlayProvider[] (used by Engine constructor)
```

---

## Error Handling

### Error taxonomy

| Error class | Location | Trigger | Caught by |
|-------------|----------|---------|-----------|
| `RegistryError` | `src/overlays/registry.ts` | Invalid chain config at build time | Engine startup / CLI |
| `McpTimeoutError` | `src/overlays/mcp/mcp-client.ts` | `callTool` exceeds `timeout_ms` | `McpOverlayProvider` Tier 1 catch |
| `McpNotConnectedError` | `src/overlays/mcp/mcp-client.ts` | `callTool` before `connect()` | `McpOverlayProvider` Tier 1 catch |
| `McpSchemaError` | `src/overlays/mcp/mcp-client.ts` | Reserved for future use | N/A in this release |
| `ZodError` | `src/config/remote-overlay-schema.ts` | Invalid config | Config loader / validate-config |
| `TypeError` | `src/overlays/local-overlay-provider.ts` | No hooks, or COMPLETED returned from overlay | Chain runner catch → FAIL decision |
| `StateError` (existing) | `src/core/state-manager.ts` | Invalid `VALID_TRANSITIONS` (including from CANCELLED) | Engine (surfaces as FAILED) |

### Two-tier failure model (McpOverlayProvider)

**Tier 1 — Transport errors** (any error thrown before a valid response is received):
- `McpTimeoutError` — call exceeded `timeout_ms`
- Connection refused / subprocess spawn failure
- Process crash / unexpected exit before response

Governed by `effectivePolicy`:
```
effectivePolicy = blocking === false ? "warn" : backendConfig.failure_policy
```

| `effectivePolicy` | Action |
|-------------------|--------|
| `"skip"` | Return `{ verdict: "PASS" }`; emit `overlay.remote.fallback` only (no `overlay.remote.failed`) |
| `"warn"` | Return `{ verdict: "PASS" }`; emit `overlay.remote.failed` + `overlay.remote.fallback` |
| `"fail_closed"` | Return `{ verdict: "FAIL", feedback: "Transport error: ..." }` |

**Tier 2 — Schema violations** (response received but fails `OverlayInvokeOutputSchema`):
- Always return `{ verdict: "FAIL" }`. `failure_policy` and `blocking` are irrelevant.
- Emit `overlay.remote.failed` with `failure_tier: "schema"`.
- Never emit `overlay.remote.fallback` for schema violations.

**Cleanup on error**: `disconnect()` is called best-effort (`.catch(() => {})`) in both Tier 1 and the `finally` block for Tier 2. `disconnect()` errors are swallowed and never replace or mask the original error. Callers have no cleanup responsibility.

### Chain runner exception handling

Any exception thrown by a provider's `invokePre` / `invokePost` is caught by the chain runner:
```
{ verdict: "FAIL",
  feedback: "Provider '${id}' threw unexpectedly: ${error.message}",
  evidence: { overlay_id: id, source: runtime } }
```

No exception propagates out of `runPreProviderChain` or `runPostProviderChain`. This is the reliability guarantee from NFR-002.

### State machine errors (CANCELLED)

`StateManager.transition(taskId, "CANCELLED")` follows the existing tmp+rename atomic write pattern. Any attempt to transition out of `CANCELLED` throws `StateError` with the existing format for invalid transitions.

---

## Testing Strategy

### Test file map

| File | Component tested | Category |
|------|-----------------|---------|
| `tests/overlays/overlay-protocol.test.ts` | `OverlayInvokeOutputSchema` | Unit |
| `tests/overlays/local-overlay-provider.test.ts` | `LocalOverlayProvider` verdict mapping, hook detection | Unit |
| `tests/overlays/registry.test.ts` | `buildProviderChain` ordering and error paths | Unit |
| `tests/overlays/provider-chain.test.ts` | `runPreProviderChain`, `runPostProviderChain`, `mergeContextUpdate` | Unit |
| `tests/overlays/composition-rules.test.ts` (existing, extended) | `validateProviderCombination` including Invariant 6 | Unit |
| `tests/overlays/mcp/mcp-client.test.ts` | `McpClientWrapper` lifecycle, timeout, errors | Unit (mock SDK) |
| `tests/overlays/mcp/mcp-overlay-provider.test.ts` | Two-tier failure model, observability events | Unit (injectable factory) |
| `tests/config/remote-overlay-schema.test.ts` | Zod schema acceptance/rejection, defaults | Unit |
| `tests/state-manager.test.ts` (existing, extended) | `CANCELLED` state transitions | Unit |
| `tests/engine.test.ts` (existing, extended) | `applyPreDecision`, `applyPostDecision`, evidence persistence, HIL resume | Integration |

### Key testing patterns

**Injectable `clientFactory`**: `McpOverlayProvider` accepts a `clientFactory` parameter. Tests inject a factory that returns a mock `McpClientWrapper` — no subprocess spawning required.

**Two-tier isolation**: Tests for Tier 1 (transport) and Tier 2 (schema) are separate. Tier 1 tests configure the mock to throw transport errors. Tier 2 tests configure the mock to return a response and supply invalid JSON.

**External schema fixture** (NFR-004): `tests/overlays/mcp/mcp-client.test.ts` must include a fixture of the actual `@modelcontextprotocol/sdk@^1.0.4` `CallToolResult` structure to verify `unwrapSdkResponse` handles the real SDK envelope. This is a captured fixture, not a manually-constructed assumed shape.

**Exhaustiveness testing**: TypeScript compile-time only. `bun run typecheck` must pass. No runtime test can verify this — it is enforced by the CI typecheck step.

**Backward compatibility gate**: All 177 pre-feature tests must pass unmodified after Phase 1 changes. The CI pipeline must run `bun test` as a regression gate before any new test files are counted.

**Secret redaction**: An existing `sanitizer.ts` fixture with a known secret pattern is reused in `mcp-overlay-provider.test.ts`. The test injects the pattern value in `config` passthrough and asserts the emitted event payload contains `"[REDACTED]"` and not the literal value.

**`mergeContextUpdate` identity stripping**: A dedicated test passes `updated_context` containing `task_id: "injected"`, `workflow_id: "injected"`, `run_id: "injected"`, and `status: "COMPLETED"`. After `mergeContextUpdate`, all four fields in the returned context must match the original values, not the injected values.

**CANCELLED reachability**: Tests for `PENDING → CANCELLED`, `RUNNING → CANCELLED`, `NEEDS_REWORK → CANCELLED`, and `HIL_PENDING → CANCELLED`. Tests that `COMPLETED → CANCELLED` and `FAILED → CANCELLED` throw `StateError`. Test that `CANCELLED → RUNNING` throws `StateError`.

### NFR test coverage mapping

| NFR | Primary test | Numeric target |
|-----|-------------|----------------|
| NFR-001 (Performance) | `mcp-client.test.ts`: timeout enforced within `timeout_ms + 50ms` | Default `timeout_ms = 5000` |
| NFR-001 (Performance) | `provider-chain.test.ts`: phase-skip latency | Skip completes in < 1ms (documented, not strictly asserted in CI) |
| NFR-002 (Reliability) | `provider-chain.test.ts`: exception → FAIL (no propagation) | 0% engine crash rate from provider errors |
| NFR-002 (Reliability) | `state-manager.test.ts`: CANCELLED atomic write | 100% atomic (tmp+rename verified by test) |
| NFR-003 (Security) | `mcp-overlay-provider.test.ts`: FORCE_ACCEPT rejected | 0 unrecognized verdicts reach engine |
| NFR-003 (Security) | `mcp-overlay-provider.test.ts`: secret redaction | 100% matching patterns replaced |
| NFR-004 (Compatibility) | Full `bun test` run: 177/177 pass | 0 regressions |
| NFR-004 (Compatibility) | `bun run typecheck` passes | 0 type errors |
