# NFR-004: Compatibility

## Metadata
- **Category:** Compatibility
- **Priority:** MUST

## Description

The remote overlay abstraction must be introduced without breaking any existing behavior. Projects that do not configure `overlay_backends` or `remote_overlays` must experience zero behavioral change. The existing 177-test suite must pass without modification. Protocol versioning must protect both sides of the MCP boundary from uncoordinated changes.

## Targets

| Compatibility property | Target | Condition |
|----------------------|--------|-----------|
| Existing test suite | 177/177 tests pass, unmodified | After all Phase 1 changes (LocalOverlayProvider, engine refactor) |
| Existing config compatibility | Zero errors or warnings on any existing .ai-sdd/ai-sdd.yaml that omits new keys | Absence of overlay_backends/remote_overlays/governance is valid |
| Local overlay behavior | 100% behavioral equivalence of LocalOverlayProvider vs direct BaseOverlay invocation | Same verdicts, same feedback, same evidence, same timing characteristics |
| Protocol version field | Any mismatch between ai-sdd's expected version ("1") and remote server's version must hard error | Not silently accepted or ignored |
| MCP SDK dependency | Uses @modelcontextprotocol/sdk already present in the project | No new external dependencies beyond the SDK |
| Bun runtime | All new code runs under Bun without Node.js-specific APIs | No use of `require()`, `process.mainModule`, `__dirname` (use `import.meta.url` instead) |
| TypeScript strict mode | All new source files pass `tsc --noEmit` with strict mode | No `any` types, no `!` non-null assertions without justification |

## Verification

1. Regression test: run `bun test` after Phase 1 changes; assert 177 pass, 0 fail.
2. Equivalence test: for each existing BaseOverlay, construct a `LocalOverlayProvider` wrapping it and call `invokePre`/`invokePost` with identical inputs; assert `OverlayDecision` verdict matches the mapped result of calling the overlay directly.
3. Config compatibility test: load an existing `.ai-sdd/ai-sdd.yaml` fixture that pre-dates the feature; assert no warnings or errors about unknown keys.
4. Protocol version mismatch test: configure a mock MCP server that returns `protocol_version: "2"`; assert the engine produces a hard error (not a fallback or warning).
5. Static check (CI): `bun run typecheck` must exit 0 after all new files are added.
6. Dependency check: `cat package.json | grep modelcontextprotocol` must show the SDK is already listed; no new entry must be added.

```gherkin
Feature: Backward compatibility

  Scenario: Existing config without remote overlay keys loads without errors
    Given a .ai-sdd/ai-sdd.yaml that contains no overlay_backends, remote_overlays, or governance keys
    When the config loader parses the file
    Then no errors or warnings are produced
    And the engine runs with existing overlay behavior unchanged

  Scenario: LocalOverlayProvider produces identical verdicts to direct invocation
    Given a BaseOverlay instance that returns a specific OverlayResult
    And a LocalOverlayProvider wrapping the same instance
    When both are called with identical OverlayContext inputs
    Then the OverlayDecision from the provider has the same verdict as the mapped direct result
    And feedback and evidence fields are equivalent

  Scenario: Protocol version mismatch is a hard error
    Given a remote MCP server that returns protocol_version "2"
    When McpOverlayProvider processes the response
    Then it throws a hard error naming the version mismatch
    And the engine transitions the task to FAILED
    And this is not affected by failure_policy

  Scenario: All 177 existing tests pass unchanged
    Given the full test suite at tests/*.test.ts
    When "bun test" is run after all Phase 1 changes
    Then 177 tests pass
    And 0 tests fail
    And no test file is modified

  Scenario: TypeScript strict mode compilation succeeds
    Given all new source files added by this feature
    When "bun run typecheck" is executed
    Then the command exits with code 0
    And no type errors are reported
```

## Related
- FR: FR-001 (OverlayProvider interface must not break existing code), FR-004 (chain composition preserves existing rules), FR-005 (config schema is additive)
