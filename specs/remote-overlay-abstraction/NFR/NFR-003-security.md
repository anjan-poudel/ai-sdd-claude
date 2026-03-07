# NFR-003: Security

## Metadata
- **Category:** Security
- **Priority:** MUST

## Description

The remote overlay abstraction must not introduce new attack surfaces or weaken existing security guarantees. The three primary security properties to enforce are: the no-mutation invariant (remote overlays cannot alter ai-sdd state directly), schema enforcement as an injection guard (invalid responses never reach the engine), and secret non-leakage (credentials in config do not appear in logs or events).

## Targets

| Property | Target | Verification method |
|----------|--------|-------------------|
| No-mutation invariant | 0 code paths where a remote provider write to state files or task records directly | Static: no file-write calls in provider code; test: assert remote updated_context cannot overwrite task_id, status, workflow_id |
| Schema-as-injection-guard | 100% of remote responses validated by Zod before engine consumption | Test: any response that bypasses Zod validation is a test failure |
| Secret redaction in events | 100% of payloads matching existing secret patterns are redacted before event emission | Test: inject a secret-pattern value in config passthrough; assert it does not appear in any event payload |
| Secret redaction in logs | 100% of log lines sanitized through existing log sanitizer | Existing security tests must pass unchanged |
| Unknown verdict rejection | 0 instances of an unrecognized verdict value reaching the engine's state transition logic | Test: assert that a response with verdict "FORCE_ACCEPT" causes FAIL, not PASS |
| No eval() in new code | 0 uses of `eval()`, `Function()`, or dynamic execution in all new source files | Static analysis: `grep -r 'eval(' src/overlays/` returns empty |

## Verification

1. Code review gate: no file-write, state-write, or `complete-task`-equivalent calls in `src/overlays/` or `src/config/remote-overlay-schema.ts`.
2. Security test: construct a `McpOverlayProvider` that returns `updated_context: { task_id: "injected", status: "COMPLETED" }`; assert the engine's state record is unchanged for both fields.
3. Security test: construct a provider that returns `{ verdict: "FORCE_ACCEPT", protocol_version: "1" }`; assert Zod rejects it and the engine receives `FAIL`.
4. Security test: place a secret-pattern string (matching the existing sanitizer's patterns) in a remote overlay `config.passthrough` value; emit an event; assert the emitted event payload contains `[REDACTED]` in place of the secret.
5. Static check (CI): `grep -rn "eval(" src/overlays/ src/config/remote-overlay-schema.ts` must produce no output.

```gherkin
Feature: Remote overlay security

  Scenario: Remote provider cannot overwrite task status via updated_context
    Given a McpOverlayProvider that returns updated_context containing status "COMPLETED"
    When the engine applies the OverlayDecision
    Then the task status in the state record is unchanged
    And no transition to COMPLETED is triggered by the updated_context

  Scenario: Remote provider cannot overwrite task_id via updated_context
    Given a McpOverlayProvider that returns updated_context containing task_id "injected-id"
    When the engine applies the OverlayDecision
    Then the task_id in the state record remains the original value

  Scenario: Unrecognized verdict is rejected before reaching state machine
    Given a remote provider response with verdict "FORCE_ACCEPT"
    When the Zod schema validates the response
    Then validation fails
    And the engine receives OverlayDecision with verdict FAIL
    And the state machine never evaluates "FORCE_ACCEPT" as a verdict

  Scenario: Secret value in passthrough config is redacted in observability events
    Given a remote overlay config passthrough containing a field with value "sk-secret-12345"
    And "sk-secret-12345" matches the existing secret pattern
    When an overlay.remote.invoked event is emitted
    Then the event payload contains "[REDACTED]" in place of "sk-secret-12345"
    And the literal value "sk-secret-12345" does not appear in any log line

  Scenario: No eval() in provider code
    Given the source files in src/overlays/ and src/config/remote-overlay-schema.ts
    When a static search for "eval(" is performed
    Then no matches are found
```

## Related
- FR: FR-002 (Zod validation as enforcement), FR-007 (engine is single enforcement point), FR-009 (secret redaction in events)
