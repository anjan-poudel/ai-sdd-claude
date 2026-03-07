# NFR-002: Reliability

## Metadata
- **Category:** Reliability
- **Priority:** MUST

## Description

The remote overlay abstraction must not introduce new failure modes that can corrupt workflow state or leave tasks in an undefined status. Every remote interaction must have a deterministic outcome, and all state changes must be persisted atomically using the existing tmp+rename pattern.

## Targets

| Metric | Target | Condition |
|--------|--------|-----------|
| Workflow engine crash rate increase | 0% increase above baseline | Caused by any remote overlay transport or schema error |
| State file consistency | 100% of state transitions written atomically | Using existing tmp+rename pattern; no partial writes |
| Deterministic outcome on any remote failure | 100% of remote failures produce a valid OverlayDecision | No unhandled exceptions propagate to the engine from providers |
| CANCELLED state reachability | 100% from any non-terminal state | PENDING, RUNNING, NEEDS_REWORK, HIL_PENDING |
| VALID_TRANSITIONS enforcement | 100% of invalid transition attempts throw StateError | Including attempts to transition out of CANCELLED |
| Existing test suite pass rate after Phase 1 | 177/177 tests pass | All tests pass without modification after LocalOverlayProvider refactor |

## Verification

1. Fault injection test: simulate connection refused on a configured remote backend; assert no unhandled exception reaches the engine and the task reaches a valid terminal state.
2. Fault injection test: simulate a process crash mid-response (partial JSON); assert the schema validator catches it and returns `FAIL` verdict cleanly.
3. State consistency test: concurrently cancel a RUNNING task while a remote overlay is awaiting a response; assert the state file is either pre-change or post-change, never intermediate.
4. State machine test: assert all transitions in VALID_TRANSITIONS are reachable and all transitions not listed throw `StateError`.
5. Regression test: run `bun test` with all 177 existing tests; assert zero failures after the LocalOverlayProvider wrapper is introduced.

```gherkin
Feature: Remote overlay reliability

  Scenario: Unhandled exception from remote provider does not crash the engine
    Given a remote overlay provider whose invokePre method throws an unexpected Error
    When the engine processes the provider chain
    Then the engine catches the error
    And converts it to an OverlayDecision with verdict FAIL
    And the task transitions to FAILED with an error record
    And no unhandled exception propagates to the engine's caller

  Scenario: Partial JSON response does not leave task in undefined state
    Given a remote provider that writes half a JSON object then disconnects
    When the McpClientWrapper reads the response
    Then the parse attempt fails
    And the provider returns OverlayDecision with verdict FAIL
    And the task transitions to FAILED

  Scenario: State file is atomic after CANCELLED transition
    Given a task in RUNNING state
    When the state-manager writes a CANCELLED transition
    Then the state file is readable with status CANCELLED immediately after the write
    And no state file exists with a partial or intermediate status

  Scenario: All 177 existing tests pass after LocalOverlayProvider refactor
    Given the LocalOverlayProvider wrapping all existing in-process overlays
    When the full test suite is run with "bun test"
    Then all 177 tests pass without modification
    And no new test failures are introduced
```

## Related
- FR: FR-006 (CANCELLED state), FR-007 (engine verdict mapping — deterministic outcomes), FR-008 (failure handling)
