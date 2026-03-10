# Review Report — L1 Architecture (design-l1)

## Summary

**Decision: GO**

The L1 architecture document (`specs/design-l1.md`) for the Remote Overlay Abstraction is well-structured, internally consistent, and addresses all requirements captured in `specs/define-requirements.md`. All nine functional requirements are traceable to components in the architecture. The four NFRs are met by explicit design decisions. No blocking issues found.

## Evidence Checklist

### FR Coverage

| FR | Architecture Component | Status |
|----|----------------------|--------|
| FR-001: OverlayProvider interface | §1 — `OverlayProvider` interface (`src/types/overlay-protocol.ts`) | PASS |
| FR-002: OverlayDecision + OverlayVerdict | §2 — `OverlayDecision` + `OverlayVerdict` | PASS |
| FR-003: McpClientWrapper (stdio transport) | §5 — `McpClientWrapper` (`src/overlays/mcp/mcp-client.ts`) | PASS |
| FR-004: McpOverlayProvider | §4 — `McpOverlayProvider` with two-tier failure model | PASS |
| FR-005: Config schema (overlay_backends, remote_overlays, governance) | §8 — `src/config/remote-overlay-schema.ts` | PASS |
| FR-006: CANCELLED task state | §9 — `CANCELLED` state + updated `VALID_TRANSITIONS` | PASS |
| FR-007: Engine verdict mapping | §10 — `applyPreDecision` / `applyPostDecision` tables | PASS |
| FR-008: Provider chain builder | §6 — `buildProviderChain` in `src/overlays/registry.ts` | PASS |
| FR-009: Observability events | §11 — Six new event types in `EventType` union | PASS |

### NFR Coverage

| NFR | Architecture Evidence | Status |
|-----|----------------------|--------|
| Composability | Locked chain order enforced at build time; unified `OverlayProvider[]` | PASS |
| Backward compatibility | `LocalOverlayProvider` shim + zero behavioral change without config (§8 backward compat) | PASS |
| Testability | Injectable `clientFactory` in `McpOverlayProvider`; `LocalOverlayProvider` exposes `inner` | PASS |
| Lean | `LocalOverlayProvider` is a thin adapter; no new SDKs beyond already-present MCP SDK | PASS |

### Constraints Verification

| Constraint | Status | Notes |
|-----------|--------|-------|
| Chain order: HIL → Remote → Policy Gate → Review/Paired → Confidence | PASS | §6 explicitly lists this assembly order |
| Single enforcement point for state transitions | PASS | §10 — engine only calls `StateManager.transition()` |
| Remote overlays are pure decision services | PASS | §1 — providers return decisions, never mutate state |
| TypeScript strict mode / no eval() | PASS | String unions used; no eval() mentioned |
| Bun runtime (no Node.js APIs) | PASS | Technology stack table confirms Bun, no Node.js-specific APIs |

### Architectural Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Per-invocation MCP connection overhead | LOW | ADR-002: Acceptable given at-most-two calls per task; no existing path pays this cost |
| Schema violations fail closed regardless of policy | DESIGN DECISION | ADR-003: Intentional security boundary — correctly treated as security issue not infrastructure |
| Post-task HIL treated as REWORK | LOW | §10 footnote explicitly acknowledges this as conservative; FR open decision #5 calls it out |
| CLI sidecar transport stubbed | LOW | Out-of-scope for Phase 1; registry throws explicit unsupported-runtime error (no silent stub) |

### Open Decisions Review

All five open decisions from `specs/define-requirements.md` are correctly addressed or deferred:

1. **CLI sidecar scope** — Architecture confirms `CliOverlayProvider` is NOT built in Phase 1; registry throws `RegistryError` for unsupported runtime. Clean deferral with explicit error.
2. **SKIP verdict** — Not introduced. `CANCELLED` is added as TaskStatus, not an OverlayVerdict. Correctly separated concerns.
3. **governance_mode: enforce promotion** — Schema accepts the field; behavior not wired in Phase 1. No breaking schema change path confirmed.
4. **SSE/HTTP transport** — `McpClientWrapper` validates `transport === "stdio"` and throws `TypeError` for anything else. Clean.
5. **Post-task HIL from remote overlays** — Conservatively mapped to `REWORK`. Explicitly documented in engine verdict mapping table.

## Decision

**GO** — The L1 architecture is complete, requirements-traceable, and ready for L2 component design. No rework required.

Minor suggestions for the L2 phase (non-blocking):
- `McpClientWrapper.connect()` lifecycle should specify whether `disconnect()` is guaranteed on error paths (callers should not need to handle cleanup themselves).
- `mergeContextUpdate` stripping of identity fields (task_id, workflow_id, etc.) should be specified as a Zod transform in L2 to prevent drift from manual list maintenance.
