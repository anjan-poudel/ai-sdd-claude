# Review Report — L2 Component Design (Remote Overlay Abstraction)

## Summary

**Artifact reviewed**: `specs/remote-overlay-abstraction/component-design-l2.md`
**Reviewer task**: `review-l2`
**Review iteration**: 2 (re-review after rework)
**Date**: 2026-03-08
**Inputs examined**: component-design-l2.md (reworked, PRIMARY), specs/review-l2.md iteration 1 (previous NO_GO), specs/remote-overlay-abstraction/FR/FR-008-remote-failure-handling.md

The rework correctly resolves the single blocking issue from iteration 1. The error handling table for Tier 1 transport errors now reads for the `"skip"` row: "Return `{ verdict: "PASS" }`; emit `overlay.remote.fallback` only (no `overlay.remote.failed`)" — matching the `invoke` algorithm in Component F and the FR-008 acceptance criteria verbatim.

No new inconsistencies were introduced by the rework. All previously-passing criteria remain intact. The two non-blocking findings from iteration 1 are preserved as L3 recommendations and do not block GO.

## Decision

**GO**

All criteria met. The `skip` policy event contradiction (Finding 1) is resolved. The L2 component design is approved for L3 task planning.

## Findings

### Finding 1 — RESOLVED: Internal contradiction on `skip` policy event emission

**Previous state (iteration 1)**: The error handling table in "Two-tier failure model (McpOverlayProvider)" listed `"skip"` → `emit overlay.remote.failed + overlay.remote.fallback`, contradicting the `invoke` algorithm (Component F, step 6) and FR-008 AC (Scenario: skip policy silently returns PASS with no `overlay.remote.failed` event).

**Current state (iteration 2)**: The error handling table `"skip"` row now reads: "Return `{ verdict: "PASS" }`; emit `overlay.remote.fallback` only (no `overlay.remote.failed`)". This is consistent with:

1. Component F `invoke` algorithm, step 6: `"skip": emit overlay.remote.fallback; return { verdict: "PASS" }` — no `overlay.remote.failed` emitted.
2. FR-008 AC (Scenario: Transport timeout with failure_policy "skip"): "no overlay.remote.failed event is emitted."

The `invoke` algorithm and the error handling table are now in agreement. The FR-008 `skip` AC is fully satisfied.

**Status**: RESOLVED — no longer blocking.

### Finding 2 — NON-BLOCKING (carried from iteration 1): `overlay.remote.invoked` event description ambiguity

Not required to be fixed for GO. The `invoke` algorithm in Component F remains the authoritative specification. Carry forward to L3.

### Finding 3 — NON-BLOCKING (carried from iteration 1): `McpSchemaError` JSDoc gap

Not required to be fixed for GO. Carry forward to L3 implementor task for `mcp-client.ts`.

## Traceability Matrix

Changes from iteration 1 are noted. All other rows are unchanged.

| FR / NFR | L2 Component(s) | Status |
|-----------|----------------|--------|
| FR-001: OverlayProvider interface | Component A (overlay-protocol.ts), Component B (LocalOverlayProvider), Component F (McpOverlayProvider) | PASS |
| FR-002: OverlayDecision contract + verdict mapping | Component A (OverlayInvokeOutputSchema, OverlayVerdict), Component B (mapping tables) | PASS |
| FR-003: McpClientWrapper + overlay.invoke protocol | Component E (mcp-client.ts) — three error classes, connect/disconnect/callTool contracts, timeout via Promise.race | PASS |
| FR-004: Provider chain construction and composition | Component C (registry.ts, buildProviderChain), Component D (provider-chain.ts, mergeContextUpdate), Component K (composition-rules.ts) | PASS |
| FR-005: Config schema (overlay_backends, remote_overlays, governance) | Component G (remote-overlay-schema.ts) — ZodObject schemas, refine for tool/mcp, defaults, parseRemoteOverlayConfig | PASS |
| FR-006: CANCELLED task state + VALID_TRANSITIONS | Component H (src/types/index.ts) — all 7 transition rows specified, terminal semantics, downstream behavior | PASS |
| FR-007: Engine verdict mapping + HIL resume | Component I (engine.ts) — applyPreDecision/applyPostDecision tables, exhaustive switch, evidence persistence, HIL resume skip | PASS |
| FR-008: Remote failure handling (two-tier model) | Component F error handling table corrected: skip emits `overlay.remote.fallback` only. Invoke algorithm and table are now consistent. FR-008 skip AC satisfied. | PASS (was FAIL in iteration 1) |
| FR-009: Observability events (six event types) | Component J — EventType additions, payload fields, duration_ms, log levels, secret redaction | PASS |
| NFR-001: Performance bounds | McpClientWrapper timeout_ms (default 5000, Promise.race), phase-skip in provider-chain.ts, registry build once at startup | PASS |
| NFR-002: Reliability / atomic state | Chain runner exception → FAIL (no propagation), CANCELLED atomic tmp+rename, VALID_TRANSITIONS enforcement | PASS |
| NFR-003: Security (no-mutation, schema guard, secret redaction) | mergeContextUpdate IDENTITY_FIELDS, OverlayInvokeOutputSchema Zod guard, sanitizer.ts in emitter.emit() | PASS |
| NFR-004: Backward compatibility | LocalOverlayProvider shim (zero changes to existing overlays), config absent = undefined return, 177-test gate | PASS |

**L1 review non-blocking suggestions — disposition** (unchanged from iteration 1):
- Suggestion 1 (connect/disconnect error path guarantees): Fully addressed in Component E.
- Suggestion 2 (mergeContextUpdate identity stripping via Zod transform): Addressed using `Set`-based `IDENTITY_FIELDS` constant. Rationale is documented and technically correct.

**L1 architecture consistency**: The L2 chain order (HIL → Remote → Policy Gate → Review/Paired → Confidence) matches L1. The `OverlayProvider` interface, ADR-001 through ADR-005, and engine-as-single-enforcement-point are all preserved.

## Recommendations for L3 (plan-tasks)

1. **Test for skip policy event emission** (highest priority, now guarding the resolved Finding 1): A dedicated test that uses `failure_policy: "skip"`, triggers a transport error, and asserts (a) verdict is PASS, (b) `overlay.remote.fallback` IS emitted, (c) `overlay.remote.failed` is NOT emitted.

2. **External MCP SDK fixture** (Development Standards §4): The `tests/overlays/mcp/mcp-client.test.ts` must include a fixture of the actual `@modelcontextprotocol/sdk@^1.0.4` `CallToolResult` structure. The L3 task breakdown should include a subtask to capture and commit this fixture before implementing `McpClientWrapper`.

3. **`McpSchemaError` JSDoc** (Finding 3): The L3 implementor task for `mcp-client.ts` should add `/** Reserved for future use. Not raised in this release. */` to the class declaration.

4. **Chain-builder integration test** (Development Standards §2): Component C (`buildProviderChain`) wires into the Engine constructor. There must be at least one test verifying `buildProviderChain` is called at engine startup and the chain is passed to `runPreProviderChain`.

5. **`ai-sdd status` CANCELLED display** (Development Standards §7): FR-006 AC requires CANCELLED tasks to appear as a separate category. The L3 breakdown should include a CLI integration test for this.

6. **`overlay_evidence` in `ai-sdd status --json`**: FR-007 requires evidence to be visible in `status --json` output. The L3 engine-integration task should include updating the status command serializer.
