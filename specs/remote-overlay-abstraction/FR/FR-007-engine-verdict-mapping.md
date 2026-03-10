# FR-007: Engine Verdict Mapping

## Metadata
- **Area:** Workflow Engine
- **Priority:** MUST
- **Source:** constitution.md — Deliverables, Constraints; `src/core/engine.ts` (applyPreDecision, applyPostDecision, runTask)

## Description

The engine (`src/core/engine.ts`) is the single enforcement point for translating
`OverlayDecision` verdicts into task state transitions. No provider, wrapper, or chain runner
may directly call `StateManager.transition()` or write to the state file.

### Verdict-to-transition table

**Pre-task decisions** (`applyPreDecision`):

| Verdict | Engine action | Return value |
|---------|--------------|--------------|
| `PASS` | Continue to agent dispatch | `"CONTINUE"` |
| `REWORK` | `RUNNING → NEEDS_REWORK → RUNNING`; emit `task.rework` | `"NEEDS_REWORK"` |
| `FAIL` | `RUNNING → FAILED`; emit `task.failed` | `"FAILED"` |
| `HIL` | `RUNNING → HIL_PENDING`; emit `task.hil_pending`; await resolution | `"HIL_AWAITING"` |

**Post-task decisions** (`applyPostDecision`):

| Verdict | Engine action | Return value |
|---------|--------------|--------------|
| `PASS` | Continue to `COMPLETED` transition | `"PASS"` |
| `REWORK` | `RUNNING → NEEDS_REWORK → RUNNING`; emit `task.rework` | `"NEEDS_REWORK"` |
| `FAIL` | `RUNNING → FAILED`; emit `task.failed` | `"FAILED"` |
| `HIL` | Treated as `REWORK` (post-task HIL is not fully specified; conservative handling) | `"NEEDS_REWORK"` |

### Exhaustiveness requirement

Both `applyPreDecision` and `applyPostDecision` must use an exhaustive switch statement over
`OverlayVerdict`. The `default` branch must be an unreachable `never` type assertion:

```typescript
default: {
  const _exhaustive: never = verdict;
  throw new Error(`Unhandled OverlayVerdict: ${String(_exhaustive)}`);
}
```

TypeScript compilation must fail if a new `OverlayVerdict` value is added without a
corresponding case being added to both switch statements.

### Provider chain call sites

The engine must invoke `runPreProviderChain(this.providerChain, overlayCtx)` before agent
dispatch and `runPostProviderChain(this.providerChain, overlayCtx, result)` after a successful
agent dispatch. It must not call `OverlayProvider.invokePre` or `invokePost` directly.

### Evidence persistence

When an `OverlayDecision` includes an `evidence` field, the engine must write it to the task's
`TaskState.overlay_evidence` field during the state transition. The evidence must then be
readable via `stateManager.getTaskState(taskId).overlay_evidence` and visible in
`ai-sdd status --json` output.

### No-mutation invariant for `updated_context`

When an `OverlayDecision` includes `updated_context`, the engine must apply it to the working
`AgentContext` using `mergeContextUpdate`, which strips the identity fields
`task_id`, `workflow_id`, `run_id`, and `status`. The engine must not pass raw
`updated_context` directly to state transitions or downstream calls.

### HIL resume path

When the engine resumes a `HIL_PENDING` task (from persisted state on `--resume`), it must
skip the pre-overlay chain entirely and call `awaitResolution` directly on the HIL overlay
using the stored `hil_item_id`. This prevents the state machine reset bug where
pre-overlays fire again and create duplicate HIL items.

## Acceptance criteria

```gherkin
Feature: Engine verdict-to-state mapping

  Scenario: PASS verdict continues execution without state change
    Given a task in RUNNING state
    And runPreProviderChain returns OverlayDecision with verdict PASS
    When the engine calls applyPreDecision
    Then the task status remains RUNNING
    And execution proceeds to agent dispatch

  Scenario: REWORK verdict from pre-task chain cycles the task
    Given a task in RUNNING state
    And runPreProviderChain returns verdict REWORK with feedback "Scope drift detected"
    When the engine calls applyPreDecision
    Then the task transitions to NEEDS_REWORK
    And a task.rework event is emitted with the feedback message
    And the task is re-armed to RUNNING for the next iteration

  Scenario: FAIL verdict from pre-task chain terminates the task
    Given a task in RUNNING state
    And runPreProviderChain returns verdict FAIL with evidence
    When the engine calls applyPreDecision
    Then the task transitions to FAILED
    And a task.failed event is emitted
    And the evidence is written to the task state record

  Scenario: HIL verdict transitions task to HIL_PENDING and awaits resolution
    Given a task in RUNNING state
    And runPreProviderChain returns verdict HIL
    When the engine calls applyPreDecision
    Then the task transitions to HIL_PENDING
    And a task.hil_pending event is emitted
    And the engine awaits resolution via awaitResolution on the HIL overlay

  Scenario: Adding a new OverlayVerdict without engine handler causes compile failure
    Given OverlayVerdict is extended with a new value "ESCALATE"
    When applyPreDecision or applyPostDecision does not have a case for "ESCALATE"
    Then TypeScript compilation fails with an exhaustive check error

  Scenario: Evidence in OverlayDecision is persisted to task state
    Given a provider that returns OverlayDecision with non-empty evidence
    When the engine processes the decision
    Then the evidence is written to TaskState.overlay_evidence
    And getTaskState returns the evidence on subsequent reads

  Scenario: identity fields in updated_context are stripped before application
    Given a remote provider returns updated_context containing task_id "injected"
    When the engine applies the context update via mergeContextUpdate
    Then the task state record task_id remains the original value
    And no state transition is triggered by the update alone

  Scenario: HIL resume skips pre-overlay chain
    Given a persisted state where a task is in HIL_PENDING with a valid hil_item_id
    When the engine resumes the workflow with --resume
    Then the pre-overlay chain is not invoked for that task
    And awaitResolution is called directly with the stored hil_item_id
```

## Related
- FR: FR-002 (OverlayDecision is the input), FR-004 (chain runner produces decisions), FR-006 (CANCELLED is available as a terminal state)
- NFR: NFR-002 (atomic state writes, no unhandled exceptions), NFR-003 (no-mutation invariant)
- Depends on: FR-002, FR-004, FR-006
