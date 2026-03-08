# FR-004: Provider Chain Construction and Composition Rules

## Metadata
- **Area:** Overlay Orchestration
- **Priority:** MUST
- **Source:** constitution.md — Deliverables, Constraints; `src/overlays/registry.ts` (buildProviderChain); `src/overlays/provider-chain.ts` (runPreProviderChain, runPostProviderChain); `src/overlays/composition-rules.ts` (validateProviderCombination)

## Description

The system must provide a provider chain builder and a chain runner that together replace the
direct overlay invocations previously scattered through the engine. The engine must call the
chain runner functions exclusively; it must not call provider `invokePre` or `invokePost`
methods directly.

### Provider registry (`src/overlays/registry.ts`)

The `buildProviderChain(input: RegistryInput): OverlayProvider[]` function must assemble the
full chain from local and remote config by following these steps in strict order:

1. If `localOverlays.hil` is provided, wrap it in `LocalOverlayProvider` and add it first.
2. For each entry in `remoteConfig.remote_overlays` (in YAML declaration order):
   a. Skip entries with `enabled: false`.
   b. Resolve the backend from `remoteConfig.overlay_backends[cfg.backend]`. If not found, throw `RegistryError` naming the missing backend ID.
   c. Construct `McpOverlayProvider`. Any other backend runtime throws `RegistryError` naming the unsupported runtime.
3. Wrap `localOverlays.policy_gate` in `LocalOverlayProvider` and add it.
4. Check mutual exclusion: if both `review.enabled` and `paired.enabled` are true, throw `RegistryError`.
5. Wrap `localOverlays.review` and `localOverlays.paired` in `LocalOverlayProvider` and add whichever is present.
6. Wrap `localOverlays.confidence` in `LocalOverlayProvider` and add it.
7. Validate the completed chain with `validateProviderCombination(chain)`. If invalid, throw `RegistryError` with all validation error messages joined.

The function must require an `ObservabilityEmitter` in `input` when `remote_overlays` entries
are present; otherwise the emitter is optional.

### Locked chain order

The assembled chain must always follow this order:

```
HIL (local) → Remote overlays (config insertion order) → Policy Gate (local) → Review (local) OR Paired (local) → Confidence (local)
```

This order is an invariant. Configuration may not place remote overlays after `policy_gate`.
Violation of this invariant must be caught and thrown as a `RegistryError` at build time.

### Chain runner (`src/overlays/provider-chain.ts`)

`runPreProviderChain` and `runPostProviderChain` must implement the following rules:

1. Skip providers where `enabled` is `false`.
2. Skip providers that do not declare the relevant hook (`"pre_task"` or `"post_task"`).
3. Skip providers where `phases` is set and the task's `phase` field does not appear in the list.
4. Invoke the provider's `invokePre` / `invokePost`. If the invocation throws, catch the error and convert it to `OverlayDecision { verdict: "FAIL", feedback: "Provider '${id}' threw unexpectedly: ${message}" }`.
5. If the verdict is not `"PASS"`, stop processing and return the decision immediately (short-circuit).
6. If the verdict is `"PASS"` and `updated_context` is present, apply it using `mergeContextUpdate` (which strips identity fields) before passing context to the next provider.
7. If all providers return `"PASS"`, return `{ verdict: "PASS" }`.

### `mergeContextUpdate` invariant

A helper `mergeContextUpdate(ctx, update)` must strip the fields `task_id`, `workflow_id`,
`run_id`, and `status` from any `updated_context` before merging it into the current
`OverlayContext`. This enforces the no-mutation invariant for context forwarding between
providers.

### Composition validation

`validateProviderCombination` in `src/overlays/composition-rules.ts` must enforce:

- **Invariant 1**: The HIL local provider must be first in the enabled chain.
- **Invariant 5**: Paired and Review are mutually exclusive — both enabled simultaneously is an error.
- **Invariant 6** (new): No remote provider may appear after `policy_gate` in the chain.

The existing `validateOverlayCombination` function must not be modified; the new
`validateProviderCombination` function operates on `OverlayProvider[]` and runs after
`buildProviderChain` assembles the chain.

## Acceptance criteria

```gherkin
Feature: Provider chain construction and execution

  Scenario: Chain is built in locked order with HIL, remote, and policy_gate
    Given a config with HIL enabled, one remote overlay enabled, and policy_gate enabled
    When buildProviderChain is called
    Then the chain order is: HIL (runtime "local") → remote overlay (runtime "mcp") → policy_gate (runtime "local")

  Scenario: Remote overlay after policy_gate is rejected at build time
    Given a chain where a remote overlay is added after the policy_gate step
    When validateProviderCombination runs
    Then it throws RegistryError naming Invariant 6 and the offending index

  Scenario: Unknown backend reference is rejected at build time
    Given a remote_overlays entry with backend "missing-backend"
    And "missing-backend" is not in overlay_backends
    When buildProviderChain is called
    Then it throws RegistryError naming the missing backend ID

  Scenario: Emitter is required when remote overlays are present
    Given a RegistryInput with remote_overlays but no emitter
    When buildProviderChain is called
    Then it throws RegistryError stating an ObservabilityEmitter is required

  Scenario: First non-PASS verdict short-circuits the chain
    Given a chain of three providers where the second returns REWORK
    When runPreProviderChain is called
    Then the OverlayDecision has verdict "REWORK"
    And the third provider's invokePre is never called

  Scenario: Unhandled provider exception is converted to FAIL decision
    Given a provider whose invokePre throws an unexpected Error
    When runPreProviderChain processes that provider
    Then the chain returns OverlayDecision with verdict "FAIL"
    And the feedback message contains the provider id and the error message
    And no exception propagates out of runPreProviderChain

  Scenario: Phase-filtered provider is skipped without invocation
    Given a remote provider with phases ["planning"]
    And the current task has phase "implementation"
    When runPreProviderChain processes the chain
    Then the remote provider's invokePre is not called
    And the chain continues to the next provider

  Scenario: Disabled provider is never invoked
    Given a provider with enabled: false in the chain
    When runPreProviderChain processes the chain
    Then the disabled provider's invokePre is never called

  Scenario: Context update from PASS decision is forwarded to next provider
    Given a chain of two providers
    And the first returns PASS with updated_context containing a non-identity field
    When runPreProviderChain processes the chain
    Then the second provider's invokePre receives a context that includes the updated field

  Scenario: Identity fields stripped from updated_context
    Given a provider that returns PASS with updated_context containing task_id "injected"
    When mergeContextUpdate applies the update
    Then the resulting context's task_id is unchanged from the original

  Scenario: Paired and Review mutual exclusion preserved
    Given both review and paired providers are enabled
    When buildProviderChain validates the composition
    Then it throws RegistryError with the Invariant 5 message
```

## Related
- FR: FR-001 (OverlayProvider interface), FR-002 (OverlayDecision), FR-005 (config schema drives input), FR-007 (engine calls chain runner, not individual providers)
- NFR: NFR-002 (provider exception must not crash the engine), NFR-004 (backward compatibility — existing composition rules unchanged)
- Depends on: FR-001, FR-002, FR-005
