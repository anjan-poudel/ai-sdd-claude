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
| [ROA-T-001](../remote-overlay-abstraction/tasks/ROA-T-001-overlay-protocol-types.md) | Overlay Protocol Types | S | MEDIUM | COMPLETE |
| [ROA-T-002](../remote-overlay-abstraction/tasks/ROA-T-002-cancelled-task-state.md) | CANCELLED Task State | S | MEDIUM | COMPLETE |
| [ROA-T-003](../remote-overlay-abstraction/tasks/ROA-T-003-remote-overlay-config-schema.md) | Remote Overlay Config Schema | S | LOW | COMPLETE |
| [ROA-T-004](../remote-overlay-abstraction/tasks/ROA-T-004-local-overlay-provider.md) | LocalOverlayProvider | S | HIGH | COMPLETE |
| [ROA-T-005](../remote-overlay-abstraction/tasks/ROA-T-005-mcp-client-wrapper.md) | McpClientWrapper | M | HIGH | COMPLETE — JSDoc gap open |
| [ROA-T-006](../remote-overlay-abstraction/tasks/ROA-T-006-mcp-overlay-provider.md) | McpOverlayProvider | M | HIGH | COMPLETE — skip-policy assertion gap open |
| [ROA-T-007](../remote-overlay-abstraction/tasks/ROA-T-007-provider-chain-and-registry.md) | Provider Chain and Registry | M | HIGH | COMPLETE |
| [ROA-T-008](../remote-overlay-abstraction/tasks/ROA-T-008-engine-integration.md) | Engine Integration | L | HIGH | COMPLETE — wiring test and overlay_evidence gaps open |
| [ROA-T-009](../remote-overlay-abstraction/tasks/ROA-T-009-state-manager-cancelled-tests.md) | State Manager CANCELLED Tests | S | LOW | COMPLETE |
| [ROA-T-010](../remote-overlay-abstraction/tasks/ROA-T-010-observability-event-log-levels.md) | Observability Event Log Levels | S | LOW | COMPLETE |
| [ROA-T-011](../remote-overlay-abstraction/tasks/ROA-T-011-integration-and-regression-tests.md) | Integration and Regression Tests | M | MEDIUM | OPEN |

Full task files: `specs/remote-overlay-abstraction/tasks/ROA-T-001` through `ROA-T-011`.

See `specs/remote-overlay-abstraction/task-breakdown-l3.md` for the complete breakdown
including dependency graph, open gaps, L2 review recommendation disposition, and NFR
coverage table.
