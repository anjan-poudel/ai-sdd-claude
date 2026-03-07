# Remote Overlay Abstraction — Task Index

**Feature**: Remote Overlay Abstraction (ROA)
**Task count**: 10
**Estimated total**: ~24-36 hours (S=<2h, M=2-4h, L=4-8h)
**Phase**: Phase 1 (local provider chain) + Phase 4 (MCP remote providers)
**All tasks must preserve**: 177 existing tests passing, TypeScript strict mode, no eval()

---

## Task Summary Table

| ID | Title | Estimate | Depends on | Key Files Created/Modified |
|----|-------|----------|------------|---------------------------|
| T001 | Type System Foundation | M | — | `src/types/overlay-protocol.ts` (new), `src/types/index.ts` (add fields) |
| T002 | LocalOverlayProvider | M | T001 | `src/overlays/local-overlay-provider.ts` (new) |
| T003 | McpClientWrapper | M | T001, T007 | `src/overlays/mcp/mcp-client.ts` (new) |
| T004 | McpOverlayProvider | L | T001, T003, T007 | `src/overlays/mcp/mcp-overlay-provider.ts` (new) |
| T005 | Overlay Registry | M | T001, T002, T004, T007 | `src/overlays/registry.ts` (new), `src/overlays/composition-rules.ts` (extend) |
| T006 | Provider Chain Runner | M | T001, T005 | `src/overlays/provider-chain.ts` (new) |
| T007 | Config Schema | M | T001 | `src/config/remote-overlay-schema.ts` (new), config loader + validate-config updated |
| T008 | CANCELLED State | S | — | `src/types/index.ts` (extend), `src/core/state-manager.ts` (update), `src/cli/commands/status.ts` (update) |
| T009 | Engine Wiring | L | T001, T002, T005, T006, T008 | `src/core/engine.ts` (modify), `src/cli/commands/run.ts` (modify) |
| T010 | Observability Events | S | T001, T004 | `src/observability/events.ts` (extend), `src/observability/emitter.ts` (update) |

---

## Dependency Graph

```
T001 (foundation) ──┬──→ T002 (local provider)
                    │          └──────────────────────────────────┐
                    ├──→ T007 (config schema) ─────────────────┐  │
                    │          │                                 │  │
                    ├──→ T003 (mcp client) ─→ T004 (mcp prov.) ─┼──┤
                    │                              │             │  │
                    │                              └─────────────┼──┤
                    │                                            │  │
                    └──→ T005 (registry) ←──────────────────────┘  │
                               ↑ also needs T002, T004, T007        │
                               └──────────────────→ T006 (runner)  │
                                                        └──────────→ T009 (engine)
                                                                        ↑
T008 (CANCELLED) ──────────────────────────────────────────────────────┘

T010 (events) ──← T001 (types), T004 (emission sites)
```

---

## Suggested Implementation Order

For a single developer, implement in this order to minimize blocked work:

1. **T001** — Foundation types (unblocked)
2. **T008** — CANCELLED state (unblocked, independent)
3. **T007** — Config schema (unblocked, needed by T003/T004/T005)
4. **T002** — LocalOverlayProvider (needs T001)
5. **T006** — Provider chain runner (needs T001, T005 — but T005 can be stubbed for unit tests)
6. **T003** — McpClientWrapper (needs T001, T007)
7. **T004** — McpOverlayProvider (needs T001, T003, T007)
8. **T010** — Observability events (needs T001, T004)
9. **T005** — Overlay registry (needs T001, T002, T004, T007)
10. **T009** — Engine wiring (needs all of above — final integration)

---

## Requirements Coverage

| FR/NFR | Covered by |
|--------|-----------|
| FR-001 (OverlayProvider interface) | T001, T002 |
| FR-002 (OverlayDecision contract) | T001, T002, T004 |
| FR-003 (McpClientWrapper) | T003 |
| FR-004 (Provider chain composition) | T005, T006 |
| FR-005 (Config schema) | T007 |
| FR-006 (CANCELLED state) | T008 |
| FR-007 (Engine verdict mapping) | T009 |
| FR-008 (Remote failure handling) | T004 |
| FR-009 (Observability events) | T010 |
| NFR-001 (Performance / timeout) | T003, T006 |
| NFR-002 (Reliability / state integrity) | T006, T008, T009 |
| NFR-003 (Security / no-mutation, schema guard) | T001, T004, T006, T009 |
| NFR-004 (Compatibility / 177 tests) | T001, T002, T005, T007, T008, T009 |

---

## Test Files to Create

| Test file | Task | Type |
|-----------|------|------|
| `tests/overlays/overlay-protocol.test.ts` | T001 | Unit (Zod schema) |
| `tests/overlays/local-overlay-provider.test.ts` | T002 | Unit (mapping + equivalence) |
| `tests/overlays/mcp/mcp-client.test.ts` | T003 | Unit + fixture |
| `tests/overlays/mcp/mcp-overlay-provider.test.ts` | T004 | Unit (mock transport) |
| `tests/overlays/registry.test.ts` | T005 | Unit (chain order + errors) |
| `tests/overlays/provider-chain.test.ts` | T006 | Unit (chain execution) |
| `tests/config/remote-overlay-schema.test.ts` | T007 | Unit + integration (CLI) |
| `tests/cli/status-cancelled.test.ts` | T008 | Integration (CLI command) |
| `tests/observability/remote-overlay-events.test.ts` | T010 | Unit (schema + log level) |
| `tests/overlays/mcp/fixtures/mcp-call-tool-result.json` | T003 | External schema fixture |

Existing files to extend:
- `tests/state-manager.test.ts` — T008 (CANCELLED transitions)
- `tests/engine.test.ts` — T009 (verdict mapping + integration wiring)
- `tests/overlays/composition-matrix.test.ts` — T005 (Invariant 6)
