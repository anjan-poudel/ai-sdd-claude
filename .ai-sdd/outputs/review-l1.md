# L1 Architecture Review — Remote Overlay Abstraction

**Task:** review-l1
**Reviewed artifact:** `.ai-sdd/outputs/design-l1.md`
**Reviewer:** sdd-reviewer (ai-sdd workflow)
**Review date:** 2026-03-07

---

## Summary

The L1 architecture document for the Remote Overlay Abstraction is well-structured, internally consistent, and addresses all functional requirements from the define-requirements phase. All 9 FRs and relevant NFRs are covered. The key architectural decisions are sound, backward-compatibility guarantees are clearly articulated, and the two-tier failure model (transport vs schema) provides strong security guarantees. Proceeding to L2 component design is appropriate with minor guidance notes for L2 authors.

---

## Requirements Coverage Check

| Requirement | Coverage in L1 | Status |
|-------------|---------------|--------|
| FR-001: OverlayProvider interface | Section 3.1 — `src/overlays/provider.ts`, defines the interface with id/runtime/hooks/enabled/phases and invokePre/invokePost methods | PASS |
| FR-002: OverlayDecision contract | Section 3.1 — `src/types/overlay-protocol.ts` exports OverlayDecision, OverlayVerdict, OverlayInvokeOutput; Zod validation stated | PASS |
| FR-003: McpClientWrapper | Section 3.1 — `src/overlays/mcp/mcp-client.ts` with McpClientWrapper, McpTimeoutError, McpNotConnectedError | PASS |
| FR-004: Provider chain composition | Section 3.1 — registry.ts + provider-chain.ts; chain order locked in Section 6; composition-rules.ts extended | PASS |
| FR-005: Config schema | Section 7 — `src/config/remote-overlay-schema.ts` with overlay_backends + remote_overlays; Zod schemas | PASS |
| FR-006: CANCELLED task state | Section 3.2 + 4.3 — CANCELLED added to TaskStatus; reachable from all non-terminal states; terminal | PASS |
| FR-007: Engine verdict mapping | Section 4.1 + 3.2 — exhaustive switch on OverlayVerdict; PASS/REWORK/FAIL/HIL mappings defined | PASS |
| FR-008: Remote failure handling | Section 4.2 — two-tier failure model (transport vs schema); failure_policy skip/warn/fail_closed; schema always fail_closed | PASS |
| FR-009: Observability events | Section 9 — six events listed with emitter, key payload fields; secret redaction mentioned | PASS |

All 9 FRs are addressed.

---

## NFR / Constraint Compliance

| NFR / Constraint | Assessment |
|-----------------|------------|
| Backward compatibility (177 tests pass) | Explicitly stated as Phase 1 exit gate in Section 11; LocalOverlayProvider wraps BaseOverlay with identity mapping; old functions preserved | PASS |
| Transport agnosticism | `OverlayProvider` interface defined in Section 3.1; engine sees only OverlayDecision | PASS |
| Single enforcement point | Section 2 and 4.1 explicitly state: engine is sole enforcement point; no provider writes state | PASS |
| No-mutation invariant | Section 10 security table — updated_context guard; Section 4.2 — remote overlays return verdicts only | PASS |
| Chain order locked | Section 6 — invariant stated; registry.ts enforces at build time; composition-rules.ts validates | PASS |
| Lean / minimal abstractions | 5 new modules + 4 modified; no gratuitous abstractions; LocalOverlayProvider wraps existing without rewrite | PASS |

---

## Architectural Risk Assessment

### Strengths

1. **Clean abstraction boundary** — The `OverlayProvider` interface elegantly separates transport concerns from chain execution logic. The engine remaining unaware of transport type is the correct design.

2. **Two-tier failure model** — Separating transport errors (policy-governed) from schema violations (always fail_closed) is a strong security design. This prevents rogue remotes from silently bypassing governance via malformed responses.

3. **LocalOverlayProvider as adapter** — Wrapping existing BaseOverlay with identity mapping means zero behavioral change for all existing overlays. This is the safest possible migration path.

4. **CliOverlayProvider as first transport** — Starting with CLI subprocess before MCP client is pragmatic; it provides immediate value while avoiding MCP complexity during initial phases.

5. **Chain order invariance** — Locking the chain order (HIL → Remote → Policy Gate → ...) and enforcing it at registry build time prevents misconfiguration that could bypass governance.

### Minor Observations for L2 (no rework required)

1. **Event naming canonicalization** — Section 9 uses `overlay.remote.*` naming while the constitution deliverables reference `remote_overlay.invoked`. L2 should canonicalize to `overlay.remote.*` (consistent with Section 9 and the dot-separated `task.started` pattern).

2. **CANCELLED CLI display** — FR-006 requires CANCELLED to be visually distinct from FAILED in `ai-sdd status`. The L1 doc does not address CLI display. L2 CANCELLED component design should include this.

3. **`blocking: false` interaction** — FR-008 specifies that `blocking: false` overrides transport-tier failure_policy to always `warn`. This is not explicitly called out in L1. L2 McpOverlayProvider design should make this explicit.

4. **CliOverlayProvider stdout/stderr handling** — L2 should clarify how the CLI provider distinguishes transport failures (non-zero exit + no stdout) from schema failures (zero exit + invalid JSON stdout).

---

## Decision

decision: GO

---

## Approval

All requirements are addressed. Architectural principles are sound. Backward compatibility strategy is correct. No blocking issues found. Proceed to `design-l2`.
