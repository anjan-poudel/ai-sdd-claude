# FR-007: Engine Verdict Mapping

## Metadata
- **Area:** Workflow Engine
- **Priority:** MUST
- **Source:** REMOTE-OVERLAY-PLAN.md §2.1, §6; remote-overlay-mcp-architecture-codex.md §Engine mapping; constitution.md Deliverables

## Description

The engine (`src/core/engine.ts`) must consume `OverlayDecision` values produced by the provider chain runner and map each verdict to the correct task state transition. The engine is the single enforcement point; no provider, wrapper, or chain runner may directly update task state.

The required verdict-to-transition mapping is:

| Verdict | Task State Transition | Notes |
|---------|----------------------|-------|
| `PASS` | No change (continue execution) | Proceed to next overlay or dispatch agent |
| `REWORK` | `NEEDS_REWORK` | Include `feedback` from `OverlayDecision` in rework context |
| `FAIL` | `FAILED` | Terminal; include `feedback` and `evidence` in failure record |
| `HIL` | `HIL_PENDING` | Enqueue for human review; include `feedback` and `evidence` |

These four mappings are exhaustive. The engine must use an exhaustive switch or equivalent construct so that TypeScript compilation fails if a new `OverlayVerdict` value is added without a corresponding mapping.

The engine must call the provider chain runner (`runPreProviderChain` / `runPostProviderChain`) in place of any direct overlay method calls. The engine must not call `OverlayProvider.invokePre` or `invokePost` directly.

The `OverlayDecision.evidence` payload, when present, must be written to the task's state record so it is available to subsequent overlays and to the `ai-sdd status` command.

The no-mutation invariant must be enforced: the engine must not allow an `OverlayDecision.updated_context` value from a remote provider to overwrite fields that govern task state (task ID, status, workflow ID, run ID). Remote providers may only suggest context additions for non-state fields.

## Acceptance Criteria

```gherkin
Feature: Engine verdict-to-state mapping

  Scenario: PASS verdict continues execution
    Given a task in RUNNING state
    And the provider chain returns verdict PASS
    When the engine processes the OverlayDecision
    Then the task remains in RUNNING state
    And execution proceeds to the next step

  Scenario: REWORK verdict transitions task to NEEDS_REWORK
    Given a task in RUNNING state
    And the provider chain returns verdict REWORK with feedback "Scope drift detected"
    When the engine processes the OverlayDecision
    Then the task transitions to NEEDS_REWORK
    And the rework context includes the feedback string "Scope drift detected"

  Scenario: FAIL verdict transitions task to FAILED
    Given a task in RUNNING state
    And the provider chain returns verdict FAIL
    When the engine processes the OverlayDecision
    Then the task transitions to FAILED
    And the failure record includes the evidence from the OverlayDecision

  Scenario: HIL verdict transitions task to HIL_PENDING
    Given a task in RUNNING state
    And the provider chain returns verdict HIL
    When the engine processes the OverlayDecision
    Then the task transitions to HIL_PENDING
    And the HIL queue entry includes the feedback and evidence

  Scenario: Adding a new verdict without engine mapping causes compile error
    Given a new OverlayVerdict value "ESCALATE" is added to the type
    When the engine's switch statement does not handle "ESCALATE"
    Then TypeScript compilation fails with an exhaustive check error

  Scenario: Remote provider updated_context cannot overwrite state fields
    Given a remote provider that returns updated_context containing a modified task_id
    When the engine applies the updated_context
    Then the task_id in the state record is unchanged
    And no state transition is triggered by the updated_context alone

  Scenario: Evidence is persisted to task state record
    Given a provider that returns an OverlayDecision with non-empty evidence
    When the engine processes the decision
    Then the evidence object is written to the task's state record
    And subsequent reads of task state include the evidence
```

## Related
- FR: FR-002 (OverlayDecision is the input), FR-006 (CANCELLED state used for future SKIP verdict)
- NFR: NFR-002 (atomic state writes), NFR-003 (no-mutation invariant)
- Depends on: FR-002, FR-004 (chain runner provides the OverlayDecision), FR-006
