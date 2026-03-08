# ROA-T-007: Provider Chain Runner and Registry

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Component C (`src/overlays/registry.ts`), Component D (`src/overlays/provider-chain.ts`), Component K (`src/overlays/composition-rules.ts`)
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** ROA-T-001, ROA-T-003, ROA-T-004, ROA-T-006
- **Blocks:** ROA-T-008
- **Requirements:** FR-004, NFR-002, NFR-004
- **Status:** COMPLETE — all three files exist and are implemented

## Description

Implement three related components that together replace direct overlay invocations in
the engine:

**`buildProviderChain` (`src/overlays/registry.ts`)** — pure function that assembles
the `OverlayProvider[]` chain from local and remote config, enforcing locked chain order:
`HIL (local) → remote overlays (YAML order) → policy_gate (local) → review/paired (local) → confidence (local)`.
Throws `RegistryError` for unknown backend references, unsupported runtimes, missing
emitters, and the Review+Paired mutual exclusion.

**`runPreProviderChain` / `runPostProviderChain` / `mergeContextUpdate` (`src/overlays/provider-chain.ts`)**
— runtime chain executor. Short-circuits on first non-PASS verdict. Converts any provider
exception to `{ verdict: "FAIL" }`. Strips identity fields (`task_id`, `workflow_id`,
`run_id`, `status`) from `updated_context` via `IDENTITY_FIELDS` constant before
forwarding to the next provider.

**`validateProviderCombination` (`src/overlays/composition-rules.ts`)** — extends the
existing file with a new function (does NOT modify `validateOverlayCombination`). Enforces
Invariant 1 (HIL first), Invariant 5 (Review+Paired exclusive), and Invariant 6 (no remote
after policy_gate).

## Files to create/modify

| File | Action |
|------|--------|
| `src/overlays/registry.ts` | Create |
| `src/overlays/provider-chain.ts` | Create |
| `src/overlays/composition-rules.ts` | Modify — add `validateProviderCombination` (do not modify `validateOverlayCombination`) |

## Acceptance criteria

```gherkin
Feature: Provider chain construction and execution

  Scenario: Chain is built in locked order with HIL, remote, and policy_gate
    Given a config with HIL enabled, one MCP remote overlay, and policy_gate enabled
    When buildProviderChain is called
    Then chain[0].id is "hil" and chain[0].runtime is "local"
    And chain[1].runtime is "mcp"
    And chain[2].id is "policy_gate" and chain[2].runtime is "local"

  Scenario: Unknown backend reference is rejected at build time
    Given a remote_overlays entry referencing backend "missing-backend" not in overlay_backends
    When buildProviderChain is called
    Then it throws RegistryError naming the missing backend ID

  Scenario: Emitter is required when remote overlays are present
    Given a RegistryInput with remote_overlays and no emitter
    When buildProviderChain is called
    Then it throws RegistryError stating an ObservabilityEmitter is required

  Scenario: Review and Paired mutual exclusion at build time
    Given both review and paired overlays are enabled
    When buildProviderChain is called
    Then it throws RegistryError with the Invariant 5 message

  Scenario: Remote overlay after policy_gate is rejected by validateProviderCombination
    Given a chain where a remote provider appears after the policy_gate provider
    When validateProviderCombination runs
    Then it returns errors containing "Invariant 6 violated"

  Scenario: First non-PASS verdict short-circuits the chain
    Given a chain of three providers where the second returns REWORK
    When runPreProviderChain is called
    Then the OverlayDecision has verdict "REWORK"
    And the third provider's invokePre is never called

  Scenario: Unhandled provider exception is converted to FAIL decision
    Given a provider whose invokePre throws an unexpected Error
    When runPreProviderChain processes that provider
    Then the chain returns OverlayDecision with verdict "FAIL"
    And no exception propagates out of runPreProviderChain

  Scenario: Identity fields stripped from updated_context
    Given a provider returns PASS with updated_context containing task_id "injected"
    And workflow_id "injected", run_id "injected", status "COMPLETED"
    When mergeContextUpdate applies the update
    Then the resulting context preserves all four original identity field values

  Scenario: Non-identity context update is forwarded to next provider
    Given a provider returns PASS with updated_context containing a new non-identity key
    When runPreProviderChain processes the chain
    Then the next provider's context includes that key value

  Scenario: Phase-filtered provider is skipped without invocation
    Given a remote provider with phases ["planning"] and task phase "implementation"
    When runPreProviderChain processes the chain
    Then the remote provider's invokePre is not called
    And the chain continues to the next provider

  Scenario: Disabled provider is never invoked
    Given a provider with enabled: false
    When runPreProviderChain processes the chain
    Then the disabled provider's invokePre is never called
```

## Implementation notes

- `RegistryError` extends `Error` with `this.name = "RegistryError"` for `instanceof`
  compatibility. Error messages are stable strings tested by assertion.
- `buildProviderChain` is a pure function — not a class method. Engine constructor
  receives the pre-built chain.
- `IDENTITY_FIELDS = new Set(["task_id", "workflow_id", "run_id", "status"])` — single
  authoritative list in `provider-chain.ts`. Must not be duplicated in other files.
- Chain runner does not emit observability events — remote providers emit their own.
  This keeps the chain runner testable without an emitter dependency.
- Development Standards §2 (integration point test): there must be a test that
  `buildProviderChain` is called at engine startup and the built chain is passed to
  `runPreProviderChain`. See ROA-T-008 for the engine integration test.

## Definition of done

- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by tests in `tests/overlays/registry.test.ts` and `tests/overlays/provider-chain.test.ts`
- [ ] `tests/overlays/composition-matrix.test.ts` extended with Invariant 6 cases
- [ ] Error message strings verified by test assertions (Development Standards §5)
- [ ] `bun test` shows all 505+ existing tests still pass
