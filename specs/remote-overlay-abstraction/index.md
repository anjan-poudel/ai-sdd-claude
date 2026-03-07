# Requirements — Remote Overlay Abstraction

## Summary
- Functional requirements: 9
- Non-functional requirements: 4
- Areas covered: Overlay Abstraction, MCP Transport, Overlay Orchestration, Configuration, Task State Machine, Workflow Engine, Reliability / Error Handling, Observability, Performance, Security, Compatibility

## Contents
- [FR/index.md](FR/index.md) — functional requirements
- [NFR/index.md](NFR/index.md) — non-functional requirements

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
