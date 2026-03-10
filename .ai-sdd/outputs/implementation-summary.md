# Implementation Summary

## Tasks Implemented

### T001 — Type System Foundation

**Status**: Complete (code was pre-existing; tests were added)

The `src/types/overlay-protocol.ts` file already contained the full implementation:
- `OverlayVerdict` string union (`"PASS" | "REWORK" | "FAIL" | "HIL"`)
- `OverlayDecision`, `OverlayContext`, `OverlayProvider` interfaces
- `OverlayEvidence` interface
- `OverlayInvokeOutputSchema` (Zod v3 schema for MCP wire validation)
- `OverlayInvokeInput` interface

`src/types/index.ts` already contained:
- `overlay_evidence?: OverlayEvidence` field on `TaskState` (line 151)
- All 6 remote overlay event types on `EventType` (lines 305-310)
- `export * from "./overlay-protocol.ts"` re-export at the bottom

**Tests created**: `tests/overlays/overlay-protocol.test.ts` (9 tests)
- Validates all four valid verdict values accepted
- Validates optional `evidence` field absent and present
- Rejects `verdict: "FORCE_ACCEPT"` — `success === false`
- Rejects `protocol_version: "2"` — `success === false`
- Rejects missing `verdict` field
- Rejects empty string
- Rejects null input

### T008 — CANCELLED Task State

**Status**: Complete (code was pre-existing; tests were added)

`src/types/index.ts` already contained:
- `"CANCELLED"` in `TaskStatus` union
- `VALID_TRANSITIONS` with CANCELLED reachable from PENDING, RUNNING, NEEDS_REWORK, HIL_PENDING
- `CANCELLED: []` (no outgoing transitions — terminal)

`src/core/state-manager.ts` already contained:
- `isTerminal()` includes `CANCELLED` as terminal status
- `transition()` sets `completed_at` on CANCELLED transition

`src/cli/commands/status.ts` already contained:
- `CANCELLED: "⊘"` in `STATUS_SYMBOLS` (distinct from `FAILED: "✗"`)
- Summary line includes `⊘ ${cancelled}` count

**Bug fixed**: `src/constitution/resolver.ts` line 37 had `specs/*/constitution.md` in a JSDoc
comment where the `*/` accidentally closed the block comment, causing a Bun parse error that
failed all tests. Fixed by changing to `specs/<feature>/constitution.md`.

**Tests created**:
- `tests/state-manager.test.ts` — extended with 12 CANCELLED state tests in a new `describe("CANCELLED state", ...)` block
- `tests/cli/status-cancelled.test.ts` — new CLI integration test (CLAUDE.md §7)

### T002 — LocalOverlayProvider

**Status**: Complete

**Files:**
- `src/overlays/local-overlay-provider.ts` — source was pre-authored; fixed `exactOptionalPropertyTypes` errors in mapping functions by using conditional assignment instead of object spreads with potentially-undefined values
- `tests/overlays/local-overlay-provider.test.ts` — created (26 tests covering all 13 spec-required cases plus evidence propagation edge cases)

**What was built:**
`LocalOverlayProvider` wraps a `BaseOverlay` in the `OverlayProvider` interface. It detects which hooks the wrapped overlay implements at construction time (throws `TypeError` if neither `preTask` nor `postTask` is present), and conditionally assigns `invokePre`/`invokePost` as arrow functions in the constructor. The `enabled` getter delegates live to `inner.enabled`.

Mapping logic:
- `OverlayResult.proceed: true` → `OverlayDecision { verdict: "PASS" }`
- `OverlayResult.proceed: false, hil_trigger: true` → `{ verdict: "HIL" }` with evidence
- `OverlayResult.proceed: false` → `{ verdict: "REWORK" }` with evidence
- `PostTaskOverlayResult.accept: true` → `{ verdict: "PASS" }`
- `PostTaskOverlayResult.accept: false, new_status: "FAILED"` → `{ verdict: "FAIL" }`
- `PostTaskOverlayResult.accept: false, new_status: "COMPLETED"` → throws `TypeError` naming the overlay
- `PostTaskOverlayResult.accept: false` (other/undefined) → `{ verdict: "REWORK" }`

**Design decision:** `makeEvidence()` helper constructs `OverlayEvidence` using conditional field assignment to satisfy `exactOptionalPropertyTypes: true`.

### T007 — Config Schema

**Status**: Complete

**Files:**
- `src/config/remote-overlay-schema.ts` — source was pre-authored; fixed `ResolvedOverlayConfig` type to use `NonNullable<z.infer<typeof RemoteOverlaysSectionSchema>>` instead of a hand-written interface, eliminating the `exactOptionalPropertyTypes` mismatch
- `src/types/index.ts` — already had `governance?` field on `ProjectConfig`
- `src/config/defaults.ts` — already had `governance: { requirements_lock: "warn" }` in `DEFAULT_CONFIG`
- `src/cli/config-loader.ts` — already had `loadRemoteOverlayConfig()` function (Option B from spec)
- `src/cli/commands/validate-config.ts` — already called `loadRemoteOverlayConfig` and reported errors
- `tests/config/remote-overlay-schema.test.ts` — created (29 tests)

**What was built:**
Zod schemas validate two new optional config sections (`overlay_backends`, `remote_overlays`) plus `governance`, all additive to `.ai-sdd/ai-sdd.yaml`. A separate `loadRemoteOverlayConfig()` function reads and validates these sections without touching the existing `loadProjectConfig()` signature. `validate-config` CLI command reports validation errors in the same format as existing errors.

Key schema constraints enforced:
- MCP backend without `tool` field → ZodError with message containing "tool" and "mcp"
- `hooks: []` → ZodError naming minimum constraint
- `timeout_ms` defaults to 5000, `failure_policy` defaults to "warn", `enabled` and `blocking` default to true
- `parseRemoteOverlayConfig(undefined)` returns `undefined` (backward compatibility)

## Test Results

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| `tests/overlays/local-overlay-provider.test.ts` | 26 | 26 | 0 |
| `tests/config/remote-overlay-schema.test.ts` | 29 | 29 | 0 |
| All suites combined | 331 | 331 | 0 |

Previous count: 276. New count: 331 (+55 new tests).

## TypeScript

`bun run typecheck` — no errors introduced by new code. All remaining errors are pre-existing in
other files (`src/cli/commands/run.ts`, `src/core/workflow-loader.ts`, etc.) and were present
before this implementation. The `bun:test` and `Bun` global type errors affect all test files
and are a known project-level configuration gap (tsc does not have Bun type definitions installed).

## Decisions Made

1. **Source files were pre-authored** — both `src/overlays/local-overlay-provider.ts` and
   `src/config/remote-overlay-schema.ts` existed with correct logic but had `exactOptionalPropertyTypes`
   TypeScript errors that needed fixing.

2. **`ResolvedOverlayConfig` as inferred type** — replaced the hand-written interface with
   `NonNullable<z.infer<typeof RemoteOverlaysSectionSchema>>` to avoid duplicating the type
   definition and the exactOptionalPropertyTypes mismatch that arises when Zod inference and
   manual interface definitions diverge on optional field handling.

3. **Test coverage** — 26 tests for T002 (all 13 spec-required cases plus evidence propagation
   variants) and 29 tests for T007 (all 14 spec-required cases including CLI integration tests
   via `Bun.spawnSync`).

### T003 — McpClientWrapper

**Status**: Complete

**Files:**
- `src/overlays/mcp/mcp-client.ts` — source was pre-authored; verified correct implementation
- `tests/overlays/mcp/mcp-client.test.ts` — created (27 tests)
- `tests/overlays/mcp/fixtures/mcp-call-tool-result.json` — fixture was pre-created; verified correct

**What was built:**
`McpClientWrapper` wraps the `@modelcontextprotocol/sdk` `Client` class. All SDK calls are confined
to this class; the public API (`callTool`, `connect`, `disconnect`, `isConnected`) uses only plain
TypeScript types. Key behaviors:

- `connect()` — dynamically imports SDK `Client` and `StdioClientTransport`, builds transport from
  `config.command` (first element = executable, rest = args) and `config.env` merged over
  `process.env`, instantiates client with name `"ai-sdd"`, calls `client.connect(transport)`.
- `callTool(toolName, input)` — guards with `McpNotConnectedError` if not connected; uses
  `Promise.race` against a `setTimeout` to enforce `config.timeout_ms` (default 5000); calls the
  underlying SDK `callTool`; extracts the first content item from the SDK envelope (type `"text"`
  → parse JSON; type `"json"` → return `.data`; otherwise return raw).
- `disconnect()` — no-op if not connected; calls `client.close()` and sets `_connected = false`.
- Transport validation at construction — throws `TypeError` naming `"sse"` if transport is not `"stdio"`.

Three custom error classes are exported: `McpTimeoutError` (with `toolName` and `timeoutMs`
properties), `McpNotConnectedError` (with `backendId` property and actionable message), and
`McpSchemaError`.

**Test strategy:** Tests inject a mock `SdkClientShape` into the wrapper via type-cast field
assignment (`(wrapper as unknown as Record<string, unknown>)["_client"]`), avoiding real subprocess
spawning. Timeout tests use a never-resolving mock client and assert error type/elapsed time.

**Test coverage summary:**
| Category | Tests |
|----------|-------|
| Error class exports | 3 |
| Construction + transport validation | 3 |
| Pre-connect guard | 3 |
| callTool with mock client | 4 |
| Timeout enforcement | 3 |
| Disconnect behavior | 4 |
| External schema fixture (CLAUDE.md §4) | 5 |
| No SDK type leakage | 2 |
| **Total** | **27** |

## Test Results

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| `tests/overlays/overlay-protocol.test.ts` | 9 | 9 | 0 |
| `tests/overlays/local-overlay-provider.test.ts` | 26 | 26 | 0 |
| `tests/config/remote-overlay-schema.test.ts` | 29 | 29 | 0 |
| `tests/overlays/mcp/mcp-client.test.ts` | 27 | 27 | 0 |
| All suites combined | 358 | 358 | 0 |

Previous count: 331. New count: 358 (+27 new tests for T003).

## TypeScript

`bun run typecheck` — no errors in `src/overlays/mcp/mcp-client.ts`. The test file has the same
pre-existing `bun:test` module error (TS2307) that affects all 23 test files due to the project not
having `@types/bun` installed. This is a pre-existing gap, not introduced by T003.

## Decisions Made

1. **Source files were pre-authored** — `src/overlays/mcp/mcp-client.ts`,
   `src/overlays/mcp/mcp-overlay-provider.ts`, and `tests/overlays/mcp/fixtures/mcp-call-tool-result.json`
   all existed before T003 work began. T003 work was creating the missing test suite.

2. **Mock injection via type cast** — rather than adding a test-only injection method to production
   code, tests cast `wrapper` to `Record<string, unknown>` to set `_client` and `_connected`
   directly. This is the standard TypeScript pattern for testing classes with private fields without
   adding production API surface.

3. **Timeout tests use `Promise.race` at test level** — the config-to-behavior test (item 8 in spec)
   races against a 250ms wall clock to verify that timeout_ms:200 fires and timeout_ms:500 does not.

4. **`unwrapSdkResponse` tested via fixture** — the external schema fixture test exercises the full
   unwrapping path using the captured real SDK response shape, satisfying CLAUDE.md §4.

## Open Issues

None. All acceptance criteria satisfied for T001-T003.

---

## T005 — Overlay Registry & T006 — Provider Chain Runner

**Status**: Complete (implementation files were pre-existing; tests were created)

### What Was Built

**`src/overlays/registry.ts`** (pre-existing, correct):
- `RegistryError` error class for build-time failures
- `buildProviderChain(input: RegistryInput): OverlayProvider[]` — constructs the unified ordered provider chain
- Chain order locked: HIL → remote overlays (insertion order) → policy_gate → review/paired → confidence
- `enabled: false` remote overlays silently excluded
- Unknown backend references throw `RegistryError` naming both overlay and backend
- Mutually exclusive review+paired throws `RegistryError`
- Unsupported runtimes (non-mcp) throw `RegistryError` with actionable message

**`src/overlays/composition-rules.ts`** (pre-existing, `validateProviderCombination` already implemented):
- Invariant 1: HIL must be first
- Invariant 5: Review and Paired mutually exclusive
- Invariant 6 (new): remote overlays must not appear after policy_gate

**`src/overlays/provider-chain.ts`** (pre-existing, correct):
- `runPreProviderChain(chain, ctx): Promise<OverlayDecision>` — runs pre-task hooks with short-circuit
- `runPostProviderChain(chain, ctx, result): Promise<OverlayDecision>` — runs post-task hooks with short-circuit
- `mergeContextUpdate(ctx, update): OverlayContext` — strips identity fields before merging
- Phase filtering, disabled provider skipping, unhandled exception catch (NFR-002)
- Old `runPreTaskChain`/`runPostTaskChain` in `base-overlay.ts` unchanged (backward compat)

### Tests Created

**`tests/overlays/registry.test.ts`** — 20 tests:
- Chain order invariants (HIL first, remote at index 1, insertion order preserved)
- Error cases (unknown backend, mutually exclusive overlays, missing emitter)
- Backward compatibility (no remoteConfig → all LocalOverlayProvider)
- `validateProviderCombination` Invariant 1, 5, and 6 enforcement
- Regression check: `validateOverlayCombination` still works unchanged

**`tests/overlays/provider-chain.test.ts`** — 30 tests:
- Empty chain, all PASS, short-circuit on REWORK/FAIL/HIL
- disabled/no-hook/phase-filter skip conditions
- Exception handling → FAIL, no propagation
- Context propagation and identity field stripping
- Post-chain symmetric tests
- Config-to-behavior: phases config changes call counts

### Test Results

```
444 pass, 0 fail (up from 394)
Ran 444 tests across 26 files
```

### Notable Implementation Decision

`makeMockProvider` in the test uses `Object.defineProperty` for `preCallCount`/`postCallCount` to keep them as live getters (not evaluated at object-construction time). Object spreading copies getter values as plain properties, which would freeze the counter at 0. Also uses `Object.defineProperty` for `phases` to satisfy `exactOptionalPropertyTypes: true` without assigning `undefined` to a required property.

---

## T004 — McpOverlayProvider

**Status**: Complete

**Files:**
- `src/overlays/mcp/mcp-overlay-provider.ts` — modified (added injectable factory parameter)
- `tests/overlays/mcp/mcp-overlay-provider.test.ts` — created (31 tests)

### What Was Built

The `McpOverlayProvider` source was pre-authored with the full two-tier failure model. One
production change was made for testability:

**Injectable client factory** — Added an optional `clientFactory` parameter to the constructor.
The factory defaults to `(cfg) => new McpClientWrapper(cfg)`, preserving existing production
behavior. Tests pass a mock factory that returns a controllable stub without spawning real
MCP subprocesses. The `invoke()` private method now calls `this._clientFactory(this.backendConfig)`
instead of `new McpClientWrapper(this.backendConfig)`.

### Test Coverage (31 tests)

- Happy path: all 4 verdicts (PASS, REWORK, FAIL, HIL) round-trip correctly
- Tier 1 transport failures: all 3 policies (warn, fail_closed, skip) and blocking:false override
- Tier 2 schema violations: always fail_closed regardless of failure_policy or blocking:false
- Observability lifecycle: event emission order and field contents verified
- Evidence propagation: overlay_id, source, checks, report_ref, data fields forwarded
- Constructor behavior: runtime, id, hook assignment, enabled
- Post-task hook: invokePost with PASS and REWORK verdicts
- Security: GITHUB_TOKEN in transport error message is redacted by ObservabilityEmitter sanitizer

### Test Results

```
389 pass
0 fail
614 expect() calls
Ran 389 tests across 24 files.
```

Previous count: 358. New count: 389 (+31 new tests for T004).

### TypeScript

No new TypeScript errors introduced. The three pre-existing exactOptionalPropertyTypes errors in
`src/overlays/mcp/mcp-overlay-provider.ts` were present before this task and are in the pre-authored
functions (`buildInput`, `mapToDecision`) — not in the constructor code changed by T004.

### Decisions Made

1. **Factory injection** — The spec says "accept McpClientWrapper factory function as a constructor
   parameter." This is explicit, type-safe, and avoids module-level mocking side-effects.

2. **Default factory** — `clientFactory ?? ((cfg) => new McpClientWrapper(cfg))` ensures zero
   behavioral change when no factory is provided (all production code paths unaffected).

3. **Security test scope** — The `overlayConfig.config` passthrough goes to the MCP server via
   `callTool()` but is not in emitted event payloads. The test instead puts the secret in a
   transport error message, which IS emitted in `overlay.remote.failed` and IS sanitized by the
   `ObservabilityEmitter` default sanitizer — verifying the actual code path that matters.

---

## T009 — Engine Wiring

**Status**: Complete (implementation was pre-existing; tests were created; one engine bug fixed)

### What Was Pre-existing

`src/core/engine.ts` already had the full T009 implementation:
- Constructor accepts `providerChain: OverlayProvider[]` (not the old `BaseOverlay[]`)
- Calls `runPreProviderChain` / `runPostProviderChain` from `provider-chain.ts`
- `applyPreDecision` private method with exhaustive switch over all 4 verdicts + `never` cast default
- `applyPostDecision` private method with same exhaustive switch
- HIL lookup via `p.id === "hil" && p.runtime === "local"` + `.inner` access pattern

`src/cli/commands/run.ts` already had:
- `import { buildProviderChain } from "../../overlays/registry.ts"`
- `buildProviderChain({ localOverlays: {...}, remoteConfig, emitter })` call
- `providerChain` passed as last argument to `new Engine(...)`

### Bug Fixed: RUNNING→RUNNING State Transition

During test development, a latent bug in `src/core/engine.ts` was discovered: after a REWORK
verdict, `applyPreDecision`/`applyPostDecision` re-arms the task to RUNNING (NEEDS_REWORK → RUNNING).
On the next loop iteration, `runTaskIteration` unconditionally called `transition(RUNNING)` again
from an already-RUNNING state, causing `StateError: Invalid transition RUNNING → RUNNING`.

**Fix applied** (line 302 of `src/core/engine.ts`): added a guard `if (currentState.status !== "RUNNING")`
before the initial `transition(RUNNING)` call. This allows re-armed RUNNING tasks to skip the
redundant transition. The `currentState` variable was already captured at the top of
`runTaskIteration` (line 247) and was available for this check.

This bug was latent because no existing test exercised the full rework cycle (REWORK verdict →
loop restart → PASS/COMPLETED). The bug affected both overlay-triggered REWORK and adapter-returned
NEEDS_REWORK paths.

### Tests Created

**`tests/core/engine-provider-chain.test.ts`** (11 tests):

1. Pre-chain PASS → adapter `dispatchWithRetry` called, task COMPLETED (integration wiring test)
2. Pre-chain REWORK → engine loops, pre-chain called at least twice, task eventually COMPLETED
3. Pre-chain FAIL → task FAILED, adapter NOT called, `taskState.error` contains feedback
4. Pre-chain HIL → HIL_PENDING transition recorded; task FAILED due to no HIL resolver in chain
5. Post-chain PASS → task reaches COMPLETED, post-chain called once
6. Post-chain REWORK → task re-iterates, `iterations >= 2`
7. Post-chain FAIL → task FAILED, `taskState.error` contains feedback
8. Evidence present in decision → `taskState.overlay_evidence.overlay_id` matches
9. `updated_context.task_id = "injected"` → state record task ID unchanged (identity protection)
10. `LocalOverlayProvider.invokePre` is called (not `BaseOverlay.preTask` directly) — CLAUDE.md §2
11. Pure `OverlayProvider` (no `BaseOverlay`, runtime="mcp") is called by engine — wiring test

### Test Results

472 pass, 0 fail (up from 444). All previous tests still pass.

---

## T010 — Observability Events

**Status**: Complete (implementation was pre-existing; tests were created)

### What Was Pre-existing

`src/observability/events.ts` already exported all 6 new event Zod schemas:
- `OverlayRemoteConnectingEvent`
- `OverlayRemoteConnectedEvent`
- `OverlayRemoteInvokedEvent`
- `OverlayRemoteDecisionEvent`
- `OverlayRemoteFailedEvent`
- `OverlayRemoteFallbackEvent`

`src/observability/emitter.ts` already had the explicit `overlay.remote.fallback` → WARN check
in `getEventLevel()` (line 96), placed before the generic `return "INFO"` fallback.

`src/types/index.ts` already included all 6 event types in the `EventType` union.

`src/overlays/mcp/mcp-overlay-provider.ts` already emitted all 6 event types at the correct
lifecycle points.

### Tests Created

**`tests/observability/remote-overlay-events.test.ts`** (17 tests):

Schema tests:
1. `OverlayRemoteConnectingEvent` validates correct payload
2. `OverlayRemoteConnectedEvent` validates with `duration_ms`
3a. `OverlayRemoteFailedEvent` validates `failure_tier: "transport"`
3b. `OverlayRemoteFailedEvent` validates `failure_tier: "schema"`
4a. `OverlayRemoteFallbackEvent` accepts `failure_policy: "warn"`
4b. `OverlayRemoteFallbackEvent` accepts `failure_policy: "skip"`
5. `OverlayRemoteFallbackEvent` rejects `failure_policy: "fail_closed"` → `success: false`
6a-6d. `OverlayRemoteDecisionEvent` validates all four verdict values

Log level tests (via stdout/stderr stream interception):
7. `overlay.remote.failed` → ERROR level
8. `overlay.remote.fallback` → WARN level (explicit check in emitter)
9. `overlay.remote.decision` → INFO level
10. `overlay.remote.connecting` → INFO level

Secret redaction + required fields:
11. OPENAI_KEY pattern (`sk-` + 48 chars) in `backend_id` field → `[REDACTED:OPENAI_KEY]` in event data
12. `overlay.remote.failed` event includes all 6 required fields with correct types

### Test Results

472 pass, 0 fail. All 28 test files pass.

### TypeScript

No errors introduced. The typecheck pre-existing errors (bun:test module, Bun global, exactOptionalPropertyTypes) are all unchanged.

---

## exactOptionalPropertyTypes Fix (Developer review task)

**Status**: Complete

### What Was Fixed

**`src/overlays/mcp/mcp-overlay-provider.ts`**

- `buildInput`: replaced explicit optional-field assignments for `phase`, `requirement_ids`, `acceptance_criteria`, `scope_excluded` with conditional spreads so `undefined` is never assigned to an optional property.
- `buildInput`: replaced `config: passthrough` with `...(passthrough !== undefined && { config: passthrough })`.
- `buildInput`: replaced direct `result.outputs` and `result.handover_state` assignments inside the `result` block with conditional spreads.
- `mapToDecision`: replaced `feedback: parsed.feedback` and the three evidence optional fields (`checks`, `report_ref`, `data`) with conditional spreads.
- Constructor: replaced `this.phases = overlayConfig.phases` (assigns `string[] | undefined` to `readonly phases?: string[]`) with an `if (overlayConfig.phases !== undefined)` guard.

**`src/cli/commands/run.ts`**

- `HilOverlay` constructor: extracted `hilNotify` and used conditional spread for `notify`.
- `buildProviderChain` call: used conditional spread for `remoteConfig` (which may be `undefined`).
- `Engine` constructor: replaced `max_concurrent_tasks`, `cost_budget_per_run_usd`, `cost_enforcement` direct assignments with conditional spreads.
- `engine.run` call: extracted `targetTask` and used conditional spread for `target_task`.

### Advisory Fixes

**`overlay.remote.fallback` for `skip` policy** — the `skip` case in `handleTransportFailure` now emits `overlay.remote.fallback` with `failure_policy: "skip"`, matching the `warn` case. Operators can now observe silent skips in the event stream.

**`overlay.remote.connected` missing fields** — `workflow_id` and `run_id` from `ctx` are now included in the `data` payload of the `overlay.remote.connected` event.

### Test updates

Two tests in `tests/overlays/mcp/mcp-overlay-provider.test.ts` updated (tests 7 and 15b): previously asserted that `skip` did NOT emit `overlay.remote.fallback`; now assert it DOES emit the event with `failure_policy: "skip"`.

### Test Results

```
472 pass
0 fail
823 expect() calls
Ran 472 tests across 28 files.
```

### TypeScript

`bun run typecheck` — zero errors in `src/overlays/mcp/mcp-overlay-provider.ts` and `src/cli/commands/run.ts` after changes.

---

## ROA-T-011 — Integration and Regression Tests

**Status**: Complete

### What Was Implemented

**Gap 1 — McpSchemaError JSDoc** (`src/overlays/mcp/mcp-client.ts`):

Added `/** Reserved for future use. Not raised in this release. */` JSDoc comment to the `McpSchemaError` class declaration. Satisfies L2 review Finding 3 (non-blocking).

**Gap 2 — Skip-policy source fix + assertion** (`src/overlays/mcp/mcp-overlay-provider.ts`, `tests/overlays/mcp/mcp-overlay-provider.test.ts`):

The source code had a bug: for `failure_policy: "skip"`, `overlay.remote.failed` was emitted before `overlay.remote.fallback`. This violated FR-008 AC: "no overlay.remote.failed event is emitted" for skip policy and L2 review-l2 Finding 1 resolution.

**Source fix**: Restructured the transport error handler to emit `overlay.remote.failed` only for `warn` and `fail_closed` policies. The `skip` case now emits only `overlay.remote.fallback`.

**Test assertion added** to test 7:
```typescript
const failedEvent = events.find((e) => e.type === "overlay.remote.failed");
expect(failedEvent).toBeUndefined();
```

**Gap 3 — overlay.remote.invoked comment** (`src/overlays/mcp/mcp-overlay-provider.ts`):

Added a comment at the `overlay.remote.invoked` emit site clarifying in-flight semantics.

**Gap 4 — Three missing integration tests**:

1. **Chain-builder wiring test** in `tests/engine.test.ts` (`buildProviderChain wiring integration` describe block): Calls `buildProviderChain` with a spy BaseOverlay, passes the resulting chain to Engine, asserts spy's `preTask` was invoked during engine run. Satisfies Development Standards §2.

2. **`ai-sdd status` CANCELLED display e2e test** in `tests/cli/status-cancelled.test.ts` (two tests): Writes state with CANCELLED/FAILED tasks, runs actual CLI via `Bun.spawn`, asserts `⊘` in stdout for CANCELLED, `✗` for FAILED, and separate counts in summary line.

3. **`overlay_evidence` in `status --json`** in `tests/cli/status-cancelled.test.ts` (one test): Writes state with `overlay_evidence` on a task, runs `ai-sdd status --json`, parses JSON output, asserts all evidence fields are preserved (not stripped by serializer).

### Test Results

```
509 pass
0 fail
899 expect() calls
Ran 509 tests across 30 files.
```

Baseline was 505 tests. 4 new tests added (1 engine wiring + 2 CANCELLED display + 1 overlay_evidence JSON).

### TypeScript

No new type errors introduced in source files. One new pre-existing-pattern error in test file (`Bun` global not in tsc types — same pattern as existing `tests/config/remote-overlay-schema.test.ts` which has had this error since it was created).

### Decisions Made

1. **Source fix was required for Gap 2**: Adding `expect(failedEvent).toBeUndefined()` would have failed without fixing the source — the skip path was incorrectly emitting `overlay.remote.failed` first. Fixed source to match the FR-008 design.

2. **CLI tests use `Bun.spawn` async**: The new CLI integration tests use the async `Bun.spawn` API since the test bodies are async. Consistent with the project's use of `Bun.spawnSync` in `tests/config/remote-overlay-schema.test.ts`.

3. **Chain-builder wiring test placed in `tests/engine.test.ts`**: Per task spec. While `tests/core/engine-provider-chain.test.ts` tests Engine with manually-constructed chains, it does not test that `buildProviderChain`'s output is the entry point. The new test in `tests/engine.test.ts` closes this gap.
