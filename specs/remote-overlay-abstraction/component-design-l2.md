# Component Design L2 — Remote Overlay Abstraction

**Feature**: Remote Overlay Abstraction (ROA)
**Principal Engineer review date**: 2026-03-07
**Inputs**: design-l1.md, FR-001 through FR-009, NFR-001 through NFR-004
**Status**: READY FOR IMPLEMENTATION

---

## Design Principles (inherited from L1, enforced here)

1. Engine is the single enforcement point — no provider or chain runner may call `stateManager.transition()`.
2. Schema violations are always `fail_closed` — `failure_policy` governs transport errors only.
3. `LocalOverlayProvider` wraps existing `BaseOverlay` instances with zero behavioral change.
4. All new source files: TypeScript strict mode, no `any`, no `eval()`, no `require()`, use `import.meta.url` not `__dirname`.
5. Provider chain order is an invariant enforced at registry build time, not at call time.

---

## Component Index

| # | Component | File | Phase |
|---|-----------|------|-------|
| A | Overlay Protocol Types | `src/types/overlay-protocol.ts` | 1 |
| B | LocalOverlayProvider | `src/overlays/local-overlay-provider.ts` | 1 |
| C | OverlayRegistry | `src/overlays/registry.ts` | 1 |
| D | ProviderChain runner | `src/overlays/provider-chain.ts` | 1 |
| E | McpClientWrapper | `src/overlays/mcp/mcp-client.ts` | 4 |
| F | McpOverlayProvider | `src/overlays/mcp/mcp-overlay-provider.ts` | 4 |
| G | Remote overlay config schema | `src/config/remote-overlay-schema.ts` | 3 |
| H | CANCELLED state addition | `src/types/index.ts` (modification) | 2 |
| I | Engine verdict mapping | `src/core/engine.ts` (modification) | 1 |
| J | Observability event additions | `src/observability/events.ts` (modification) | 1 |
| K | Composition rules extension | `src/overlays/composition-rules.ts` (modification) | 1 |
| L | TaskDefinition extensions | `src/types/index.ts` (modification) | 1 |

---

## A. `src/types/overlay-protocol.ts` (new file)

### Responsibility

Defines all transport-agnostic protocol types that cross the boundary between the engine and overlay providers. This is the canonical source of truth for the overlay protocol — no other file defines these types.

### Interface / TypeScript Signatures

```typescript
import { z } from "zod";
import type { AgentContext, TaskResult } from "./index.ts";

// ── Runtime and Hook Discriminators ─────────────────────────────────────────

export type OverlayRuntime = "local" | "cli" | "mcp";
export type OverlayHook = "pre_task" | "post_task";

// ── Verdict ──────────────────────────────────────────────────────────────────
// Exactly four values. TypeScript exhaustiveness depends on this being a
// string union, not an enum, so switch statements will compile-fail if a new
// value is added without a handler.

export type OverlayVerdict = "PASS" | "REWORK" | "FAIL" | "HIL";

// ── Evidence ──────────────────────────────────────────────────────────────────

export interface OverlayEvidence {
  overlay_id: string;
  source: OverlayRuntime;
  checks?: string[];
  report_ref?: string;
  data?: Record<string, unknown>;
}

// ── Decision ─────────────────────────────────────────────────────────────────
// Every overlay provider returns exactly this type.

export interface OverlayDecision {
  verdict: OverlayVerdict;
  feedback?: string;
  /** Updated context forwarded to subsequent providers and agent dispatch.
   *  Engine MUST strip identity fields (task_id, status, workflow_id, run_id)
   *  before applying. */
  updated_context?: Partial<AgentContext>;
  evidence?: OverlayEvidence;
}

// ── Context ──────────────────────────────────────────────────────────────────
// Extended from OverlayContext in base-overlay.ts.
// Re-exported here so providers import from one place.

export interface OverlayContext {
  task_id: string;
  workflow_id: string;
  run_id: string;
  task_definition: import("./index.ts").TaskDefinition;
  agent_context: AgentContext;
}

// ── Provider Interface ───────────────────────────────────────────────────────

export interface OverlayProvider {
  readonly id: string;
  readonly runtime: OverlayRuntime;
  /** At least one hook must be declared. */
  readonly hooks: OverlayHook[];
  readonly enabled: boolean;
  /** When set, provider is skipped for tasks whose phase is not in this list. */
  readonly phases?: string[];

  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}

// ── MCP Wire Format (Zod schemas) ────────────────────────────────────────────
// Used by McpOverlayProvider to validate raw MCP tool responses.

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

// ── MCP Tool Input ────────────────────────────────────────────────────────────
// Sent by McpOverlayProvider when calling the remote overlay.invoke tool.

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

### Dependencies

None (foundational module). `AgentContext` and `TaskDefinition` imported from `./index.ts`.

### Implementation Notes

- `OverlayVerdict` is a string union, not an `enum` keyword. This ensures TypeScript exhaustiveness checks in switch statements catch missing cases at compile time.
- `OverlayInvokeOutputSchema` must be the only Zod schema used to validate MCP wire responses. No ad-hoc parsing is permitted in `McpOverlayProvider`.
- `OverlayContext` in this file duplicates the shape from `base-overlay.ts`. The two must remain structurally compatible. Phase 1 implementation note: do not delete `base-overlay.ts`'s `OverlayContext` — it is imported by existing overlays. Instead, ensure the new `OverlayContext` here is a strict superset (currently identical shape). Long term, existing overlays migrate to import from here.
- `updated_context` on `OverlayDecision` must carry a `Partial<AgentContext>` not a raw `Record`. This prevents remote providers from injecting arbitrary keys into agent context.

### Tests Required

**File**: `tests/overlays/overlay-protocol.test.ts`

| Test case | Assertion |
|-----------|-----------|
| `OverlayInvokeOutputSchema` accepts valid response | `parse()` returns typed object with verdict |
| `OverlayInvokeOutputSchema` rejects unknown verdict `"FORCE_ACCEPT"` | `safeParse()` returns `success: false` |
| `OverlayInvokeOutputSchema` rejects response missing `verdict` field | `safeParse()` returns `success: false` |
| `OverlayInvokeOutputSchema` rejects `protocol_version: "2"` | `safeParse()` returns `success: false`; version mismatch is detectable |
| `OverlayInvokeOutputSchema` rejects non-JSON (parse attempt) | Schema parse on empty string or partial JSON throws |
| TypeScript exhaustiveness: all four verdicts handled | Compile-time only — enforced via CI `bun run typecheck` |

---

## B. `src/overlays/local-overlay-provider.ts` (new file)

### Responsibility

Wraps an existing `BaseOverlay` instance in the `OverlayProvider` interface so the engine can treat local and remote overlays identically. Zero behavioral change to the wrapped overlay.

### Interface / TypeScript Signatures

```typescript
import type { BaseOverlay, OverlayContext as LegacyContext, OverlayResult, PostTaskOverlayResult } from "./base-overlay.ts";
import type { OverlayProvider, OverlayDecision, OverlayVerdict, OverlayHook, OverlayContext } from "../types/overlay-protocol.ts";
import type { TaskResult } from "../types/index.ts";

export class LocalOverlayProvider implements OverlayProvider {
  readonly id: string;
  readonly runtime: "local" = "local";
  readonly hooks: OverlayHook[];
  readonly enabled: boolean;
  readonly phases?: string[];

  constructor(private readonly overlay: BaseOverlay) { ... }

  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;

  /** Exposes the wrapped overlay for HIL awaiting (engine still calls awaitResolution directly). */
  readonly inner: BaseOverlay;
}

/** Map OverlayResult → OverlayDecision (pre-task results). */
function mapPreResult(result: OverlayResult, overlayId: string): OverlayDecision;

/** Map PostTaskOverlayResult → OverlayDecision (post-task results). */
function mapPostResult(result: PostTaskOverlayResult, overlayId: string): OverlayDecision;
```

### Mapping Logic

`OverlayResult → OverlayDecision`:

| `OverlayResult` field | `OverlayDecision` verdict | Notes |
|-----------------------|--------------------------|-------|
| `proceed: true` | `"PASS"` | |
| `proceed: false, hil_trigger: true` | `"HIL"` | `data.hil_id` → `evidence.data.hil_id` |
| `proceed: false, hil_trigger: false/undefined` | `"REWORK"` | `feedback` forwarded |

`PostTaskOverlayResult → OverlayDecision`:

| `PostTaskOverlayResult` field | `OverlayDecision` verdict |
|-------------------------------|--------------------------|
| `accept: true` | `"PASS"` |
| `accept: false, new_status: "NEEDS_REWORK"` or undefined | `"REWORK"` |
| `accept: false, new_status: "FAILED"` | `"FAIL"` |
| `accept: false, new_status: "COMPLETED"` | Rejected — this is invalid; throw `TypeError` |

### Hook Detection

At construction time, set `this.hooks` based on which methods the wrapped overlay implements:

```typescript
const hooks: OverlayHook[] = [];
if (typeof overlay.preTask === "function") hooks.push("pre_task");
if (typeof overlay.postTask === "function") hooks.push("post_task");
if (hooks.length === 0) {
  throw new TypeError(
    `LocalOverlayProvider: overlay '${overlay.name}' declares no hooks (preTask/postTask). ` +
    `A provider must implement at least one hook method.`
  );
}
```

`invokePre` is defined on the class only if `"pre_task"` is in hooks; `invokePost` only if `"post_task"` is in hooks. Use a conditional assignment in the constructor (not optional chaining) so the method is properly `undefined` for providers that lack it.

### Context Conversion

`OverlayContext` (new) → `LegacyContext` (base-overlay):

```typescript
function toLegacyCtx(ctx: OverlayContext): LegacyContext {
  return {
    task_id: ctx.task_id,
    workflow_id: ctx.workflow_id,
    run_id: ctx.run_id,
    task_definition: ctx.task_definition,
    agent_context: ctx.agent_context,
  };
}
```

Both shapes are currently identical, so this is a structural pass-through. It is kept as an explicit function so the conversion can evolve independently.

### Dependencies

- `./base-overlay.ts` — `BaseOverlay`, `OverlayContext` (legacy), `OverlayResult`, `PostTaskOverlayResult`
- `../types/overlay-protocol.ts` — `OverlayProvider`, `OverlayDecision`, `OverlayHook`, `OverlayContext`
- `../types/index.ts` — `TaskResult`

### Implementation Notes

- The `inner` property exposes the wrapped `BaseOverlay` for the engine's HIL `awaitResolution` call. The engine currently finds the HIL overlay by name on the raw chain; after refactoring, it must find it via `(provider as LocalOverlayProvider).inner` or by casting. See Component I for the engine integration pattern.
- The `enabled` property reads directly from `overlay.enabled` — no caching. If the underlying overlay's `enabled` field changes (unlikely in practice), the provider reflects the change.
- `PostTaskOverlayResult.new_status: "COMPLETED"` is rejected because the provider chain runner returns a decision to the engine; the engine alone decides COMPLETED status. A `PostTaskOverlayResult` with `accept: true` maps to PASS, not `new_status: "COMPLETED"`.

### Tests Required

**File**: `tests/overlays/local-overlay-provider.test.ts`

| Test case | Assertion |
|-----------|-----------|
| Pre-task: `proceed: true` → `PASS` verdict | `invokePre` returns `{ verdict: "PASS" }` |
| Pre-task: `proceed: false` (no HIL) → `REWORK` verdict | `invokePre` returns `{ verdict: "REWORK", feedback: "..." }` |
| Pre-task: `proceed: false, hil_trigger: true` → `HIL` verdict | `invokePre` returns `{ verdict: "HIL" }` |
| Post-task: `accept: true` → `PASS` | `invokePost` returns `{ verdict: "PASS" }` |
| Post-task: `accept: false, new_status: "NEEDS_REWORK"` → `REWORK` | `invokePost` returns `{ verdict: "REWORK" }` |
| Post-task: `accept: false, new_status: "FAILED"` → `FAIL` | `invokePost` returns `{ verdict: "FAIL" }` |
| Post-task: `accept: false, new_status: "COMPLETED"` → `TypeError` | Constructor-time or call-time rejection |
| Overlay with no pre/post methods → TypeError at construction | Error message names the overlay and the missing method |
| `inner` property exposes wrapped overlay | `provider.inner === originalOverlay` |
| `enabled` reflects underlying overlay | `overlay.enabled = false` → `provider.enabled === false` |
| `runtime` is always `"local"` | Literal type check |
| Equivalence: `LocalOverlayProvider` produces same verdicts as direct invocation | For each `BaseOverlay` fixture, assert `provider.invokePre(ctx).verdict` matches mapped direct result |

---

## C. `src/overlays/registry.ts` (new file)

### Responsibility

Builds the ordered `OverlayProvider[]` chain from resolved project configuration. This is a pure build-time step (runs once at engine startup, not per-task). It enforces the locked chain order and validates composition rules.

### Interface / TypeScript Signatures

```typescript
import type { OverlayProvider } from "../types/overlay-protocol.ts";
import type { ResolvedOverlayConfig } from "../config/remote-overlay-schema.ts";

/** All inputs required to build the provider chain. */
export interface RegistryInput {
  /** Resolved overlays config (HIL, policy_gate, review, paired, confidence). */
  localOverlays: {
    hil?: import("../overlays/base-overlay.ts").BaseOverlay;
    policy_gate?: import("../overlays/base-overlay.ts").BaseOverlay;
    review?: import("../overlays/base-overlay.ts").BaseOverlay;
    paired?: import("../overlays/base-overlay.ts").BaseOverlay;
    confidence?: import("../overlays/base-overlay.ts").BaseOverlay;
  };
  /** Parsed remote overlay config (may be undefined if section absent). */
  remoteConfig?: ResolvedOverlayConfig;
}

/**
 * Build the full ordered provider chain.
 * Throws RegistryError if:
 *   - a remote_overlay references an unknown backend_id
 *   - a remote_overlay backend runtime is "mcp" and no tool is specified
 *   - both Review and Paired are enabled (existing mutual-exclusion rule)
 *   - any local overlay has no hooks (pre/post) — forwarded from LocalOverlayProvider
 *
 * Chain order (invariant):
 *   HIL → remote overlays (insertion order) → policy_gate → review/paired → confidence
 */
export function buildProviderChain(input: RegistryInput): OverlayProvider[];

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}
```

### Chain Build Algorithm

```
1. chain = []
2. if localOverlays.hil → chain.push(new LocalOverlayProvider(hil))
3. if remoteConfig?.remote_overlays:
     for each (name, cfg) in remoteConfig.remote_overlays (insertion order):
       if !cfg.enabled: continue
       backend = remoteConfig.overlay_backends[cfg.backend]
       if !backend: throw RegistryError(`remote_overlays['${name}'] references unknown backend '${cfg.backend}'`)
       if backend.runtime === "mcp":
         chain.push(new McpOverlayProvider(name, cfg, backend, emitter))
       else if backend.runtime === "cli":
         chain.push(new CliOverlayProvider(name, cfg, backend, emitter))
4. if localOverlays.policy_gate → chain.push(new LocalOverlayProvider(policy_gate))
5. if localOverlays.review && localOverlays.paired && both enabled:
     throw RegistryError("Invariant 5 violated: Paired and Review overlays are mutually exclusive")
6. if localOverlays.review → chain.push(new LocalOverlayProvider(review))
7. if localOverlays.paired → chain.push(new LocalOverlayProvider(paired))
8. if localOverlays.confidence → chain.push(new LocalOverlayProvider(confidence))
9. return chain
```

Note: The emitter is passed to remote providers for observability. Registry does not emit events itself.

### Dependencies

- `./local-overlay-provider.ts`
- `./mcp/mcp-overlay-provider.ts` (Phase 4; import guarded by runtime check in Phase 3)
- `./cli/cli-overlay-provider.ts` (Phase 3)
- `../types/overlay-protocol.ts`
- `../config/remote-overlay-schema.ts`

### Implementation Notes

- In Phase 1 (local-only), the `remoteConfig` parameter can be `undefined` and no remote provider classes need to exist. The Phase 1 implementation of `buildProviderChain` skips the remote section entirely when `remoteConfig` is absent. This keeps Phase 1 backward-compatible with zero remote config.
- The registry does not validate whether individual overlays are "correctly configured" beyond the mutual-exclusion check. Each overlay class is responsible for its own invariants at construction.
- `buildProviderChain` is not a class method — it is a pure function. This makes it easy to test in isolation and avoids hidden constructor dependencies.
- The registry must be invoked once per engine run (at engine startup), not once per task. The `Engine` constructor receives the pre-built `OverlayProvider[]` chain.

### Tests Required

**File**: `tests/overlays/registry.test.ts`

| Test case | Assertion |
|-----------|-----------|
| No config: only local overlays, no remote | Chain order: HIL → policy_gate → confidence (for defaults) |
| HIL is always first | Regardless of overlay insertion order in input, HIL appears at index 0 |
| Remote overlays appear after HIL, before policy_gate | Chain index ordering assertion |
| Unknown backend reference → `RegistryError` | Error message includes the backend ID and overlay name |
| Both Review and Paired enabled → `RegistryError` | Error message matches existing composition error text |
| `enabled: false` remote overlay is excluded | Chain length matches (disabled overlays not included) |
| Absent `remoteConfig` → no remote providers | Chain contains only local providers |
| Multiple remote overlays preserve insertion order | Order in YAML config = order in chain |

---

## D. `src/overlays/provider-chain.ts` (new file)

### Responsibility

Executes the ordered provider chain for pre-task and post-task hooks. Returns the first non-PASS verdict (short-circuit), or PASS if all providers return PASS. This is the runtime counterpart to the build-time registry.

### Interface / TypeScript Signatures

```typescript
import type { OverlayProvider, OverlayDecision, OverlayContext } from "../types/overlay-protocol.ts";
import type { TaskResult } from "../types/index.ts";

/**
 * Run pre-task hook for each provider in chain order.
 * Short-circuits on first non-PASS verdict.
 * Skips providers that do not declare "pre_task" hook.
 * Skips providers where enabled === false.
 * Skips providers where phases is set and ctx.task_definition.phase is not in the list.
 */
export async function runPreProviderChain(
  chain: OverlayProvider[],
  ctx: OverlayContext,
): Promise<OverlayDecision>;

/**
 * Run post-task hook for each provider in chain order.
 * Short-circuits on first non-PASS verdict.
 * Skips providers that do not declare "post_task" hook.
 * Applies same enabled + phase filters as runPreProviderChain.
 */
export async function runPostProviderChain(
  chain: OverlayProvider[],
  ctx: OverlayContext,
  result: TaskResult,
): Promise<OverlayDecision>;
```

### Execution Algorithm (both functions are symmetric)

```
for provider in chain:
  if !provider.enabled: continue
  if hook not in provider.hooks: continue
  if provider.phases is set AND ctx.task_definition.phase not in provider.phases: continue

  try:
    decision = await provider.invokePre(ctx)   // or invokePost for post chain
  catch err:
    // Unhandled error from a provider — normalize to FAIL
    // This is the "reliability" catch path (NFR-002)
    decision = {
      verdict: "FAIL",
      feedback: `Provider '${provider.id}' threw unexpectedly: ${err.message}`,
      evidence: { overlay_id: provider.id, source: provider.runtime }
    }

  if decision.verdict !== "PASS":
    return decision   // short-circuit

  // Accumulate updated_context for next provider (strip identity fields)
  if decision.updated_context:
    ctx = mergeContextUpdate(ctx, decision.updated_context)

return { verdict: "PASS" }
```

### Context Update Merging

```typescript
const IDENTITY_FIELDS = new Set(["task_id", "workflow_id", "run_id", "status"]);

function mergeContextUpdate(ctx: OverlayContext, update: Partial<AgentContext>): OverlayContext {
  const safeUpdate = Object.fromEntries(
    Object.entries(update).filter(([k]) => !IDENTITY_FIELDS.has(k))
  );
  return {
    ...ctx,
    agent_context: { ...ctx.agent_context, ...safeUpdate },
  };
}
```

This is the engine's second enforcement point for the no-mutation invariant (the first is in the engine's verdict-mapping logic in Component I).

### Dependencies

- `../types/overlay-protocol.ts` — `OverlayProvider`, `OverlayDecision`, `OverlayContext`
- `../types/index.ts` — `TaskResult`, `AgentContext`

### Implementation Notes

- The unhandled-exception catch path converts any provider Error to `FAIL` with an actionable message. This ensures no unhandled rejections escape to the engine (NFR-002).
- Phase filtering uses `ctx.task_definition.phase` — this field is added to `TaskDefinition` in Component L. When `phase` is `undefined` on the task definition and the provider has a `phases` filter, the provider is skipped (conservative: unknown phase does not match any filter).
- These functions do not emit observability events. Remote providers emit their own events internally. This keeps the chain runner simple and testable without an emitter dependency.
- The existing `runPreTaskChain` / `runPostTaskChain` in `base-overlay.ts` are NOT deleted. The engine switches to calling these new functions, but the old functions remain for backward compatibility (existing tests may import them directly).

### Tests Required

**File**: `tests/overlays/provider-chain.test.ts`

| Test case | Assertion |
|-----------|-----------|
| Empty chain → PASS | Returns `{ verdict: "PASS" }` |
| All PASS → PASS | Returns PASS after all providers called |
| First non-PASS short-circuits | Third provider's `invokePre` is never called when second returns REWORK |
| `enabled: false` provider is skipped | `invokePre` not called, chain continues |
| Provider not declaring `pre_task` hook is skipped for pre chain | `invokePre` not called |
| Phase filter excludes non-matching provider | `invokePre` not called when task.phase not in provider.phases |
| Phase filter passes matching provider | `invokePre` called when task.phase in provider.phases |
| Phase filter: `provider.phases` undefined → always included | `invokePre` called regardless of task.phase |
| Unhandled provider exception → FAIL | Returns `{ verdict: "FAIL" }` with feedback message; no unhandled rejection |
| `updated_context` propagated to next provider | Second provider receives merged context |
| Identity fields stripped from `updated_context` | `task_id` in updated_context is not visible to next provider |
| Post-chain symmetric behavior | All above tests replicated for `runPostProviderChain` |

---

## E. `src/overlays/mcp/mcp-client.ts` (new file)

### Responsibility

Thin wrapper around `@modelcontextprotocol/sdk` that manages a single stdio MCP connection lifecycle and enforces per-call timeouts. All MCP SDK types are confined to this file; callers receive plain TypeScript values.

### Interface / TypeScript Signatures

```typescript
import type { ResolvedBackendConfig } from "../../config/remote-overlay-schema.ts";

export class McpTimeoutError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly timeoutMs: number,
  ) {
    super(`MCP tool call '${toolName}' timed out after ${timeoutMs}ms. ` +
          `Increase timeout_ms in overlay_backends config if the remote is slow.`);
    this.name = "McpTimeoutError";
  }
}

export class McpNotConnectedError extends Error {
  constructor(public readonly backendId: string) {
    super(`McpClientWrapper for backend '${backendId}' is not connected. ` +
          `Call connect() before invoking callTool().`);
    this.name = "McpNotConnectedError";
  }
}

export class McpSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpSchemaError";
  }
}

export class McpClientWrapper {
  constructor(
    private readonly config: ResolvedBackendConfig & { runtime: "mcp" },
  ) {
    // Validate transport at construction time — not deferred to connect()
    if ((config as { transport?: string }).transport !== "stdio") {
      throw new TypeError(
        `McpClientWrapper: unsupported transport '${(config as {transport?: string}).transport}'. ` +
        `Only 'stdio' is supported in this release.`
      );
    }
  }

  /** Establish the stdio transport connection to the remote MCP server. */
  async connect(): Promise<void>;

  /** Close the connection cleanly. Safe to call when not connected (no-op). */
  async disconnect(): Promise<void>;

  /**
   * Call a named MCP tool and return the raw response content.
   * Enforces timeout_ms from config. Throws:
   *   - McpNotConnectedError if connect() has not been called
   *   - McpTimeoutError if the call exceeds timeout_ms
   *   - Error for any other MCP transport error
   */
  async callTool(toolName: string, input: unknown): Promise<unknown>;

  /** True after connect() succeeds and before disconnect() is called. */
  get isConnected(): boolean;
}
```

### Internal Implementation Pattern

```
connect():
  1. Build StdioClientTransport from config.command + config.env
  2. Instantiate @modelcontextprotocol/sdk Client
  3. client.connect(transport)
  4. this._connected = true

callTool(name, input):
  1. if !this._connected: throw McpNotConnectedError
  2. timeout = config.timeout_ms ?? 5000
  3. race: [
       client.callTool({ name, arguments: input }),
       new Promise((_, reject) => setTimeout(() => reject(new McpTimeoutError(name, timeout)), timeout))
     ]
  4. Extract content from MCP response (unwrap from MCP SDK envelope)
  5. Return plain value (Record<string,unknown> or string)

disconnect():
  1. if !this._connected: return (no-op)
  2. client.close()
  3. this._connected = false
```

### Key Detail: MCP SDK Response Unwrapping

The MCP SDK returns tool results wrapped in a `CallToolResult` envelope. `callTool` must extract the content before returning to callers. The exact unwrapping depends on the SDK version (`^1.0.4`). The implementation must handle both `content[0].text` (text content) and `content[0].json` (structured content) response types.

**Decision required**: Inspect `@modelcontextprotocol/sdk@^1.0.4` `CallToolResult` type at implementation time to determine the correct unwrapping. The test fixture (see tests) must capture a real SDK response to prevent schema drift.

### Dependencies

- `@modelcontextprotocol/sdk` — `Client`, `StdioClientTransport` (confined to this file only)
- `../../config/remote-overlay-schema.ts` — `ResolvedBackendConfig`

### Implementation Notes

- `config.command` is `string[]`. The first element is the executable; the rest are arguments. `StdioClientTransport` accepts this format.
- `config.env` (optional) is merged with `process.env` when spawning the subprocess, not replacing it. This allows the remote process to inherit PATH and other env vars.
- The timeout race uses `setTimeout` with `Bun`'s global timer (compatible, no import needed).
- No retry logic here. Retries are the concern of `McpOverlayProvider`'s failure handling.
- `isConnected` getter is read-only. It is used by `McpOverlayProvider` to check state before delegating connection management.
- The wrapper does not buffer or stream response data. It awaits the full `callTool` response before returning.

### Tests Required

**File**: `tests/overlays/mcp/mcp-client.test.ts`

These tests use a fixture or in-process mock — not a real MCP server.

| Test case | Assertion |
|-----------|-----------|
| `callTool` before `connect` → `McpNotConnectedError` | Error name is `"McpNotConnectedError"`, message instructs `connect()` |
| Successful `connect` + `callTool` (mock server) | Returns unwrapped plain value; no SDK types in return |
| `callTool` timeout → `McpTimeoutError` within `timeout_ms + 50ms` | Error name is `"McpTimeoutError"`, `timeoutMs` field matches config |
| `disconnect` after tool call → `isConnected === false` | Subsequent `callTool` throws `McpNotConnectedError` |
| `disconnect` when not connected → no-op (no throw) | Does not throw |
| Transport `"sse"` at construction → `TypeError` | Error message names `"sse"` as unsupported |
| External schema fixture: assert SDK response shape matches expected unwrapping | Fixture captured from real `@modelcontextprotocol/sdk@1.0.4` — prevents schema drift |

---

## F. `src/overlays/mcp/mcp-overlay-provider.ts` (new file)

### Responsibility

Implements `OverlayProvider` for remote MCP backends. Delegates all MCP communication to `McpClientWrapper`, validates responses with `OverlayInvokeOutputSchema`, and maps the two-tier failure model (transport vs schema) per `failure_policy`.

### Interface / TypeScript Signatures

```typescript
import type { OverlayProvider, OverlayDecision, OverlayHook, OverlayContext } from "../../types/overlay-protocol.ts";
import type { ResolvedBackendConfig, ResolvedRemoteOverlayConfig } from "../../config/remote-overlay-schema.ts";
import type { TaskResult } from "../../types/index.ts";
import type { ObservabilityEmitter } from "../../observability/emitter.ts";

export class McpOverlayProvider implements OverlayProvider {
  readonly id: string;          // overlay name from config key
  readonly runtime: "mcp" = "mcp";
  readonly hooks: OverlayHook[];
  readonly enabled: boolean;
  readonly phases?: string[];

  constructor(
    overlayName: string,
    private readonly overlayConfig: ResolvedRemoteOverlayConfig,
    private readonly backendConfig: ResolvedBackendConfig & { runtime: "mcp" },
    private readonly emitter: ObservabilityEmitter,
  ) { ... }

  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}
```

### Invocation Algorithm (shared by `invokePre` and `invokePost`)

```
invoke(ctx, hook, result?):
  start = Date.now()
  client = new McpClientWrapper(backendConfig)

  try:
    emit "overlay.remote.connecting"
    await client.connect()
    emit "overlay.remote.connected" (duration_ms)
    emit "overlay.remote.invoked"

    input = buildInput(ctx, hook, result)   // builds OverlayInvokeInput
    raw = await client.callTool(backendConfig.tool, input)

  catch err:
    // Tier 1: Transport error
    await client.disconnect()   // best-effort
    emit "overlay.remote.failed" (failure_tier: "transport")

    switch backendConfig.failure_policy:
      case "skip":
        return { verdict: "PASS" }
      case "warn":
        emit "overlay.remote.fallback"
        return { verdict: "PASS" }
      case "fail_closed":
        return { verdict: "FAIL", feedback: err.message }

  finally:
    await client.disconnect()   // always disconnect after a call

  // Tier 2: Schema validation
  try:
    parsed = OverlayInvokeOutputSchema.parse(raw)
  catch zodErr:
    // Schema violation — always FAIL regardless of failure_policy
    emit "overlay.remote.failed" (failure_tier: "schema")
    return { verdict: "FAIL", feedback: "Remote overlay response failed schema validation: ..." }

  emit "overlay.remote.decision" (verdict, duration_ms)

  return mapToDecision(parsed, overlayName)
```

### Response Mapping

```typescript
function mapToDecision(
  parsed: OverlayInvokeOutput,
  overlayId: string,
): OverlayDecision {
  return {
    verdict: parsed.verdict,
    feedback: parsed.feedback,
    evidence: parsed.evidence
      ? {
          overlay_id: overlayId,
          source: "mcp",
          checks: parsed.evidence.checks,
          report_ref: parsed.evidence.report_ref,
          data: parsed.evidence.data,
        }
      : { overlay_id: overlayId, source: "mcp" },
  };
}
```

### `buildInput` Construction

```typescript
function buildInput(
  ctx: OverlayContext,
  hook: OverlayHook,
  result?: TaskResult,
  overlayName: string,
  passthrough?: Record<string, unknown>,
): OverlayInvokeInput {
  return {
    protocol_version: "1",
    overlay_id: overlayName,
    hook,
    workflow: { id: ctx.workflow_id, run_id: ctx.run_id },
    task: {
      id: ctx.task_id,
      phase: ctx.task_definition.phase,
      requirement_ids: ctx.task_definition.requirement_ids,
      acceptance_criteria: ctx.task_definition.acceptance_criteria,
      scope_excluded: ctx.task_definition.scope_excluded,
    },
    ...(hook === "post_task" && result ? {
      result: {
        outputs: result.outputs,
        handover_state: result.handover_state,
      }
    } : {}),
    config: passthrough,
  };
}
```

### `blocking: false` Behavior

When `overlayConfig.blocking === false`, Tier 1 transport errors always behave as `warn` (return PASS + emit event). Tier 2 schema violations still return FAIL. This is implemented as:

```typescript
const effectivePolicy = overlayConfig.blocking === false ? "warn" : backendConfig.failure_policy;
```

Applied only in the Tier 1 catch branch.

### Dependencies

- `../../types/overlay-protocol.ts`
- `./mcp-client.ts`
- `../../config/remote-overlay-schema.ts`
- `../../observability/emitter.ts`
- `../../types/index.ts` — `TaskResult`

### Implementation Notes

- A new `McpClientWrapper` is constructed per invocation. This is intentional: each overlay call is a fresh connection to a stateless tool server. Connection pooling is out of scope for Phase 4.
- `client.disconnect()` is called in both the success path and the transport-error catch path (best-effort in the catch). The `finally` block handles the success path disconnect.
- The `raw` value from `callTool` is passed directly to `OverlayInvokeOutputSchema.parse()`. If the underlying SDK returns a non-JSON-serializable object, `OverlayInvokeOutputSchema.parse()` will throw a ZodError which is caught by the Tier 2 block.
- `invokePre` and `invokePost` are conditionally assigned based on `overlayConfig.hooks`. Both call the shared `invoke()` private method with different hook labels.

### Tests Required

**File**: `tests/overlays/mcp/mcp-overlay-provider.test.ts`

Use a mock `McpClientWrapper` (inject via constructor parameter or test double) to avoid real network calls.

| Test case | Assertion |
|-----------|-----------|
| Valid `PASS` response → `PASS` decision | `invokePre` returns `{ verdict: "PASS" }` |
| Valid `REWORK` response → `REWORK` decision with feedback | Verdict and feedback forwarded |
| Valid `FAIL` response → `FAIL` decision with evidence | Evidence includes `source: "mcp"` |
| Valid `HIL` response → `HIL` decision | Verdict forwarded |
| Transport timeout + `failure_policy: warn` → PASS + event | Returns PASS; `overlay.remote.failed` event emitted with `failure_tier: "transport"` |
| Transport timeout + `failure_policy: fail_closed` → FAIL | Returns FAIL |
| Transport timeout + `failure_policy: skip` → PASS (no event) | Returns PASS; no `overlay.remote.failed` event |
| Schema violation (`verdict: "FORCE_ACCEPT"`) → FAIL regardless of `failure_policy` | Even with `failure_policy: skip`, returns FAIL |
| Non-JSON response → FAIL (`failure_tier: schema`) | `overlay.remote.failed` event with `failure_tier: "schema"` |
| `blocking: false` + transport error → `warn` behavior | Returns PASS regardless of `failure_policy: fail_closed` |
| `blocking: false` + schema error → FAIL | Schema safety not overridden by `blocking: false` |
| Protocol version `"2"` in response → FAIL (schema violation) | Zod rejects `protocol_version: z.literal("1")` |
| `updated_context` with identity fields stripped | `status` and `task_id` not forwarded in decision |
| Lifecycle events emitted in order | Events: connecting → connected → invoked → decision |
| Secret in passthrough config is redacted in events | Event payload does not contain raw secret value |

---

## G. `src/config/remote-overlay-schema.ts` (new file)

### Responsibility

Defines Zod schemas for the new `overlay_backends`, `remote_overlays`, and `governance` config sections. Exports resolved TypeScript types derived from the schemas. Integrates into the existing config loader path.

### Interface / TypeScript Signatures

```typescript
import { z } from "zod";

// ── Individual Schemas ────────────────────────────────────────────────────────

export const OverlayBackendConfigSchema = z.object({
  runtime: z.enum(["cli", "mcp"]),
  command: z.array(z.string()).min(1),
  tool: z.string().optional(),
  transport: z.enum(["stdio"]).default("stdio"),
  timeout_ms: z.number().int().positive().default(5000),
  failure_policy: z.enum(["skip", "warn", "fail_closed"]).default("warn"),
  env: z.record(z.string()).optional(),
}).refine(
  (data) => data.runtime !== "mcp" || data.tool !== undefined,
  {
    message: "overlay_backends: 'tool' is required when runtime is 'mcp'",
    path: ["tool"],
  },
);

export const RemoteOverlayConfigSchema = z.object({
  backend: z.string(),
  enabled: z.boolean().default(true),
  hooks: z.array(z.enum(["pre_task", "post_task"])).min(1, {
    message: "remote_overlays: 'hooks' must contain at least one hook (pre_task or post_task)",
  }),
  phases: z.array(z.string()).optional(),
  blocking: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});

export const GovernanceConfigSchema = z.object({
  requirements_lock: z.enum(["off", "warn", "enforce"]).default("warn"),
});

// ── Top-Level Remote Config Section ──────────────────────────────────────────

export const RemoteOverlaysSectionSchema = z.object({
  governance: GovernanceConfigSchema.optional(),
  overlay_backends: z.record(OverlayBackendConfigSchema).optional(),
  remote_overlays: z.record(RemoteOverlayConfigSchema).optional(),
}).optional();

// ── Resolved Types (inferred from schemas after .parse()) ─────────────────────

export type ResolvedBackendConfig = z.infer<typeof OverlayBackendConfigSchema>;
export type ResolvedRemoteOverlayConfig = z.infer<typeof RemoteOverlayConfigSchema>;
export type ResolvedGovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

/** Full resolved remote overlay config section. */
export interface ResolvedOverlayConfig {
  governance?: ResolvedGovernanceConfig;
  overlay_backends?: Record<string, ResolvedBackendConfig>;
  remote_overlays?: Record<string, ResolvedRemoteOverlayConfig>;
}

/**
 * Parse and validate the remote overlay config section.
 * Returns undefined if the section is absent (callers treat absence as no-op).
 * Throws ZodError on validation failure.
 */
export function parseRemoteOverlayConfig(
  raw: unknown,
): ResolvedOverlayConfig | undefined;
```

### Integration with Existing Config Loader

**File to modify**: wherever `ProjectConfig` is parsed from YAML (locate the config loader at implementation time — likely `src/cli/commands/run.ts` or a dedicated config loader).

The remote overlay section is parsed separately via `parseRemoteOverlayConfig(raw)` and stored alongside `ProjectConfig`. It does not become a field on `ProjectConfig` in Phase 1 to avoid breaking the `ProjectConfig` type used by 177 existing tests. This isolation preserves backward compatibility.

**Exception**: `governance` block defaults must be added to `src/config/defaults.ts`:

```typescript
// Add to DEFAULT_CONFIG (must not break Required<ProjectConfig>)
// Approach: add governance as an optional field to ProjectConfig in src/types/index.ts:
//   governance?: { requirements_lock?: "off" | "warn" | "enforce" }
// Then add to DEFAULT_CONFIG:
governance: { requirements_lock: "warn" }
```

### Example YAML Structure

```yaml
# .ai-sdd/ai-sdd.yaml

governance:
  requirements_lock: warn

overlay_backends:
  requirements-governor:
    runtime: mcp
    command: ["npx", "coding-standards-mcp"]
    tool: overlay.invoke
    transport: stdio
    timeout_ms: 5000
    failure_policy: warn

remote_overlays:
  requirements_governor:
    backend: requirements-governor
    enabled: true
    hooks: [pre_task, post_task]
    phases: [planning, design, implementation]
    blocking: true
    config:
      mode: enforce
```

### Dependencies

- `zod` — for schema definitions
- No runtime dependencies (pure schema + parsing)

### Implementation Notes

- `z.record(OverlayBackendConfigSchema)` means each backend ID maps to a validated backend config. Backend IDs are arbitrary strings (no format constraint at schema level; format validation can be added later).
- The `.refine()` on `OverlayBackendConfigSchema` validates the MCP+tool invariant at the Zod level. The registry also checks this, but Zod is the first line of defense.
- `RemoteOverlaysSectionSchema.optional()` means the entire section is optional. `parseRemoteOverlayConfig(undefined)` returns `undefined`.
- `validate-config` CLI integration: the CLI command must call `parseRemoteOverlayConfig` on the raw YAML and surface ZodErrors in the same format as existing config validation errors. This is a modification to `src/cli/commands/validate-config.ts`.

### Tests Required

**File**: `tests/config/remote-overlay-schema.test.ts`

| Test case | Assertion |
|-----------|-----------|
| Valid config with MCP backend + remote overlay accepted | `parseRemoteOverlayConfig` returns typed object |
| MCP backend without `tool` field → ZodError | Error message mentions `"tool"` and `"mcp"` |
| `hooks: []` → ZodError | Error message mentions `"hooks"` minimum constraint |
| `timeout_ms` defaults to 5000 when omitted | Parsed config has `timeout_ms === 5000` |
| `failure_policy` defaults to `"warn"` when omitted | Parsed config has `failure_policy === "warn"` |
| `enabled` defaults to `true` when omitted | Parsed config has `enabled === true` |
| `blocking` defaults to `true` when omitted | Parsed config has `blocking === true` |
| Absent section → `undefined` | `parseRemoteOverlayConfig(undefined)` returns `undefined` |
| Absent section → no behavior change | Engine runs without error when remote config absent |
| Config-to-behavior: `failure_policy: fail_closed` → different runtime behavior | Integration test: a failing remote overlay transitions task to FAILED (not PASS) |
| `validate-config` reports schema errors in existing format | CLI exits non-zero; output includes error details |

---

## H. `src/types/index.ts` — CANCELLED State (modification)

### Responsibility

Adds `CANCELLED` as a terminal task state reachable from all non-terminal states. This is a pure additive change to the type system.

### Changes

```typescript
// Current:
export type TaskStatus =
  | "PENDING" | "RUNNING" | "COMPLETED"
  | "NEEDS_REWORK" | "HIL_PENDING" | "FAILED";

// After modification:
export type TaskStatus =
  | "PENDING" | "RUNNING" | "COMPLETED"
  | "NEEDS_REWORK" | "HIL_PENDING" | "FAILED"
  | "CANCELLED";

// Current:
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING:      ["RUNNING"],
  RUNNING:      ["COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED"],
  COMPLETED:    [],
  NEEDS_REWORK: ["RUNNING", "FAILED"],
  HIL_PENDING:  ["RUNNING", "FAILED"],
  FAILED:       [],
};

// After modification:
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING:      ["RUNNING", "CANCELLED"],
  RUNNING:      ["COMPLETED", "NEEDS_REWORK", "HIL_PENDING", "FAILED", "CANCELLED"],
  COMPLETED:    [],
  NEEDS_REWORK: ["RUNNING", "FAILED", "CANCELLED"],
  HIL_PENDING:  ["RUNNING", "FAILED", "CANCELLED"],
  FAILED:       [],
  CANCELLED:    [],   // terminal — no outgoing transitions
};
```

### StateManager Cascading Changes

`src/core/state-manager.ts` requires a minor change: `isTerminal()` must include `CANCELLED`:

```typescript
// Current:
isTerminal(): boolean {
  return Object.values(this.state.tasks).every(
    (s) => s.status === "COMPLETED" || s.status === "FAILED",
  );
}

// After modification:
isTerminal(): boolean {
  return Object.values(this.state.tasks).every(
    (s) => s.status === "COMPLETED" || s.status === "FAILED" || s.status === "CANCELLED",
  );
}
```

Similarly, `completed_at` should be set when transitioning to `CANCELLED` (analogous to FAILED):

```typescript
// In transition():
completed_at: (newStatus === "COMPLETED" || newStatus === "FAILED" || newStatus === "CANCELLED")
  ? now
  : current.completed_at,
```

### CLI Status Display

`src/cli/commands/status.ts` must display CANCELLED tasks distinctly from FAILED. The status display must not omit CANCELLED or group it with FAILED. Implementation: add `CANCELLED` to the display list with a distinct visual marker (e.g., `[CANCELLED]` vs `[FAILED]`).

### Dependencies

This change is self-contained within `src/types/index.ts` and `src/core/state-manager.ts`. No imports change.

### Implementation Notes

- The VALID_TRANSITIONS change is purely additive. Existing state machine tests continue to pass because the new transitions are additions, not replacements.
- The engine does not directly trigger CANCELLED transitions in Phase 2 — CANCELLED is initially reachable only via direct `stateManager.transition(taskId, "CANCELLED")` calls. Engine verdict mapping to CANCELLED (for a future SKIP verdict) is deferred to a future phase.
- Every switch statement over `TaskStatus` in the codebase must be audited after this change. Run `bun run typecheck` to catch unhandled cases. Known locations to audit: `status` command display logic, any `switch (task.status)` in engine or adapters.

### Tests Required

**File**: `tests/state-manager.test.ts` (extend existing file)

| Test case | Assertion |
|-----------|-----------|
| `PENDING → CANCELLED` succeeds | `stateManager.getTaskState(id).status === "CANCELLED"` |
| `RUNNING → CANCELLED` succeeds | Transition succeeds, state file updated atomically |
| `NEEDS_REWORK → CANCELLED` succeeds | Transition succeeds |
| `HIL_PENDING → CANCELLED` succeeds | Transition succeeds |
| `CANCELLED → RUNNING` → `StateError` | Error message identifies `CANCELLED` as terminal |
| `CANCELLED → FAILED` → `StateError` | Same as above |
| `CANCELLED → COMPLETED` → `StateError` | Same as above |
| `COMPLETED → CANCELLED` → `StateError` | COMPLETED is also terminal |
| `FAILED → CANCELLED` → `StateError` | FAILED is also terminal |
| `isTerminal()` returns true when task is CANCELLED | Previously terminal only for COMPLETED/FAILED |
| `completed_at` is set on CANCELLED transition | Field populated with ISO timestamp |
| State file persisted atomically after CANCELLED transition | File exists and is readable immediately after transition |

**File**: `tests/cli/status-cancelled.test.ts` (new)

| Test case | Assertion |
|-----------|-----------|
| `ai-sdd status` shows CANCELLED tasks | Output includes task ID and `CANCELLED` label |
| CANCELLED is visually distinct from FAILED | Output format differs between the two statuses |

---

## I. `src/core/engine.ts` — Engine Verdict Mapping (modification)

### Responsibility

Replace direct `runPreTaskChain` / `runPostTaskChain` calls with `runPreProviderChain` / `runPostProviderChain`. Add exhaustive verdict-to-state mapping. Preserve all existing behavior for local overlays.

### Constructor Change

```typescript
// Current:
constructor(
  ...
  private readonly overlayChain: OverlayChain = [],
)

// After:
constructor(
  ...
  private readonly providerChain: OverlayProvider[] = [],
)
```

The engine now accepts `OverlayProvider[]` instead of `OverlayChain` (`BaseOverlay[]`). The caller (CLI run command) switches from `buildOverlayChain` to `buildProviderChain`. The old `buildOverlayChain` remains exported from `composition-rules.ts` for backward compat.

### Pre-Task Chain Replacement

```typescript
// REMOVE:
import { runPreTaskChain, runPostTaskChain } from "../overlays/base-overlay.ts";

// ADD:
import { runPreProviderChain, runPostProviderChain } from "../overlays/provider-chain.ts";
import type { OverlayProvider, OverlayDecision, OverlayVerdict } from "../types/overlay-protocol.ts";

// REMOVE overlayChain field; ADD providerChain field
```

### Verdict Mapping Switch

This is the exhaustive switch that maps `OverlayVerdict → TaskStatus transition`. It replaces the current `if (!preResult.proceed)` logic:

```typescript
private async applyPreDecision(
  taskId: string,
  decision: OverlayDecision,
  iteration: number,
): Promise<"CONTINUE" | "NEEDS_REWORK" | "FAILED" | "HIL_AWAITING"> {
  const verdict: OverlayVerdict = decision.verdict;

  // Exhaustive switch — TypeScript will fail to compile if OverlayVerdict
  // gains a new value without a corresponding case here.
  switch (verdict) {
    case "PASS":
      return "CONTINUE";

    case "REWORK":
      this.stateManager.transition(taskId, "NEEDS_REWORK", {
        rework_feedback: decision.feedback ?? "Pre-task overlay requested rework",
        ...(decision.evidence && { error: JSON.stringify(decision.evidence) }),
      });
      this.emitter.emit("task.rework", {
        task_id: taskId,
        iteration,
        feedback: decision.feedback ?? "",
      });
      // Immediately re-arm to RUNNING for the next iteration (matching existing behavior)
      this.stateManager.transition(taskId, "RUNNING");
      return "NEEDS_REWORK";

    case "FAIL":
      this.stateManager.transition(taskId, "FAILED", {
        error: decision.feedback ?? "Pre-task overlay returned FAIL",
        ...(decision.evidence && { error: `${decision.feedback ?? "FAIL"}: ${JSON.stringify(decision.evidence)}` }),
      });
      this.emitter.emit("task.failed", {
        task_id: taskId,
        error: decision.feedback ?? "Pre-task overlay returned FAIL",
      });
      return "FAILED";

    case "HIL":
      // Transition to HIL_PENDING, enqueue HIL item, await resolution
      const hilId = (decision.evidence?.data?.["hil_id"] as string | undefined);
      this.stateManager.transition(taskId, "HIL_PENDING", {
        ...(hilId !== undefined && { hil_item_id: hilId }),
      });
      this.emitter.emit("task.hil_pending", {
        task_id: taskId,
        hil_id: hilId,
        feedback: decision.feedback,
      });
      return "HIL_AWAITING";

    default: {
      // This branch is unreachable if OverlayVerdict is exhaustive.
      // The 'never' cast ensures TypeScript compilation fails if a new verdict is added.
      const _exhaustive: never = verdict;
      throw new Error(`Unhandled OverlayVerdict: ${String(_exhaustive)}`);
    }
  }
}
```

### Evidence Persistence

When the pre or post provider chain returns a non-PASS decision with evidence, the evidence must be written to the task state record. The `TaskState` interface in `src/types/index.ts` needs an optional `overlay_evidence` field:

```typescript
// Add to TaskState in src/types/index.ts:
overlay_evidence?: import("./overlay-protocol.ts").OverlayEvidence;
```

The `stateManager.transition()` call includes `overlay_evidence: decision.evidence` when evidence is present.

### Updated Context Guard

Applied within `runTaskIteration` after receiving the pre-chain result. The guard is already implemented in `provider-chain.ts` `mergeContextUpdate` (Component D). The engine does not need a separate guard because the chain runner strips identity fields before returning the accumulated context. The engine simply uses the `OverlayContext` returned by the chain runner as-is for the agent dispatch context.

### HIL Overlay Lookup Change

The existing code finds the HIL overlay by name: `this.overlayChain.find((o) => o.name === "hil")`. After refactoring:

```typescript
// Find HIL provider in the new chain:
const hilProvider = this.providerChain.find(
  (p) => p.id === "hil" && p.runtime === "local"
) as (LocalOverlayProvider | undefined);
const hilOverlay = hilProvider?.inner;
```

This preserves the `awaitResolution` delegation pattern.

### No Change to Post-Chain Logic Structure

The post-chain follows the same verdict-mapping logic (separate method `applyPostDecision`). The mapping is identical except PASS maps to COMPLETED (via the existing path), not CONTINUE.

### Dependencies to Add to engine.ts

```typescript
import { runPreProviderChain, runPostProviderChain } from "../overlays/provider-chain.ts";
import type { OverlayProvider, OverlayDecision, OverlayVerdict } from "../types/overlay-protocol.ts";
import type { LocalOverlayProvider } from "../overlays/local-overlay-provider.ts";
```

### Tests Required

**File**: `tests/engine.test.ts` (extend existing file)

| Test case | Assertion |
|-----------|-----------|
| Pre-chain PASS → agent dispatch proceeds | Adapter's `dispatchWithRetry` is called |
| Pre-chain REWORK → `NEEDS_REWORK` transition | `stateManager.getTaskState().status === "NEEDS_REWORK"` |
| Pre-chain FAIL → `FAILED` transition (terminal) | `stateManager.getTaskState().status === "FAILED"` |
| Pre-chain HIL → `HIL_PENDING` transition | `stateManager.getTaskState().status === "HIL_PENDING"` |
| Post-chain PASS → COMPLETED | Task reaches COMPLETED |
| Post-chain REWORK → NEEDS_REWORK + re-iteration | Engine iterates again |
| Post-chain FAIL → FAILED (terminal) | Task does not iterate further |
| Evidence from decision written to task state | `task.overlay_evidence` matches decision.evidence |
| Remote `updated_context.task_id` not applied | Engine state record `task_id` unchanged |
| Remote `updated_context.status` not applied | Engine state record `status` unchanged |
| Engine wired to use `providerChain` (integration) | `LocalOverlayProvider.invokePre` called when engine runs (not `BaseOverlay.preTask` directly) |
| All 177 existing tests pass unchanged | Regression gate |

---

## J. `src/observability/events.ts` — New Event Types (modification)

### Responsibility

Adds Zod schemas and type exports for the six remote overlay lifecycle events. Follows the existing pattern in `events.ts` exactly.

### Changes

```typescript
// Add these six event schemas to src/observability/events.ts:

export const OverlayRemoteConnectingEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.connecting"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    task_id: z.string(),
    workflow_id: z.string(),
    run_id: z.string(),
  }).passthrough(),
});

export const OverlayRemoteConnectedEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.connected"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    task_id: z.string(),
    duration_ms: z.number(),
  }).passthrough(),
});

export const OverlayRemoteInvokedEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.invoked"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
  }).passthrough(),
});

export const OverlayRemoteDecisionEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.decision"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
    verdict: z.enum(["PASS", "REWORK", "FAIL", "HIL"]),
    duration_ms: z.number(),
  }).passthrough(),
});

export const OverlayRemoteFailedEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.failed"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
    failure_tier: z.enum(["transport", "schema"]),
    error_message: z.string(),
    duration_ms: z.number(),
  }).passthrough(),
});

export const OverlayRemoteFallbackEvent = BaseEventSchema.extend({
  type: z.literal("overlay.remote.fallback"),
  data: z.object({
    overlay_name: z.string(),
    backend_id: z.string(),
    hook: z.enum(["pre_task", "post_task"]),
    task_id: z.string(),
    failure_policy: z.enum(["skip", "warn"]),
  }).passthrough(),
});
```

Also update `EventType` in `src/types/index.ts`:

```typescript
export type EventType =
  // ... existing values ...
  | "overlay.remote.connecting"
  | "overlay.remote.connected"
  | "overlay.remote.invoked"
  | "overlay.remote.decision"
  | "overlay.remote.failed"
  | "overlay.remote.fallback";
```

### Implementation Notes

- All six schemas follow the `.passthrough()` pattern used by existing event schemas — additional fields are allowed for forward compatibility.
- `ObservabilityEmitter.emit()` already applies `sanitizer.sanitizeObject(data)` to all payloads. No per-event sanitization needed.
- `getEventLevel()` in `emitter.ts` maps `overlay.remote.failed` to `"ERROR"` (because it includes "failed") and `overlay.remote.fallback` to `"WARN"` (because it includes... nothing matching). Audit `getEventLevel` logic to ensure `overlay.remote.failed` maps to ERROR and `overlay.remote.fallback` maps to WARN. Add explicit pattern if needed.

### Tests Required

**File**: `tests/observability/remote-overlay-events.test.ts` (new)

| Test case | Assertion |
|-----------|-----------|
| `OverlayRemoteConnectingEvent` schema validates correct payload | `safeParse` returns success |
| `OverlayRemoteFailedEvent` schema validates both `failure_tier` values | Both `"transport"` and `"schema"` accepted |
| `OverlayRemoteFallbackEvent` rejects `failure_policy: "fail_closed"` | `fail_closed` is not a valid fallback policy |
| Secret in data is redacted by emitter | Emitted event payload contains `[REDACTED:...]` |
| `overlay.remote.failed` event level is ERROR | `getEventLevel("overlay.remote.failed")` returns `"ERROR"` |
| `overlay.remote.decision` event level is INFO | `getEventLevel("overlay.remote.decision")` returns `"INFO"` |

---

## K. `src/overlays/composition-rules.ts` — Extension (modification)

### Responsibility

Add an overload of `validateOverlayCombination` that accepts `OverlayProvider[]` (new chain type) in addition to the existing `BaseOverlay[]` signature. Add the new invariant that remote overlays must not appear after `policy_gate`.

### Changes

```typescript
// Add new overload:
export function validateProviderCombination(
  providers: OverlayProvider[],
): CompositionValidationResult;
```

The new function checks:

1. Existing Invariant 1: HIL (runtime `local`, id `hil`) must be first when present.
2. Existing Invariant 5: Paired and Review mutually exclusive (both local providers with those IDs).
3. New Invariant 6: No remote provider appears after any local provider with id `policy_gate`.

```typescript
// New invariant 6:
const policyGateIdx = providers.findIndex((p) => p.id === "policy_gate" && p.runtime === "local");
const lastRemoteIdx = providers.reduce((max, p, i) =>
  p.runtime !== "local" ? i : max, -1
);
if (policyGateIdx >= 0 && lastRemoteIdx > policyGateIdx) {
  errors.push(
    "Invariant 6 violated: remote overlays must not appear after policy_gate in the chain. " +
    `Remote provider at index ${lastRemoteIdx} is after policy_gate at index ${policyGateIdx}.`
  );
}
```

The existing `validateOverlayCombination(overlays: BaseOverlay[])` is not modified. The registry calls `validateProviderCombination` on the built chain after construction.

### Tests Required

**File**: `tests/overlays/composition-matrix.test.ts` (extend existing)

| Test case | Assertion |
|-----------|-----------|
| Valid chain (HIL → remote → policy_gate → confidence) passes | `valid: true` |
| Remote after policy_gate → Invariant 6 error | `errors` includes Invariant 6 message |
| HIL not first → Invariant 1 error (same as existing) | Existing test still passes |
| Paired + Review enabled → Invariant 5 error (same as existing) | Existing test still passes |

---

## L. `src/types/index.ts` — TaskDefinition Extensions (modification)

### Responsibility

Add optional fields to `TaskDefinition` so remote overlays have structured data to check. All fields are optional — zero breaking changes.

### Changes

```typescript
// Add to TaskDefinition interface:
export interface TaskDefinition {
  // ... existing fields ...

  /** Phase of the task in the development lifecycle. */
  phase?: "planning" | "design" | "implementation" | "review";

  /** Requirement IDs this task satisfies. Used by remote governance overlays. */
  requirement_ids?: string[];

  /** Acceptance criteria in Gherkin-style structure. */
  acceptance_criteria?: Array<{
    scenario: string;
    given: string | string[];
    when: string;
    then: string[];
  }>;

  /** Explicitly excluded scope items. */
  scope_excluded?: string[];

  /** Budget constraints for the task. */
  budget?: {
    max_new_files?: number;
    max_loc_delta?: number;
    max_new_public_apis?: number;
  };
}
```

Also add `GatedHandoverState` interface (for coding-standards integration):

```typescript
export interface GatedHandoverState {
  requirements_lock_path?: string;
  spec_hash?: string;
  traceability_report?: Record<string, unknown>;
}
```

### Implementation Notes

- All fields are optional. Existing YAML task definitions without these fields parse identically to before.
- `phase` uses a string union (not `string`) to constrain valid values at the TypeScript level. The registry uses `provider.phases` filtering against this field.
- `acceptance_criteria` uses an inline type rather than a separate exported interface to keep the definition close to its usage. If it grows, extract to a named interface.
- Workflow YAML parsing (`workflow-loader.ts`) already uses `[key: string]: unknown` on `TaskDefinition`, so these new fields will parse through without additional changes to the YAML loader.

### Tests Required

**File**: `tests/workflow-loader.test.ts` (extend existing)

| Test case | Assertion |
|-----------|-----------|
| Task with `phase: "implementation"` parses correctly | `taskDef.phase === "implementation"` |
| Task without `phase` parses with `phase === undefined` | Existing tasks unaffected |
| Task with `requirement_ids` parses correctly | Array of strings populated |
| Task with `acceptance_criteria` parses correctly | Nested structure preserved |
| Task without new fields: zero behavioral change | All 177 existing tests continue to pass |

---

## Error Handling Strategy

### Error Class Hierarchy

```
Error
├── StateError                      (existing — src/core/state-manager.ts)
├── RegistryError                   (new — src/overlays/registry.ts)
│     "RegistryError: remote_overlays['x'] references unknown backend 'y'"
│     "RegistryError: Invariant 5/6 violated: ..."
├── McpTimeoutError                 (new — src/overlays/mcp/mcp-client.ts)
│     "MCP tool call 'overlay.invoke' timed out after 5000ms. Increase timeout_ms..."
├── McpNotConnectedError            (new — src/overlays/mcp/mcp-client.ts)
│     "McpClientWrapper for backend 'x' is not connected. Call connect() first."
└── McpSchemaError                  (new — src/overlays/mcp/mcp-client.ts)
      "McpSchemaError: ..."
```

### Error Propagation Rules

| Error source | Caught by | Outcome |
|-------------|-----------|---------|
| `McpTimeoutError` | `McpOverlayProvider.invoke()` | Tier 1 handler → apply `failure_policy` |
| `McpNotConnectedError` | `McpOverlayProvider.invoke()` | Programming error — re-throw as `RegistryError` at build time |
| `McpSchemaError` (via Zod) | `McpOverlayProvider.invoke()` | Tier 2 handler → always FAIL |
| Any unhandled Error in any provider | `runPreProviderChain` catch | FAIL decision with error message |
| `RegistryError` (build time) | Engine startup / CLI run command | Hard error — exit non-zero |
| `StateError` (invalid transition) | Engine / CLI | Hard error with transition details |

### Observability-Level Classification

`ObservabilityEmitter.getEventLevel()` pattern matching:
- `"overlay.remote.failed"` → ERROR (existing `type.includes("failed")` rule covers this)
- `"overlay.remote.fallback"` → INFO (treated as a normal operational event; promote to WARN at implementation time if operators prefer)
- `"overlay.remote.connecting"` / `"overlay.remote.connected"` / `"overlay.remote.invoked"` / `"overlay.remote.decision"` → INFO

---

## Performance Design

### Per-Component Overhead Budget

| Component | Budget | Measurement point |
|-----------|--------|------------------|
| `buildProviderChain` (registry build) | < 50ms | Engine constructor |
| `runPreProviderChain` with 5 local providers | < 5ms over baseline | Phase filter + LocalOverlayProvider dispatch |
| Phase filter decision (per provider) | < 1ms | No I/O for filtered providers |
| `McpClientWrapper.callTool` (timeout) | `timeout_ms ± 50ms` | Rejection timing |

### Connection Lifecycle

`McpOverlayProvider` creates a new `McpClientWrapper` per invocation (connect → call → disconnect). This is the correct tradeoff for Phase 4: correct lifecycle management over connection reuse. Connection pooling can be added in a future phase if profiling shows it is necessary.

### Phase Filtering Fast Path

The phase check in `runPreProviderChain` is a simple `Array.includes()` call. When the provider has no `phases` filter (`phases === undefined`), the check is skipped entirely (the provider always runs). When the task has no `phase` (`task_definition.phase === undefined`) and the provider has a `phases` filter, the provider is skipped (conservative).

---

## Security Design

### No-Mutation Invariant Enforcement Points

1. `OverlayInvokeOutputSchema` — Zod enum blocks unknown verdicts at the wire boundary.
2. `runPreProviderChain` `mergeContextUpdate` — strips identity fields from `updated_context`.
3. `engine.ts` `applyPreDecision` — verdict mapping is the only place state transitions are triggered; providers cannot call `stateManager.transition()` directly (no reference to `stateManager` outside engine).
4. No file-write calls in `src/overlays/` — enforced by code review and CI static check.

### CI Static Checks (to add)

```bash
# No eval() in provider or config code:
grep -rn "eval(" src/overlays/ src/config/remote-overlay-schema.ts
# Must produce no output.

# No direct stateManager/state file writes in providers:
grep -rn "writeFileSync\|renameSync\|stateManager" src/overlays/
# Must produce no output.
```

---

## Backward Compatibility Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| 177 existing tests pass unchanged | `LocalOverlayProvider` wraps existing `BaseOverlay` with identity mapping; `runPreTaskChain`/`runPostTaskChain` not deleted |
| Existing config without remote sections loads without error | `RemoteOverlaysSectionSchema.optional()` + `parseRemoteOverlayConfig` returns `undefined` |
| `buildOverlayChain` in composition-rules.ts still exported | Not deleted; existing callers unaffected |
| `OverlayContext` in `base-overlay.ts` still exported | Not deleted; existing overlay implementations import from there |
| `TaskStatus` VALID_TRANSITIONS additions are purely additive | No existing transition removed; existing tests assert allowed transitions remain |

---

## Technical Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| MCP SDK `CallToolResult` response envelope changes between patch versions | Low | High | External schema fixture test captures real SDK response; test fails on envelope change |
| `LocalOverlayProvider` mapping introduces subtle behavioral difference from direct invocation | Medium | High | Equivalence test: direct invocation vs wrapped invocation produce identical verdicts for all existing overlays |
| `OverlayVerdict` exhaustiveness check missed in a switch not covered by TypeScript (e.g., runtime string comparison) | Low | Medium | All verdict comparisons must use typed values from `OverlayVerdict`; `grep "verdict ==="` in CI to find untyped comparisons |
| Engine `applyPreDecision` default branch (unreachable) actually reached due to test double returning bad verdict | Low | Low | `never` cast causes compile-time error; runtime throws clear message |
| Phase filtering on `task_definition.phase: undefined` silently skips remote governance | Medium | Medium | Documented as intentional conservative behavior; configurable per-overlay via `phases: undefined` (no filter) |
| `McpClientWrapper` does not clean up subprocess on timeout | Medium | Medium | `disconnect()` in finally block sends SIGTERM; SDK cleanup behavior verified in integration test |
| Concurrent CANCELLED transition while remote overlay awaits response | Low | Medium | `stateManager.transition` is synchronous + atomic (tmp+rename); concurrent calls are serialized by the OS; test verifies no intermediate state |

---

## Open Questions (require decision before implementation)

1. **MCP SDK `CallToolResult` unwrapping**: Inspect `@modelcontextprotocol/sdk@1.0.4` type definitions for `CallToolResult.content` to determine the exact JSON extraction path. The implementation must capture a real fixture. This cannot be resolved from type definitions alone — a quick test against the installed SDK is needed.

2. **`governance` block in `ProjectConfig`**: Adding `governance?: { requirements_lock?: string }` to `src/types/index.ts#ProjectConfig` is the cleanest approach but changes the type used by 177 existing tests. Alternative: keep it fully separate in `ResolvedOverlayConfig`. Recommendation: add it to `ProjectConfig` as optional — existing tests pass `{}` which is still valid.

3. **`CliOverlayProvider` scope in Phase 3**: The L1 architecture includes a `CliOverlayProvider` for non-MCP backends. Its design follows the same pattern as `McpOverlayProvider` but uses `Bun.spawn()` instead of MCP SDK. This document does not detail it because Phase 3 is after Phase 4 in delivery order per L1. The design for `CliOverlayProvider` should be a separate L2 addendum or included when Phase 3 is scheduled.

4. **Evidence field on `TaskState`**: Adding `overlay_evidence` to `TaskState` interface is additive but changes the persisted JSON schema. The schema version is currently `"1"`. This field is optional, so old state files (without the field) remain valid. No migration is required. Confirm this interpretation before implementation.
