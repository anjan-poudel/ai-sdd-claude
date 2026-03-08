# Requirements — Remote Overlay Abstraction

## Summary

- **Functional requirements**: 9 (all MUST)
- **Non-functional requirements**: 4 (all MUST)
- **Areas covered**: Overlay Abstraction, MCP Transport, Overlay Orchestration, Configuration, Task State Machine, Workflow Engine, Reliability / Error Handling, Observability, Performance, Security, Compatibility

---

## Overview

The Remote Overlay Abstraction introduces a transport-agnostic `OverlayProvider` interface so
the workflow engine can consume governance decisions from both local in-process overlays and
remote MCP servers without knowing which transport is in use. The primary use case is running a
coding-standards governance server as a remote MCP overlay that enforces requirements-first
development practices (traceability, scope drift, spec hash, AC coverage) without merging it
into ai-sdd.

---

## Open Decisions

1. **CLI sidecar transport**: `CliOverlayProvider` is out of scope for this release. The config schema accepts `runtime: "cli"` but the registry throws an unsupported-runtime error if it is used.
2. **SKIP verdict**: Not introduced in this release. `CANCELLED` is a new terminal `TaskStatus`; a SKIP `OverlayVerdict` is future work.
3. **`governance_mode: enforce` promotion**: Config schema must accommodate it without breaking changes; behavior is `"warn"` only in this release.
4. **SSE/HTTP transport**: Out of scope; stdio only.
5. **Post-task HIL from remote overlays**: Conservatively treated as `REWORK` pending a dedicated design pass.

## Out of Scope

- Merging coding-standards' 15-state workflow machine into ai-sdd
- Running coding-standards' graph/lock tools directly from the engine
- Remote overlays writing artifacts or mutating ai-sdd state
- `CliOverlayProvider` concrete implementation
- The `overlay.invoke` facade on the coding-standards server (tracked there)
- SSE and HTTP MCP transport modes
- `governance_mode: enforce` behavior

---

## FR-001: Overlay Provider Interface and Provider Types

**Area**: Overlay Abstraction | **Priority**: MUST

The system must define a transport-agnostic `OverlayProvider` interface as the single contract
satisfied by all overlay implementations. The interface must carry: `id`, `runtime`
(`"local" | "cli" | "mcp"`), `hooks` (`"pre_task" | "post_task"` or both), `enabled`,
optional `phases`, and optional `invokePre`/`invokePost` methods.

Two concrete implementations must exist:
- **`LocalOverlayProvider`** wraps existing `BaseOverlay` instances with zero behavioral change. It must expose `inner: BaseOverlay` for the HIL overlay's `awaitResolution` access. Construction must throw `TypeError` if the wrapped overlay implements no hook methods.
- **`McpOverlayProvider`** delegates all invocations to `McpClientWrapper`. It must not contain direct MCP SDK calls. It must accept an injectable client factory for testability.

All interface types must live in `src/types/overlay-protocol.ts`.

```gherkin
Feature: OverlayProvider interface and provider types

  Scenario: LocalOverlayProvider wraps BaseOverlay correctly
    Given a BaseOverlay with preTask and postTask
    When wrapped in LocalOverlayProvider
    Then provider.id, runtime ("local"), hooks, enabled, and inner all reflect the wrapped overlay

  Scenario: LocalOverlayProvider with no hooks fails at construction
    Given a BaseOverlay with neither preTask nor postTask
    When wrapped in LocalOverlayProvider
    Then construction throws TypeError naming the overlay and requiring at least one hook

  Scenario: McpOverlayProvider satisfies OverlayProvider without SDK leakage
    Given valid ResolvedRemoteOverlayConfig and ResolvedBackendConfig (runtime "mcp")
    When McpOverlayProvider is constructed
    Then id, runtime ("mcp"), hooks, and enabled reflect config values
    And no MCP SDK types appear in the public API

  Scenario: OverlayRuntime exhaustiveness check enforced at compile time
    Given the OverlayRuntime union "local" | "cli" | "mcp"
    When a switch has no default branch
    Then TypeScript compilation fails for any unhandled member
```

---

## FR-002: OverlayDecision Normalized Verdict Contract

**Area**: Overlay Abstraction | **Priority**: MUST

`OverlayDecision` is the single normalized return type from every provider. `OverlayVerdict` is
the string union `"PASS" | "REWORK" | "FAIL" | "HIL"` — exactly four values.

MCP wire responses must be validated with `OverlayInvokeOutputSchema` (Zod, `z.literal("1")` for
`protocol_version`, `z.enum([...])` for verdict) before conversion to `OverlayDecision`. Any
failure — unknown verdict, missing field, wrong protocol version, invalid JSON — is a Tier 2
schema violation (always fail_closed, regardless of `failure_policy`).

`LocalOverlayProvider` mapping rules: `proceed:true` → `PASS`; `proceed:false, hil_trigger:true`
→ `HIL`; `proceed:false` → `REWORK`; `accept:true` → `PASS`; `accept:false, new_status:FAILED`
→ `FAIL`; `accept:false, new_status:COMPLETED` → throws `TypeError`; `accept:false` other → `REWORK`.

```gherkin
Feature: Normalized OverlayDecision contract

  Scenario: Valid MCP response with REWORK verdict maps correctly
    Given MCP response with protocol_version "1" and verdict "REWORK"
    When McpOverlayProvider processes it
    Then OverlayDecision has verdict "REWORK" and evidence.source "mcp"

  Scenario: Unknown verdict "FORCE_ACCEPT" is rejected as schema violation
    Given MCP response with verdict "FORCE_ACCEPT"
    When Zod validates
    Then it fails and engine receives verdict "FAIL"

  Scenario: accept:false with new_status:COMPLETED throws
    Given BaseOverlay postTask returning accept false with new_status "COMPLETED"
    When LocalOverlayProvider.invokePost processes it
    Then TypeError is thrown naming the overlay
```

---

## FR-003: McpClientWrapper and MCP Overlay Protocol

**Area**: MCP Transport | **Priority**: MUST

`McpClientWrapper` (`src/overlays/mcp/mcp-client.ts`) encapsulates the full connection
lifecycle for one MCP backend. Public API: `connect()`, `disconnect()`, `callTool(name, input)`.

Requirements:
- Validate `transport === "stdio"` at construction time (not deferred). SSE throws `TypeError`.
- Enforce `timeout_ms` per call via `Promise.race`. Timeout rejects with `McpTimeoutError(toolName, timeoutMs)`.
- Calling `callTool` before `connect()` throws `McpNotConnectedError(backendId)`.
- `disconnect()` is a no-op when not connected.
- Unwrap the SDK `{ content: [{type, text/data}] }` envelope before returning.
- Per-invocation lifecycle: connect → callTool → disconnect (fresh per call; not shared across invocations).

Three named error classes: `McpTimeoutError`, `McpNotConnectedError`, `McpSchemaError`.

```gherkin
Feature: McpClientWrapper lifecycle

  Scenario: callTool before connect throws McpNotConnectedError
    Given an unconnected McpClientWrapper
    When callTool is called
    Then McpNotConnectedError is thrown with the backend id and instructions to connect

  Scenario: Timeout rejects with McpTimeoutError within tolerance
    Given timeout_ms 100 and a server that never responds
    When callTool is called
    Then McpTimeoutError is thrown within 150 ms

  Scenario: SSE transport rejected at construction
    Given OverlayBackendConfig with transport "sse"
    When McpClientWrapper is constructed
    Then TypeError names "sse" as unsupported and states only "stdio" is supported
```

---

## FR-004: Provider Chain Construction and Composition Rules

**Area**: Overlay Orchestration | **Priority**: MUST

`buildProviderChain(input: RegistryInput): OverlayProvider[]` assembles the chain in locked
order:

```
HIL (local) → Remote overlays (config insertion order) → Policy Gate (local) → Review OR Paired (local) → Confidence (local)
```

Remote overlays must not appear after Policy Gate — violation throws `RegistryError` (Invariant 6).
An unknown backend reference throws `RegistryError`. Review + Paired both enabled throws `RegistryError`
(Invariant 5). `McpOverlayProvider` construction requires an `ObservabilityEmitter`.

`runPreProviderChain` / `runPostProviderChain` rules: skip disabled providers; skip providers
whose hooks do not include the relevant hook; skip providers with phase mismatch; catch
unhandled exceptions and convert to `{ verdict: "FAIL" }`; short-circuit on first non-PASS;
apply `mergeContextUpdate` (strips identity fields) on PASS with `updated_context`.

```gherkin
Feature: Provider chain construction

  Scenario: Chain is built in locked order
    Given HIL, one remote overlay, and policy_gate enabled
    When buildProviderChain runs
    Then order is HIL → remote → policy_gate

  Scenario: Unknown backend throws RegistryError at build time
    Given remote_overlays entry with backend "missing"
    When buildProviderChain runs
    Then RegistryError names the missing backend

  Scenario: First non-PASS short-circuits
    Given chain of three providers where second returns REWORK
    When runPreProviderChain runs
    Then result is REWORK and third provider is never called

  Scenario: Provider exception converts to FAIL verdict
    Given a provider whose invokePre throws
    When runPreProviderChain processes it
    Then OverlayDecision verdict is "FAIL" with the error in feedback
    And no exception propagates
```

---

## FR-005: Configuration Schema for Overlay Backends and Remote Overlays

**Area**: Configuration | **Priority**: MUST

Two new optional sections in `.ai-sdd/ai-sdd.yaml`, parsed via `parseRemoteOverlayConfig`:

**`overlay_backends`**: map of backend ID to `{ runtime: "cli"|"mcp", command: string[].min(1), tool?: string (required for mcp), transport: "stdio" (default), timeout_ms: number (default 5000), failure_policy: "skip"|"warn"|"fail_closed" (default "warn"), env?: Record<string, string> }`.

**`remote_overlays`**: map of name to `{ backend: string, enabled: boolean (default true), hooks: OverlayHook[].min(1), phases?: string[], blocking: boolean (default true), config?: Record<string, unknown> }`.

**`governance`**: optional `{ requirements_lock: "off"|"warn"|"enforce" (default "warn") }`.

All three are optional. Absence returns `undefined` from `parseRemoteOverlayConfig` with zero
errors or warnings. The `ai-sdd validate-config` command must surface validation errors in the
same format as existing config errors.

```gherkin
Feature: Config schema validation

  Scenario: MCP backend without tool field is rejected
    Given backend with runtime "mcp" and no tool field
    When parseRemoteOverlayConfig parses it
    Then ZodError states tool is required for mcp

  Scenario: Empty hooks array is rejected
    Given remote_overlays entry with hooks []
    When parsed
    Then ZodError states at least one hook required

  Scenario: Absent section returns undefined without errors
    Given config with no overlay_backends or remote_overlays
    When parseRemoteOverlayConfig is called
    Then it returns undefined with no errors
```

---

## FR-006: CANCELLED Task State Addition to VALID_TRANSITIONS

**Area**: Task State Machine | **Priority**: MUST

`TaskStatus` must add `"CANCELLED"`. `VALID_TRANSITIONS` must allow `CANCELLED` as a target
from `PENDING`, `RUNNING`, `NEEDS_REWORK`, and `HIL_PENDING`. `CANCELLED` must have no
outgoing transitions (terminal). `COMPLETED` and `FAILED` must not gain `CANCELLED` as a
target (they are already terminal).

State writes must use the existing tmp+rename atomic pattern. `ai-sdd status` must display
`CANCELLED` distinctly from `FAILED`. Tasks downstream of a `CANCELLED` task are skipped
(same behavior as downstream of `FAILED`).

```gherkin
Feature: CANCELLED task state

  Scenario: Transition from each non-terminal state to CANCELLED succeeds
    Given a task in PENDING, RUNNING, NEEDS_REWORK, or HIL_PENDING state
    When transitioned to CANCELLED
    Then the transition succeeds and state file shows CANCELLED

  Scenario: CANCELLED is terminal
    Given a task in CANCELLED state
    When any transition is attempted
    Then StateError is thrown

  Scenario: COMPLETED and FAILED cannot be cancelled
    Given a task in COMPLETED or FAILED state
    When transition to CANCELLED is attempted
    Then StateError is thrown
```

---

## FR-007: Engine Verdict Mapping

**Area**: Workflow Engine | **Priority**: MUST

The engine is the single enforcement point. Verdict-to-transition mapping:

Pre-task: `PASS` → continue; `REWORK` → `NEEDS_REWORK` → `RUNNING` (emit `task.rework`);
`FAIL` → `FAILED` (emit `task.failed`); `HIL` → `HIL_PENDING` (emit `task.hil_pending`).

Post-task: `PASS` → `COMPLETED`; `REWORK` → `NEEDS_REWORK` → `RUNNING`; `FAIL` → `FAILED`;
`HIL` → treated as `REWORK` (conservative — post-task HIL not fully specified).

Both `applyPreDecision` and `applyPostDecision` must use exhaustive switch statements with a
`never` assertion in the default branch. Evidence from `OverlayDecision` must be written to
`TaskState.overlay_evidence`. Identity fields in `updated_context` must be stripped via
`mergeContextUpdate` before application.

On `--resume`, if a task is already `HIL_PENDING`, the engine must skip the pre-overlay chain
and call `awaitResolution` directly with the stored `hil_item_id`.

```gherkin
Feature: Engine verdict mapping

  Scenario: REWORK verdict cycles the task correctly
    Given task in RUNNING state and REWORK verdict with feedback
    When engine calls applyPreDecision
    Then task goes to NEEDS_REWORK, task.rework event emitted, task re-armed to RUNNING

  Scenario: HIL verdict transitions to HIL_PENDING
    Given task in RUNNING and HIL verdict
    When engine calls applyPreDecision
    Then task goes to HIL_PENDING and engine awaits awaitResolution

  Scenario: New verdict without engine handler is a compile error
    Given OverlayVerdict extended with "ESCALATE"
    When switch statement has no case for ESCALATE
    Then TypeScript compilation fails

  Scenario: HIL resume skips pre-overlay chain
    Given persisted HIL_PENDING task with valid hil_item_id on --resume
    When engine processes that task
    Then pre-overlay chain is not invoked
    And awaitResolution is called with stored hil_item_id
```

---

## FR-008: Remote Failure Handling Modes

**Area**: Reliability / Error Handling | **Priority**: MUST

Two-tier failure model in `McpOverlayProvider`:

**Tier 1 — Transport errors** (connection refused, timeout, process crash): governed by
`failure_policy`. `skip` → return `PASS` silently; `warn` → return `PASS` + emit
`overlay.remote.failed` + `overlay.remote.fallback`; `fail_closed` → return `FAIL`.

**Tier 2 — Schema violations** (Zod validation failure, unrecognized verdict, missing fields,
bad JSON): always return `FAIL` regardless of `failure_policy`.

`blocking: false` overrides Tier 1 failure to always behave as `"warn"` policy; Tier 2
is unaffected. After any error, `disconnect()` is called best-effort (errors swallowed).

```gherkin
Feature: Remote failure handling

  Scenario: Timeout with failure_policy "warn" returns PASS and emits events
    Given backend with timeout_ms 100 and failure_policy "warn" that times out
    When invoked
    Then verdict is PASS, overlay.remote.failed emitted (tier "transport"), overlay.remote.fallback emitted

  Scenario: Schema violation returns FAIL despite failure_policy "skip"
    Given backend with failure_policy "skip" returning invalid Zod response
    When invoked
    Then verdict is FAIL

  Scenario: blocking false overrides fail_closed for transport errors
    Given overlay with blocking false and backend failure_policy "fail_closed" that times out
    When invoked
    Then effective policy is "warn" and verdict is PASS
```

---

## FR-009: Observability Events for Remote Overlay Lifecycle

**Area**: Observability | **Priority**: MUST

Six event types added to `EventType` in `src/types/index.ts`:

| Event | When | Key payload |
|-------|------|-------------|
| `overlay.remote.connecting` | Before connect | overlay_name, backend_id, task_id, workflow_id, run_id |
| `overlay.remote.connected` | After connect | + duration_ms |
| `overlay.remote.invoked` | After callTool sent | + hook |
| `overlay.remote.decision` | After valid response | + verdict, duration_ms |
| `overlay.remote.failed` | On any failure | + failure_tier ("transport"/"schema"), error_message, duration_ms |
| `overlay.remote.fallback` | On skip/warn policy | + failure_policy |

Log levels: `overlay.remote.failed` → ERROR; `overlay.remote.fallback` → WARN; others → INFO.
`duration_ms` measures wall-clock from invocation start. All payloads pass through log sanitizer
before emission — secret-pattern values replaced with `"[REDACTED]"`.

```gherkin
Feature: Remote overlay observability events

  Scenario: Successful invocation emits four events in order
    Given mock MCP server returning PASS
    When invoked for pre_task
    Then events emitted in order: connecting → connected → invoked → decision
    Each includes overlay_name, backend_id, task_id

  Scenario: Transport failure emits failed with tier "transport"
    Given backend that times out
    When invoked
    Then overlay.remote.failed emitted with failure_tier "transport" and duration_ms

  Scenario: Secret in passthrough config is redacted
    Given config passthrough with a value matching the secret pattern
    When any event is emitted
    Then payload shows "[REDACTED]" and literal secret does not appear in any log
```

---

## NFR-001: Performance

**Category**: Performance | **Priority**: MUST

| Metric | Target |
|--------|--------|
| Default timeout | 5000 ms (`timeout_ms` default) |
| Timeout accuracy | Rejects within `timeout_ms + 50 ms` |
| Local chain overhead | Less than 5 ms over baseline (5-provider no-op chain) |
| Phase filter skip | Less than 1 ms per skipped provider |
| Registry build time | Less than 50 ms at startup |

---

## NFR-002: Reliability

**Category**: Reliability | **Priority**: MUST

| Property | Target |
|----------|--------|
| Engine crash rate increase | 0% from remote overlay errors |
| State file consistency | 100% atomic (tmp+rename) |
| Deterministic outcome on remote failure | 100% of failures produce a valid OverlayDecision |
| CANCELLED reachability | 100% from non-terminal states |
| VALID_TRANSITIONS enforcement | 100% of invalid transitions throw StateError |
| Existing test pass rate | 177/177 unmodified after Phase 1 |

---

## NFR-003: Security

**Category**: Security | **Priority**: MUST

| Property | Target |
|----------|--------|
| No provider writes to state files | 0 `writeFile` / `transition()` calls in `src/overlays/` |
| No identity field overwrite via updated_context | 0 paths where task_id, status, workflow_id, run_id are overwritten |
| Zod validation before engine consumption | 100% of remote responses validated |
| Unknown verdict rejection | 0 unrecognized verdicts reach state machine |
| Secret redaction in events | 100% matching patterns → "[REDACTED]" |
| No eval() in new code | 0 instances (static grep) |

---

## NFR-004: Backward Compatibility

**Category**: Compatibility | **Priority**: MUST

| Property | Target |
|----------|--------|
| Existing test suite | 177/177 unmodified tests pass |
| Existing config compatibility | Zero errors on absent new keys |
| LocalOverlayProvider equivalence | 100% identical verdicts, feedback, evidence |
| Protocol version mismatch | Hard error (FAIL); not overrideable by failure_policy |
| MCP SDK dependency | Uses existing `@modelcontextprotocol/sdk`; no new deps |
| TypeScript strict mode | All new files pass `bun run typecheck` |
