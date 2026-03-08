# NFR-003: Security — No-Mutation Invariant, Schema Enforcement, Secret Redaction

## Metadata
- **Category:** Security
- **Priority:** MUST

## Description

The remote overlay abstraction must not introduce new attack surfaces or weaken existing
security guarantees. Three primary security properties must hold:

1. **No-mutation invariant** — remote overlays are pure decision services; they must not
   write to ai-sdd state files or artifact paths.
2. **Schema as injection guard** — every remote response must be Zod-validated before the
   engine processes it; an invalid response must always cause `FAIL`, never `PASS`.
3. **Secret non-leakage** — credentials or tokens in config passthroughs must not appear
   in any emitted event or console log line.

## Acceptance criteria

Numeric targets:

| Property | Target | Verification method |
|----------|--------|-------------------|
| No-mutation invariant — provider code | 0 file-write or state-write calls in `src/overlays/` | Static: no `writeFile`, `transition()`, or `complete-task` calls in provider code |
| No-mutation invariant — updated_context | 0 paths where `task_id`, `status`, `workflow_id`, `run_id` are overwritten from remote input | Test: inject mutated identity fields; assert state record is unchanged |
| Schema enforcement | 100% of remote responses validated by Zod before engine consumption | Test: any response that bypasses Zod is a test failure |
| Unknown verdict rejection | 0 unrecognized verdict values reach engine state transition logic | Test: `"FORCE_ACCEPT"` causes FAIL; never PASS |
| Secret redaction in events | 100% of matching secret patterns replaced with `"[REDACTED]"` | Test: inject secret-pattern value in passthrough; assert not in event payload |
| No `eval()` in new code | 0 uses of `eval()`, `Function()`, or dynamic execution | Static: `grep -r 'eval(' src/overlays/ src/config/remote-overlay-schema.ts` returns empty |

```gherkin
Feature: Remote overlay security

  Scenario: Remote provider cannot overwrite task status via updated_context
    Given a McpOverlayProvider that returns updated_context containing status "COMPLETED"
    When the engine applies the OverlayDecision via mergeContextUpdate
    Then the task status in the state record is unchanged
    And no transition to COMPLETED is triggered

  Scenario: Remote provider cannot overwrite task_id via updated_context
    Given a McpOverlayProvider that returns updated_context containing task_id "injected-id"
    When the engine applies the OverlayDecision
    Then the task_id in the state record remains the original value

  Scenario: Unrecognized verdict is rejected before reaching state machine
    Given a remote provider response containing verdict "FORCE_ACCEPT"
    When Zod validates the response
    Then validation fails because "FORCE_ACCEPT" is not in the allowed enum
    And the engine receives OverlayDecision with verdict "FAIL"
    And the value "FORCE_ACCEPT" never reaches a switch statement in the engine

  Scenario: Secret value in passthrough config is redacted in all events
    Given a remote overlay config.passthrough value that matches the existing secret pattern
    When any observability event is emitted for that invocation
    Then the event payload contains "[REDACTED]" in place of the secret value
    And the literal secret value does not appear in any log line

  Scenario: No eval() exists in provider or config source files
    Given the source files in src/overlays/ and src/config/remote-overlay-schema.ts
    When a static search for "eval(" is performed
    Then zero matches are found
```

## Related
- FR: FR-002 (Zod validation is the schema enforcement mechanism), FR-007 (engine is single state enforcement point), FR-009 (secret redaction in event payloads)
