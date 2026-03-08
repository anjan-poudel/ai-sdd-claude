# ROA-T-011: Integration and Regression Tests

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Test coverage — cross-cutting
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** ROA-T-002, ROA-T-003, ROA-T-004, ROA-T-005, ROA-T-006, ROA-T-007, ROA-T-008, ROA-T-009, ROA-T-010
- **Blocks:** —
- **Requirements:** NFR-002, NFR-003, NFR-004
- **Status:** PARTIAL — most unit tests exist; skip-policy no-failed assertion, chain-builder integration test, and status CLI integration test for CANCELLED are open gaps

## Description

This task captures the remaining integration test gaps identified in the L2 design and
the L2 review recommendations. All source code is implemented by preceding tasks; this
task closes the test coverage gaps.

### Open gaps to address

1. **Skip-policy event isolation test** (review-l2 highest priority recommendation):
   In `tests/overlays/mcp/mcp-overlay-provider.test.ts`, test 7 currently asserts that
   `overlay.remote.fallback` IS emitted for `failure_policy: "skip"` but does NOT assert
   that `overlay.remote.failed` is NOT emitted. Add an explicit assertion:
   ```typescript
   const failedEvent = events.find(e => e.type === "overlay.remote.failed");
   expect(failedEvent).toBeUndefined();
   ```

2. **Chain-builder integration test** (review-l2 Recommendation 4 + Development Standards §2):
   In `tests/engine.test.ts` (extended), add a test that constructs an `Engine` with a chain
   built by `buildProviderChain` and verifies the chain is passed to `runPreProviderChain`
   when a task runs. This is the wiring test — unit tests of each component in isolation are
   insufficient for this invariant.

3. **`ai-sdd status` CANCELLED CLI integration test** (review-l2 Recommendation 5 +
   Development Standards §7): In `tests/cli/` (new or extended), add an end-to-end test that:
   - Creates a project with a workflow that has one CANCELLED task and one FAILED task.
   - Runs `ai-sdd status` against that state.
   - Asserts `⊘` appears for the CANCELLED task and `✗` appears for the FAILED task.
   - Asserts the summary line includes a separate CANCELLED count.

4. **`overlay_evidence` in `ai-sdd status --json`** (review-l2 Recommendation 6):
   In `tests/cli/` or `tests/engine.test.ts`, verify that when a task's `TaskState` has
   `overlay_evidence`, the `--json` output of `ai-sdd status` includes it (not stripped
   by the serializer).

5. **Backward compatibility gate** (NFR-004):
   `bun test` must report exactly 505 (or more) tests passing with 0 failures after all
   ROA tasks are complete. This is the final regression gate for the feature.

6. **TypeScript strict mode gate** (NFR-004):
   `bun run typecheck` must report 0 type errors after all ROA tasks are complete.

## Files to create/modify

| File | Action |
|------|--------|
| `tests/overlays/mcp/mcp-overlay-provider.test.ts` | Extend test 7 — add `overlay.remote.failed` NOT emitted assertion |
| `tests/engine.test.ts` | Extend — add chain-builder integration test (Development Standards §2) |
| `tests/cli/status.test.ts` | Create or extend — CANCELLED display + overlay_evidence in --json |

## Acceptance criteria

```gherkin
Feature: Integration and regression gate

  Scenario: Skip policy produces no overlay.remote.failed event
    Given a provider with failure_policy "skip" and a transport error
    When McpOverlayProvider invokes the overlay
    Then overlay.remote.fallback IS emitted with failure_policy "skip"
    And overlay.remote.failed is NOT emitted (events array has no "overlay.remote.failed" entry)

  Scenario: buildProviderChain wires into engine dispatch path
    Given an Engine constructed with a provider chain from buildProviderChain
    And the chain contains one LocalOverlayProvider that returns PASS
    When the engine runs a task
    Then runPreProviderChain is invoked with the non-empty chain
    And the provider's invokePre is called for that task

  Scenario: ai-sdd status shows CANCELLED separately from FAILED
    Given a workflow state file with one task in CANCELLED and one in FAILED
    When "ai-sdd status" is executed against that state
    Then stdout contains "⊘" for the CANCELLED task
    And stdout contains "✗" for the FAILED task
    And the summary line shows CANCELLED count as a separate category

  Scenario: ai-sdd status --json includes overlay_evidence
    Given a task state with overlay_evidence set to a non-null value
    When "ai-sdd status --json" is executed
    Then the JSON output for that task contains the overlay_evidence field

  Scenario: Full test suite passes after all ROA changes
    Given the complete implementation of all ROA tasks
    When "bun test" is executed
    Then at least 505 tests pass
    And 0 tests fail
    And no existing test file is modified

  Scenario: TypeScript strict mode compilation succeeds
    Given all new ROA source files
    When "bun run typecheck" is executed
    Then the command exits with code 0
    And no type errors are reported
```

## Implementation notes

- The skip-policy gap (item 1) is the highest priority per review-l2. It directly guards
  the Finding 1 resolution (the skip row contradiction that was the blocker in iteration 1).
- Development Standards §2 (integration point test): the chain-builder wiring test (item 2)
  must verify that A (`buildProviderChain`) is called and its output is passed to B
  (`runPreProviderChain`). A unit test of each component alone does not satisfy this rule.
- Development Standards §7 (one integration test per CLI command): `ai-sdd status` already
  has some CLI tests but the CANCELLED-display test is new.
- Development Standards §4 (external schema fixture): the SDK fixture in
  `tests/overlays/mcp/fixtures/mcp-call-tool-result.json` must be a real captured response
  from `@modelcontextprotocol/sdk@^1.0.4`, not an assumed shape.

## Definition of done

- [ ] Code reviewed and merged
- [ ] Skip-policy test explicitly asserts `overlay.remote.failed` is NOT emitted
- [ ] Chain-builder wiring integration test passes in `tests/engine.test.ts`
- [ ] `ai-sdd status` CLI integration test covering CANCELLED display passes
- [ ] `overlay_evidence` in `ai-sdd status --json` asserted by test
- [ ] `bun test` passes all tests (0 failures)
- [ ] `bun run typecheck` exits with code 0
