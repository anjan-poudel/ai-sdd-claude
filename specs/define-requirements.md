# Requirements — Remote Overlay Abstraction

## Summary
- Functional requirements: 9
- Non-functional requirements: 4
- Areas covered: Overlay Abstraction, MCP Transport, Overlay Orchestration, Configuration, Task State Machine, Workflow Engine, Reliability / Error Handling, Observability, Performance, Security, Compatibility

## Contents
- [specs/remote-overlay-abstraction/index.md](remote-overlay-abstraction/index.md) — top-level requirements index
- [specs/remote-overlay-abstraction/FR/index.md](remote-overlay-abstraction/FR/index.md) — functional requirements (9 FRs)
- [specs/remote-overlay-abstraction/NFR/index.md](remote-overlay-abstraction/NFR/index.md) — non-functional requirements (4 NFRs)

## Functional Requirements

| ID | Title | Area | Priority |
|----|-------|------|----------|
| [FR-001](remote-overlay-abstraction/FR/FR-001-overlay-provider-interface.md) | Overlay Provider Interface | Overlay Abstraction | MUST |
| [FR-002](remote-overlay-abstraction/FR/FR-002-overlay-decision-contract.md) | Overlay Decision Contract | Overlay Abstraction | MUST |
| [FR-003](remote-overlay-abstraction/FR/FR-003-mcp-client-wrapper.md) | MCP Client Wrapper | MCP Transport | MUST |
| [FR-004](remote-overlay-abstraction/FR/FR-004-provider-chain-composition.md) | Provider Chain Composition | Overlay Orchestration | MUST |
| [FR-005](remote-overlay-abstraction/FR/FR-005-config-schema.md) | Configuration Schema | Configuration | MUST |
| [FR-006](remote-overlay-abstraction/FR/FR-006-cancelled-task-state.md) | CANCELLED Task State | Task State Machine | MUST |
| [FR-007](remote-overlay-abstraction/FR/FR-007-engine-verdict-mapping.md) | Engine Verdict Mapping | Workflow Engine | MUST |
| [FR-008](remote-overlay-abstraction/FR/FR-008-remote-failure-handling.md) | Remote Failure Handling | Reliability / Error Handling | MUST |
| [FR-009](remote-overlay-abstraction/FR/FR-009-observability-events.md) | Observability Events | Observability | MUST |

## Non-Functional Requirements

| ID | Title | Category | Priority |
|----|-------|----------|----------|
| [NFR-001](remote-overlay-abstraction/NFR/NFR-001-performance.md) | Remote Overlay Latency | Performance | MUST |
| [NFR-002](remote-overlay-abstraction/NFR/NFR-002-reliability.md) | Reliability and Fault Tolerance | Reliability | MUST |
| [NFR-003](remote-overlay-abstraction/NFR/NFR-003-security.md) | Security and Secret Handling | Security | MUST |
| [NFR-004](remote-overlay-abstraction/NFR/NFR-004-compatibility.md) | Backward Compatibility | Compatibility | MUST |

## Open decisions

1. **CLI sidecar transport scope**: The constitution marks `CliOverlayProvider` as out of scope (constitution.md §Out of scope), while REMOTE-OVERLAY-PLAN.md Phase 3 includes it as the pragmatic first transport (ROA-009). These requirements capture both `McpOverlayProvider` (in scope per constitution) and `CliOverlayProvider` (described in REMOTE-OVERLAY-PLAN.md). The implementing architect must confirm which transport to build first before Phase 3 begins.

2. **SKIP verdict**: The task brief references a SKIP verdict and CANCELLED as its triggered state. REMOTE-OVERLAY-PLAN.md uses only four verdicts (PASS, REWORK, FAIL, HIL) and maps CANCELLED to manual/governance FAIL scenarios. FR-006 and FR-007 do not require a SKIP verdict; they require CANCELLED as a reachable state. This alignment should be confirmed before implementation.

3. **`governance_mode: enforce` promotion path**: The current requirements cover `warn` mode only. The transition from `warn` to `enforce` is out of scope for this release but the config schema (FR-005) must be designed to accommodate it without breaking changes.

4. **SSE transport**: FR-003 explicitly excludes SSE as a transport. If SSE support is required before Phase 3 is complete, FR-003 must be revised.

## Out of scope

The following are explicitly excluded from this release:

- Merging `coding-standards`' 15-state workflow state machine into ai-sdd
- Running `coding-standards`' graph/lock tools directly from the engine (bypassing `overlay.invoke`)
- Remote overlays writing artifacts or mutating ai-sdd state
- `governance_mode: enforce` promotion (future release)
- SSE and HTTP MCP transport modes
- The `overlay.invoke` MCP facade implementation on the `coding-standards` server side (tracked separately)
- Planning review as a remote pre-task overlay (future work)
- Release readiness evaluation as a remote post-workflow overlay (future work)
- Language-specific standards from coding-standards (`java/`, `kotlin/`)
