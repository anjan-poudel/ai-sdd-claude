# Task Breakdown L3 — Remote Overlay Abstraction

## Summary
- **Artifact contract**: `task_breakdown_l3`
- **Feature**: Remote Overlay Abstraction
- **Input**: `specs/remote-overlay-abstraction/component-design-l2.md` (READY FOR IMPLEMENTATION), `specs/review-l2.md` (GO, iteration 2)
- **Task count**: 11 tasks (no subtasks)
- **Estimated effort**: 2–3 days parallel / 5–7 days sequential
- **Critical path**: ROA-T-001 → ROA-T-005 → ROA-T-006 → ROA-T-007 → ROA-T-008 → ROA-T-011

## Contents

| ID | Task | Effort | Risk | Status |
|----|------|--------|------|--------|
| [ROA-T-001](tasks/ROA-T-001-overlay-protocol-types.md) | Overlay Protocol Types | S | MEDIUM | COMPLETE |
| [ROA-T-002](tasks/ROA-T-002-cancelled-task-state.md) | CANCELLED Task State | S | MEDIUM | COMPLETE |
| [ROA-T-003](tasks/ROA-T-003-remote-overlay-config-schema.md) | Remote Overlay Config Schema | S | LOW | COMPLETE |
| [ROA-T-004](tasks/ROA-T-004-local-overlay-provider.md) | LocalOverlayProvider | S | HIGH | COMPLETE |
| [ROA-T-005](tasks/ROA-T-005-mcp-client-wrapper.md) | McpClientWrapper | M | HIGH | COMPLETE — JSDoc gap open |
| [ROA-T-006](tasks/ROA-T-006-mcp-overlay-provider.md) | McpOverlayProvider | M | HIGH | COMPLETE — skip-policy assertion gap open |
| [ROA-T-007](tasks/ROA-T-007-provider-chain-and-registry.md) | Provider Chain and Registry | M | HIGH | COMPLETE |
| [ROA-T-008](tasks/ROA-T-008-engine-integration.md) | Engine Integration | L | HIGH | COMPLETE — wiring test and overlay_evidence gaps open |
| [ROA-T-009](tasks/ROA-T-009-state-manager-cancelled-tests.md) | State Manager CANCELLED Tests | S | LOW | COMPLETE |
| [ROA-T-010](tasks/ROA-T-010-observability-event-log-levels.md) | Observability Event Log Levels | S | LOW | COMPLETE |
| [ROA-T-011](tasks/ROA-T-011-integration-and-regression-tests.md) | Integration and Regression Tests | M | MEDIUM | OPEN |

## Dependency graph

```
ROA-T-001 (types)
  ├─ ROA-T-002 (CANCELLED state)  → ROA-T-009 (state tests)
  ├─ ROA-T-003 (config schema)    → ROA-T-005
  ├─ ROA-T-004 (local provider)   → ROA-T-007
  ├─ ROA-T-005 (mcp-client)       → ROA-T-006
  │     ROA-T-006 (mcp-provider)  → ROA-T-007
  │            ROA-T-007 (chain/registry) → ROA-T-008
  │                   ROA-T-008 (engine)  → ROA-T-011
  ├─ ROA-T-010 (observability)             → ROA-T-011
  ROA-T-009 ──────────────────────────────→ ROA-T-011
```

## Critical path

ROA-T-001 → ROA-T-005 → ROA-T-006 → ROA-T-007 → ROA-T-008 → ROA-T-011

The critical path runs through the MCP transport stack. `overlay-protocol.ts` (T-001)
unblocks all implementations simultaneously. The MCP client (T-005) is a strict
prerequisite for the MCP provider (T-006), which in turn is required before the registry
(T-007) can assemble mixed chains. Engine integration (T-008) must follow the chain runner.
The final integration test task (T-011) closes all open gaps.

## Open implementation gaps

The source code is substantially complete (505 tests passing). The following four gaps
remain open and must be closed before the feature can be declared complete:

### Gap 1 — McpSchemaError JSDoc (review-l2 Finding 3)
- **Task**: ROA-T-005
- **Required change**: Add `/** Reserved for future use. Not raised in this release. */`
  JSDoc to `McpSchemaError` class declaration in `src/overlays/mcp/mcp-client.ts`.
- **Effort**: XS (one line addition).

### Gap 2 — Skip-policy no-overlay.remote.failed assertion (review-l2 highest priority)
- **Task**: ROA-T-006, ROA-T-011
- **Required change**: In test 7 of `tests/overlays/mcp/mcp-overlay-provider.test.ts`,
  add an explicit assertion that `overlay.remote.failed` is NOT present in the events
  array when `failure_policy: "skip"` and a transport error occurs.
- **Effort**: XS (two lines — find + assertion).
- **Why**: This directly guards the resolved Finding 1 (skip-row contradiction) from
  review-l2 iteration 1. Without this assertion, a regression to the old (incorrect)
  behavior would go undetected.

### Gap 3 — overlay.remote.invoked implementation comment (review-l2 Finding 2)
- **Task**: ROA-T-006
- **Required change**: Add an implementation comment at the `overlay.remote.invoked`
  emit site in `McpOverlayProvider.invoke()` clarifying that the event is emitted
  after `callTool()` is dispatched but before the response is received (the invocation
  is in-flight at emission time).
- **Effort**: XS (comment addition — no behavioral change).

### Gap 4 — Integration tests (review-l2 Recommendations 4, 5, 6)
- **Task**: ROA-T-011
- **Required changes**:
  1. Chain-builder wiring integration test in `tests/engine.test.ts` (Dev Standards §2).
  2. `ai-sdd status` CANCELLED CLI integration test (Dev Standards §7).
  3. `overlay_evidence` in `ai-sdd status --json` verified by test.
- **Effort**: S (three new test scenarios).

## L2 review recommendations — disposition

| Review recommendation | Task | Disposition |
|-----------------------|------|-------------|
| R1: Skip policy event emission test (highest priority — guards resolved Finding 1) | ROA-T-006, ROA-T-011 | Gap 2 above — open |
| R2: External MCP SDK fixture (Dev Standards §4) | ROA-T-005 | COMPLETE — `tests/overlays/mcp/fixtures/mcp-call-tool-result.json` committed |
| R3: McpSchemaError JSDoc (Finding 3) | ROA-T-005 | Gap 1 above — open |
| R4: Chain-builder integration test (Dev Standards §2) | ROA-T-011 | Gap 4 item 1 — open |
| R5: ai-sdd status CANCELLED display (Dev Standards §7) | ROA-T-002, ROA-T-011 | Gap 4 item 2 — open |
| R6: overlay_evidence in status --json | ROA-T-008, ROA-T-011 | Gap 4 item 3 — open |

## Security review

No BLOCKERs from `security-design-review` affect this feature. The L2 design satisfies
all three security properties from NFR-003:
- No-mutation invariant: `IDENTITY_FIELDS` in `mergeContextUpdate` prevents remote
  overlay from injecting `task_id`, `workflow_id`, `run_id`, or `status`.
- Schema enforcement: `OverlayInvokeOutputSchema` (Zod) is the single validation gate
  before any remote verdict reaches the engine state machine.
- Secret redaction: all event payloads pass through `sanitizer.sanitizeObject(data)` in
  `emitter.emit()` before any handler or log line receives them.

## NFR coverage

| NFR | Primary coverage | Status |
|-----|-----------------|--------|
| NFR-001 Performance | McpClientWrapper `Promise.race` timeout (T-005), phase-skip latency (T-007) | COMPLETE |
| NFR-002 Reliability | Chain runner exception-to-FAIL conversion (T-007), CANCELLED atomic write (T-009) | COMPLETE |
| NFR-003 Security | Schema guard (T-006), IDENTITY_FIELDS (T-007), secret redaction (T-010) | COMPLETE |
| NFR-004 Compatibility | LocalOverlayProvider shim (T-004), absent config returns undefined (T-003), 505-test gate (T-011) | PARTIAL — T-011 open |
