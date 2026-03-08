# Requirements — Remote Overlay Abstraction

## Summary
- Functional requirements: 9
- Non-functional requirements: 4
- Areas covered: Overlay Abstraction, MCP Transport, Overlay Orchestration, Configuration, Task State Machine, Workflow Engine, Reliability / Error Handling, Observability, Performance, Security, Compatibility

## Contents
- [FR/index.md](FR/index.md) — functional requirements
- [NFR/index.md](NFR/index.md) — non-functional requirements

## Open decisions

1. **CLI sidecar transport scope**: `constitution.md` marks the CLI sidecar transport as out of scope for this release (`"CLI sidecar transport (future work)"`). The config schema (`FR-005`) includes `runtime: z.enum(["cli", "mcp"])` and `McpClientWrapper` references `CliOverlayProvider` in some error messages. The implementing architect must confirm whether `CliOverlayProvider` is to be built in Phase 1 or stubbed with an explicit unsupported-runtime error (the current registry does the latter). These requirements treat `McpOverlayProvider` as the only concrete remote provider for this release.

2. **SKIP verdict**: These requirements do not introduce a `SKIP` `OverlayVerdict`. `CANCELLED` is added as a terminal `TaskStatus` reachable via manual operator action or future governance decisions. If a `SKIP` verdict is required by the coding-standards overlay, `OverlayVerdict` and `FR-007` must be revised before implementation begins.

3. **`governance_mode: enforce` promotion**: The `governance.requirements_lock` config field (FR-005) accepts `"off" | "warn" | "enforce"`. Current requirements cover the `"warn"` behavior only. Promotion to `"enforce"` is out of scope for this release but the schema must not require breaking changes when it is added.

4. **SSE/HTTP transport**: FR-003 explicitly limits MCP transport to `stdio`. If SSE or HTTP transport is required before Phase 3, FR-003 and `McpClientWrapper` must be revised to accept those values.

5. **Post-task HIL from remote overlays**: FR-007 specifies that a `HIL` verdict from the post-task chain is conservatively treated as `REWORK`. If remote post-task overlays need to trigger true human-in-the-loop gating, this requires a dedicated design pass and schema change.

## Out of scope

The following are explicitly excluded from this release:

- Merging coding-standards' 15-state workflow state machine into ai-sdd
- Running coding-standards' graph/lock tools directly from the engine (bypassing `overlay.invoke`)
- Remote overlays writing artifacts or mutating ai-sdd state directly
- `governance_mode: enforce` promotion (future release)
- SSE and HTTP MCP transport modes
- `CliOverlayProvider` concrete implementation (config schema accepts `"cli"` runtime; actual provider is future work)
- The `overlay.invoke` MCP facade implementation on the coding-standards server (tracked in that repo)
- Planning review as a remote pre-task overlay (future work)
- Release readiness evaluation as a remote post-workflow overlay (future work)
