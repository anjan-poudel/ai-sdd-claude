# NFR-004: Backward Compatibility — Existing Tests, Config, and Behavior

## Metadata
- **Category:** Compatibility
- **Priority:** MUST

## Description

The remote overlay abstraction must be introduced without breaking any existing behavior.
Projects that do not configure `overlay_backends` or `remote_overlays` must experience zero
behavioral change. The 177-test suite must pass without modification. Protocol versioning
must protect both sides of the MCP boundary from uncoordinated changes.

## Acceptance criteria

Numeric targets:

| Property | Target | Condition |
|----------|--------|-----------|
| Existing test suite | 177/177 tests pass, unmodified | After all Phase 1 changes |
| Config compatibility | Zero errors or warnings on existing `.ai-sdd/ai-sdd.yaml` that omits new keys | Absence of overlay_backends, remote_overlays, governance is valid |
| LocalOverlayProvider behavioral equivalence | 100% identical verdicts, feedback, and evidence | Same inputs to LocalOverlayProvider vs direct BaseOverlay invocation |
| Protocol version mismatch | Hard error (FAIL), not silent acceptance | `z.literal("1")` Zod constraint; not overrideable by failure_policy |
| MCP SDK dependency | Uses `@modelcontextprotocol/sdk` already present in package.json | No new external dependencies added |
| Bun runtime | All new code runs under Bun without Node.js-specific APIs | No `require()`, `__dirname`, `process.mainModule` |
| TypeScript strict mode | All new files pass `tsc --noEmit` with strict mode | No `any` types without justification |

```gherkin
Feature: Backward compatibility

  Scenario: Existing config without new keys loads without errors
    Given a .ai-sdd/ai-sdd.yaml that contains no overlay_backends, remote_overlays, or governance keys
    When the config loader parses the file
    Then no errors or warnings are produced
    And the engine behaves identically to pre-feature behavior

  Scenario: LocalOverlayProvider produces identical verdicts to direct invocation
    Given a BaseOverlay instance that returns a specific OverlayResult for a given input
    And a LocalOverlayProvider wrapping the same instance
    When both are called with identical OverlayContext inputs
    Then the OverlayDecision verdict from the provider equals the directly mapped verdict
    And feedback and evidence fields are equivalent

  Scenario: Protocol version "2" is a hard error regardless of failure_policy
    Given a remote MCP server that returns protocol_version "2"
    When McpOverlayProvider processes the response
    Then Zod validation fails (z.literal("1") constraint)
    And the engine receives OverlayDecision with verdict "FAIL"
    And this is not affected by the configured failure_policy

  Scenario: All 177 existing tests pass unchanged after all Phase 1 changes
    Given the full test suite at tests/
    When "bun test" is run after Phase 1 changes
    Then exactly 177 tests pass
    And 0 tests fail
    And no test file is modified

  Scenario: TypeScript strict mode compilation succeeds after Phase 1 changes
    Given all new source files added by this feature
    When "bun run typecheck" is executed
    Then the command exits with code 0
    And no type errors are reported
```

## Related
- FR: FR-001 (LocalOverlayProvider must not break existing behavior), FR-004 (chain composition preserves existing rules), FR-005 (config schema is strictly additive)
