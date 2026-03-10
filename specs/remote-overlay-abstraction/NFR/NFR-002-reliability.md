# NFR-002: Reliability — Deterministic Outcomes and Atomic State

## Metadata
- **Category:** Reliability
- **Priority:** MUST

## Description

The remote overlay abstraction must not introduce new failure modes that corrupt workflow
state or leave tasks in an undefined status. Every remote interaction must produce a
deterministic outcome, and all state changes must be persisted atomically using the existing
tmp+rename pattern. The 177-test baseline must be preserved unchanged.

## Acceptance criteria

Numeric targets:

| Property | Target | Condition |
|----------|--------|-----------|
| Engine crash rate increase | 0% | Caused by any remote overlay transport or schema error |
| State file consistency | 100% atomic writes | Tmp+rename pattern; no partial writes observable |
| Deterministic outcome on remote failure | 100% of remote failures produce a valid OverlayDecision | No unhandled exceptions propagate from providers to engine |
| CANCELLED reachability from non-terminal states | 100% | From PENDING, RUNNING, NEEDS_REWORK, HIL_PENDING |
| VALID_TRANSITIONS enforcement | 100% of invalid transitions throw StateError | Including exit attempts from CANCELLED |
| Existing test pass rate after Phase 1 | 177 / 177 tests pass unmodified | After LocalOverlayProvider refactor is complete |

```gherkin
Feature: Remote overlay reliability

  Scenario: Unhandled exception from provider does not crash the engine
    Given a provider whose invokePre throws an unexpected Error
    When the chain runner processes that provider
    Then the exception is caught
    And converted to OverlayDecision with verdict "FAIL"
    And the task transitions to FAILED with an error record
    And no exception propagates beyond runPreProviderChain

  Scenario: Partial JSON response does not leave task in undefined state
    Given a remote provider that writes half a JSON object before disconnecting
    When McpClientWrapper reads the response
    Then the parse attempt fails
    And the provider returns OverlayDecision with verdict "FAIL"
    And the task transitions to FAILED cleanly

  Scenario: State file is atomic after CANCELLED transition
    Given a task in RUNNING state
    When the state-manager transitions it to CANCELLED
    Then the state file is either pre-change or post-change at every point during the write
    And no partial or intermediate state is observable

  Scenario: All 177 existing tests pass after LocalOverlayProvider refactor
    Given the full test suite at tests/
    When "bun test" is run after Phase 1 changes
    Then 177 tests pass
    And 0 tests fail
    And no test file is modified
```

## Related
- FR: FR-004 (provider exception conversion), FR-006 (CANCELLED state), FR-007 (engine verdict mapping — deterministic), FR-008 (failure handling)
