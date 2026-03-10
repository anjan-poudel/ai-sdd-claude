# L2 Component Design Review — Remote Overlay Abstraction

**Task:** review-l2
**Reviewed artifact:** `specs/remote-overlay-abstraction/component-design-l2.md` (1626 lines)
**L1 reference:** `.ai-sdd/outputs/design-l1.md`
**Requirements:** `specs/remote-overlay-abstraction/FR/*.md`, `NFR/*.md`
**Reviewer:** sdd-reviewer (ai-sdd workflow)
**Review date:** 2026-03-07

---

## Summary

The L2 component design document is thorough, internally consistent, and correctly translates the L1 architecture into implementable component specifications. All 12 components (A–L) are fully designed with TypeScript signatures, implementation notes, and test requirements. The design preserves the key invariants (engine as single enforcement point, chain order locked, schema-over-policy failure hierarchy) and is ready for implementation with the observations noted below.

**Decision: GO**

---

## Requirements Coverage Check

| Requirement | L2 Component | Coverage | Status |
|-------------|-------------|----------|--------|
| FR-001: OverlayProvider interface | Component A (`overlay-protocol.ts`) | OverlayProvider interface with id/runtime/hooks/enabled/phases and optional invokePre/invokePost | PASS |
| FR-002: OverlayDecision contract | Component A | OverlayDecision, OverlayVerdict (string union), OverlayEvidence, OverlayInvokeOutputSchema | PASS |
| FR-003: McpClientWrapper | Component E (`mcp-client.ts`) | McpClientWrapper with connect/disconnect/callTool, McpTimeoutError, McpNotConnectedError, McpSchemaError | PASS |
| FR-004: Provider chain composition | Components C (`registry.ts`) + D (`provider-chain.ts`) | buildProviderChain + runPreProviderChain / runPostProviderChain with phase filtering and short-circuit | PASS |
| FR-005: Config schema | Component G (`remote-overlay-schema.ts`) | OverlayBackendConfigSchema, RemoteOverlayConfigSchema, GovernanceConfigSchema; Zod refinement for mcp+tool | PASS |
| FR-006: CANCELLED task state | Component H (`types/index.ts`) | CANCELLED added to TaskStatus; VALID_TRANSITIONS updated; StateManager isTerminal() and completed_at updated | PASS |
| FR-007: Engine verdict mapping | Component I (`engine.ts`) | Exhaustive switch on OverlayVerdict → PASS/REWORK/FAIL/HIL with `never` cast; evidence persistence | PASS |
| FR-008: Remote failure handling | Components E + F | Two-tier (transport vs schema); failure_policy applied for Tier 1; always FAIL for Tier 2; blocking:false override | PASS |
| FR-009: Observability events | Components J (`events.ts`) + F | Six event schemas with .passthrough(); EventType union updated; level mapping noted | PASS |

All 9 FRs are addressed in sufficient detail for implementation.

---

## NFR / Constraint Compliance

| NFR / Constraint | Assessment | Status |
|-----------------|------------|--------|
| NFR-001 Performance | Per-component overhead budgets provided in Performance Design section; phase filter fast path documented | PASS |
| NFR-002 Reliability | Provider chain catch path normalizes unhandled errors to FAIL decision; disconnect() in finally block | PASS |
| NFR-003 Security | Four enforcement points documented; Zod at wire boundary; identity field stripping in mergeContextUpdate; no state writes in overlays/ | PASS |
| NFR-004 Compatibility | 177 existing tests as Phase 1 exit gate; LocalOverlayProvider wraps without behavioral change; old functions preserved | PASS |
| No eval() | No eval() anywhere in proposed code | PASS |
| TypeScript strict mode | No `any`, exhaustive switch with `never` cast, string unions not enums | PASS |
| Bun runtime | Uses Bun.spawn for CLI, import.meta.url not __dirname, Bun timer compatibility noted | PASS |
| Chain order locked | Registry build algorithm enforces order; validateProviderCombination extension checks Invariant 6 | PASS |
| Single enforcement point | Engine's applyPreDecision is the only place stateManager.transition() is called from verdict mapping | PASS |

---

## Component-by-Component Assessment

### A. overlay-protocol.ts — PASS
Clean foundational types. OverlayVerdict as string union (not enum) correctly enables TypeScript exhaustiveness in switch statements. OverlayInvokeOutputSchema with Zod literal("1") for protocol_version correctly handles version mismatches. The note about OverlayContext duplication from base-overlay.ts with "do not delete the old one" is the right call for Phase 1.

**Minor observation**: The design embeds `OverlayProvider` interface directly in `overlay-protocol.ts` rather than the separate `src/overlays/provider.ts` file that appears in L1 §3.1. This consolidation is acceptable and simplifies imports, but the implementation should confirm that `provider.ts` either forwards the type or is eliminated from the module plan without breaking references.

### B. local-overlay-provider.ts — PASS
Mapping logic is complete and correct. The special case for `PostTaskOverlayResult.new_status: "COMPLETED"` → TypeError is well-justified (the engine, not the overlay, decides COMPLETED). Hook detection at construction time with the "at least one hook" invariant matches FR-001 requirements. The `inner` property pattern for HIL overlay lookup is clean.

**Minor observation**: The design notes `invokePre` and `invokePost` are "conditionally assigned in the constructor (not optional chaining)". Implementors should note this means using `Object.defineProperty` or assigning `undefined` explicitly rather than relying on the declared optional signature — the intent should be that `"pre_task" in provider.hooks` is the canonical check, not `typeof provider.invokePre === "function"`. This distinction matters for providers that may have one but not the other hook.

### C. registry.ts — PASS
Chain build algorithm (steps 1–9) correctly enforces the locked order. RegistryError with the named invariant messages follows CLAUDE.md §Error messages are contracts. The note that `buildProviderChain` is a pure function (not class method) is the correct design choice for testability.

**Minor observation**: Step 5 in the build algorithm checks `both Review and Paired enabled` but only when both are provided via `localOverlays.review` and `localOverlays.paired`. If either is `undefined` (not configured), the check is naturally skipped. This edge case is handled implicitly but should be confirmed at implementation time (a `undefined` overlay passed to `buildProviderChain` should simply be absent from the chain).

### D. provider-chain.ts — PASS
Execution algorithm is correct and symmetric for pre/post chains. The unhandled-exception catch path converting provider errors to FAIL decisions correctly fulfills NFR-002. The `mergeContextUpdate` with IDENTITY_FIELDS set is the right implementation of the no-mutation invariant. The note that `runPreTaskChain`/`runPostTaskChain` are NOT deleted correctly preserves backward compatibility.

**Minor observation**: The algorithm says "Phase filter: `provider.phases` undefined → always included" but the Implementation Notes say the opposite case ("task has no phase AND provider has phases filter → skip"). These two cases are complementary and both correct; the test matrix covers both. Worth verifying at implementation time that both conditions are tested.

### E. mcp-client.ts — PASS
Interface is well-designed. McpTimeoutError and McpNotConnectedError have actionable error messages as required by CLAUDE.md §Error messages are contracts. The "Decision required" note about `CallToolResult` unwrapping is honest and correctly defers to implementation-time SDK inspection with a real fixture requirement (CLAUDE.md §External schema fixtures).

**Observation (blocking during implementation)**: The MCP SDK `callTool` response unwrapping decision must be resolved before writing production code. The design correctly calls this out as Open Question #1. The external schema fixture test is required by CLAUDE.md §4 and must be the first test written for this component.

### F. mcp-overlay-provider.ts — PASS
Invocation algorithm is correct. The `blocking: false` override (`effectivePolicy` logic) is explicitly handled and matches FR-008. The disconnect-in-finally pattern for clean lifecycle management is correct. The test matrix covers all required combinations per FR-008 acceptance criteria.

**Minor observation**: The algorithm has `finally: await client.disconnect()` AND a `catch` branch that also calls `disconnect()`. This means disconnect is called twice on transport error (once in catch, once in finally). Since `disconnect()` is documented as a no-op when not connected, this is harmless but slightly confusing. Implementors should confirm the SDK client handles double-close gracefully, or restructure to only disconnect once.

### G. remote-overlay-schema.ts — PASS
Zod schemas are complete and correct. The `.refine()` for mcp+tool validation is the right approach. The integration pattern (parse separately, not into ProjectConfig until Phase 1 is done) correctly protects the 177 existing tests.

**Open Question #2** (governance in ProjectConfig) is correctly identified and the recommendation is sound: add as optional field to ProjectConfig to keep config merge semantics unified.

### H. CANCELLED state — PASS
Changes are purely additive. StateManager `isTerminal()` and `completed_at` updates are complete. The CLI status display requirement is correctly included (distinct visual marker for CANCELLED vs FAILED). The note about auditing all switch(TaskStatus) statements for exhaustiveness is essential and correctly calls out `bun run typecheck` as the detection mechanism.

### I. engine.ts — PASS
The exhaustive switch with `never` cast in `applyPreDecision` is the correct pattern and matches CLAUDE.md requirements. Evidence persistence via `overlay_evidence` on TaskState is additive. The HIL overlay lookup change (`(provider as LocalOverlayProvider).inner`) is correctly identified as the adapter lookup pattern.

**Minor observation**: The design shows `applyPreDecision` returning `"NEEDS_REWORK"` AND immediately transitioning back to `RUNNING` within the same method. This mirrors existing behavior but the two-transition pattern (RUNNING → NEEDS_REWORK → RUNNING) should be verified against the state machine tests to confirm VALID_TRANSITIONS allows this in a single engine tick without the outer `runTaskIteration` loop intervening.

### J. events.ts — PASS
All six event schemas follow the existing `.passthrough()` pattern. The level mapping note for `overlay.remote.fallback` → INFO vs WARN is an implementation-time decision correctly flagged for audit. All schemas are additive to the EventType union.

### K. composition-rules.ts — PASS
Invariant 6 implementation correctly uses `findIndex` and `reduce` to detect ordering violations. The new function `validateProviderCombination` is separate from the existing `validateOverlayCombination` (not overloading it), which is the safer design choice that avoids breaking existing callers.

### L. TaskDefinition extensions — PASS
All fields are optional. The string union for `phase` (not `string`) is correct for phase filtering. The `GatedHandoverState` interface is a clean addition. The note about `[key: string]: unknown` in workflow-loader making these parse through is important — verify the current `TaskDefinition` type indeed has this index signature or that `workflow-loader.ts` uses `as unknown as TaskDefinition` casting.

---

## Test Coverage Assessment

The test matrix across all 12 components covers:
- All per CLAUDE.md §1 config-to-behavior tests (especially Component G `failure_policy` config-to-behavior test)
- Integration point tests (Component I engine wiring test, Component B equivalence test)
- No silent stubs (Components B, C, D all have explicit error paths)
- External schema fixtures (Component E mcp-client has explicit fixture requirement)
- Error messages as contracts (all custom Error classes have named assertions)
- One integration test per CLI command (Component H includes `tests/cli/status-cancelled.test.ts`)

Total new test files required: 10 new files + extensions to 3 existing files. This is proportionate to the feature scope.

---

## Cross-Cutting Observations (non-blocking)

1. **`OverlayProvider` interface location**: L1 §3.1 defines a separate `src/overlays/provider.ts`. The L2 design embeds the interface in `overlay-protocol.ts` (Component A). This consolidation is acceptable but the module plan should be updated to reflect that `provider.ts` is eliminated, not just that `overlay-protocol.ts` exports the interface. Avoid creating an empty `src/overlays/provider.ts` file (CLAUDE.md §6: no empty directories/files).

2. **CliOverlayProvider**: The design correctly defers CliOverlayProvider to a separate addendum (Open Question #3). The registry's Phase 1 build algorithm skips the remote section when `remoteConfig` is absent, so Phase 1 can ship without CliOverlayProvider. This is the right sequencing.

3. **Schema version**: Open Question #4 (adding `overlay_evidence` to TaskState without schema version bump) is correctly assessed as additive-only (optional field, no migration). Confirming this is appropriate given `schema_version: "1"` semantics.

4. **CI static checks**: The grep checks in Security Design (`grep -rn "eval("` and `grep -rn "writeFileSync"`) are simple and effective. Adding them to CI is correct and should be part of the implementation PR.

---

## Open Questions Requiring Resolution Before Implementation

1. **MCP SDK `CallToolResult` unwrapping** — Must be resolved with a real fixture test against the installed `@modelcontextprotocol/sdk` version before writing `mcp-client.ts`. (Non-blocking for Phase 1; blocking for Phase 4.)

2. **`governance` block in `ProjectConfig`** — The recommendation to add as optional field is correct. Confirm at implementation start of Component G.

---

## Decision

decision: GO

All 12 components are correctly designed, aligned with L1 architecture, and satisfy all 9 FRs. The test matrices are complete and follow CLAUDE.md development standards. Backward compatibility strategy is sound. Implementation may proceed with Phase 1 (Components A, B, C, D, I, J, K, L) immediately.
