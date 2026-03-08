# T009 Implementation Checklist

Companion checklist for [T009-agentic-review-overlay.md](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/specs/tasks/T009-agentic-review-overlay.md).

## Current Status

- [x] Basic `review` overlay scaffold exists.
- [x] Generic overlay provider chain is wired into the engine.
- [x] `NO_GO -> NEEDS_REWORK` pass-through behavior exists via handover state.
- [ ] Dedicated coder/reviewer loop orchestration is implemented.
- [ ] Structured review log persistence is implemented.
- [ ] Constitution-driven review prompt assembly is implemented.
- [ ] Review-specific HIL escalation with full history is implemented.
- [ ] Acceptance criteria coverage is verified by tests.

## Implementation Checklist

### 1. Config and task contract

- [ ] Confirm task config shape for `overlays.review`.
- [ ] Support `enabled`, `coder_agent`, `reviewer_agent`, `max_iterations`.
- [ ] Validate config in workflow loading, not only at runtime.
- [ ] Decide whether `agent` remains the coder default when `coder_agent` is omitted.
- [ ] Reject invalid self-contradictory configs with clear errors.

### 2. Review loop orchestration

- [ ] Add explicit review-loop control flow in the engine or a dedicated orchestration helper.
- [ ] Dispatch coder agent first and capture its artifact/result.
- [ ] Dispatch reviewer agent separately with reviewer-specific context.
- [ ] Parse reviewer output into a strict `GO | NO_GO` decision shape.
- [ ] Re-run coder with reviewer feedback injected when reviewer returns `NO_GO`.
- [ ] Stop immediately when reviewer returns `GO`.
- [ ] Enforce `max_iterations` on review cycles.

### 3. Reviewer context construction

- [ ] Pull quality guidelines from the constitution Standards section.
- [ ] Include task acceptance criteria in reviewer context.
- [ ] Include coder artifact/output in reviewer context.
- [ ] Include prior review history for iterations after the first.
- [ ] Keep reviewer prompt structured enough to produce machine-parseable decisions.

### 4. Review decision schema

- [ ] Define a TypeScript type for the persisted review decision record.
- [ ] Require `task_id`, `reviewer_agent`, `coder_agent`, `iteration`, `decision`, `feedback`, `timestamp`.
- [ ] Decide whether `quality_checks` is required or optional in the first implementation.
- [ ] Validate parsed reviewer outputs before using them to drive state transitions.
- [ ] Treat malformed reviewer output as a failure mode with explicit handling.

### 5. Review log persistence

- [ ] Create `.ai-sdd/state/review-logs/` if missing.
- [ ] Persist per-task log file at `.ai-sdd/state/review-logs/<task-id>.json`.
- [ ] Append each iteration as an auditable record.
- [ ] Mark `final_decision` and `completed_at` when loop exits.
- [ ] Make log writing resilient enough that log failure does not corrupt workflow state.

### 6. HIL escalation path

- [ ] When max review iterations are exhausted, create a HIL item instead of silently failing generic rework.
- [ ] Attach full review history to the HIL payload/context.
- [ ] Pause the task for human decision using existing HIL mechanics.
- [ ] Ensure resumed runs do not duplicate prior review history or reset the loop incorrectly.

### 7. Engine and overlay boundaries

- [ ] Decide whether the coder/reviewer loop belongs in `ReviewOverlay` or in a dedicated engine helper called by the overlay.
- [ ] Keep `ReviewOverlay` from being just a passive post-task mapper if T009 requires active multi-agent orchestration.
- [ ] Avoid duplicating logic already present in paired workflow and HIL flows.
- [ ] Keep provider-chain compatibility if review remains a local overlay.

### 8. Tests

- [ ] Integration test: reviewer returns `GO` and task completes.
- [ ] Integration test: reviewer returns `NO_GO`, coder reruns with injected feedback.
- [ ] Integration test: `max_iterations` reached and HIL item is created.
- [ ] Integration test: review log contains all iterations and final decision.
- [ ] Integration test: constitution Standards content reaches reviewer context.
- [ ] Integration test: overlay disabled means single-agent execution only.
- [ ] Unit test: review decision parsing rejects malformed reviewer output.
- [ ] Unit test: review log writer handles append/finalization correctly.

## Recommended Build Order

1. Define config shape and decision/log types.
2. Implement review log writer.
3. Implement reviewer prompt/context builder.
4. Add explicit coder/reviewer loop orchestration.
5. Wire HIL escalation for max-iteration exhaustion.
6. Add full integration coverage.

## Risks To Watch

- Review loop logic gets split across engine, overlay, and adapter layers with unclear ownership.
- Reviewer output parsing is too loose and causes incorrect `GO` decisions.
- Generic rework iteration logic conflicts with review-specific iteration tracking.
- HIL resume path loses prior review history.
- Constitution content is included inconsistently, which breaks the requirement-first intent of the feature.

## Definition Of Done

- [ ] All T009 acceptance criteria are covered by passing tests.
- [ ] Review loop uses separate coder and reviewer roles.
- [ ] GO and NO_GO decisions are persisted in an auditable log.
- [ ] Max-iteration exhaustion routes to HIL with full review history.
- [ ] Constitution standards and task acceptance criteria are demonstrably present in reviewer context.
- [ ] Overlay is off by default and does nothing unless explicitly enabled.
