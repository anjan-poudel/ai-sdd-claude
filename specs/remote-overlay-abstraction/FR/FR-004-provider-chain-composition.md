# FR-004: Provider Chain Composition

## Metadata
- **Area:** Overlay Orchestration
- **Priority:** MUST
- **Source:** REMOTE-OVERLAY-PLAN.md §4.3, §5; constitution.md Constraints; hybrid-mcp-sidecar-strategy-codex.md §Proposed Chain

## Description

The system must provide a provider chain builder (`src/overlays/registry.ts`) and a chain runner (`src/overlays/provider-chain.ts`) that together replace the current direct overlay invocation in the engine.

### Provider Registry (`src/overlays/registry.ts`)

The registry must compile configuration into an ordered list of `OverlayProvider` instances by performing the following steps in order:

1. Construct `LocalOverlayProvider` instances for all built-in overlays (HIL, policy gate, review, paired, confidence) from the existing overlay configuration.
2. Construct `CliOverlayProvider` or `McpOverlayProvider` instances for each entry in `remote_overlays`, resolving the referenced `overlay_backends` entry to obtain the backend configuration.
3. Return an error if a `remote_overlays` entry references a backend ID that does not exist in `overlay_backends`.

### Chain Order (locked)

The composed chain must always follow this order:

```
HIL (local) → Remote overlays (insertion order from config) → Policy Gate (local) → Agentic Review (local) → Paired Workflow (local) → Confidence (local)
```

This order is invariant. Configuration may not reorder local overlays relative to each other or relative to the remote overlay slot. Remote overlays occupy the slot between HIL and Policy Gate.

### Chain Runner (`src/overlays/provider-chain.ts`)

The chain runner must expose two functions:

```typescript
function runPreProviderChain(
  chain: OverlayProvider[],
  ctx: OverlayContext,
): Promise<OverlayDecision>

function runPostProviderChain(
  chain: OverlayProvider[],
  ctx: OverlayContext,
  result: TaskResult,
): Promise<OverlayDecision>
```

Chain execution rules:

1. Only invoke providers that declare the relevant hook (`pre_task` or `post_task`).
2. Apply phase filtering: skip a provider if `provider.phases` is set and does not include `ctx.task.phase`.
3. Stop on the first non-`PASS` verdict and return that `OverlayDecision` to the engine.
4. If all providers return `PASS`, return an `OverlayDecision` with verdict `PASS`.
5. Skip disabled providers (`provider.enabled === false`) without invoking them.

### Composition Rule Compatibility

The chain runner must extend (not replace) the existing composition rules in `src/overlays/composition-rules.ts`. The existing rule that Paired and Review are mutually exclusive must remain enforced. The new rule is that remote overlays must not be positioned after Policy Gate in the chain; the registry must enforce this at build time.

## Acceptance Criteria

```gherkin
Feature: Provider chain composition and execution

  Scenario: Chain is built in locked order
    Given a config with HIL enabled, one remote overlay, and policy_gate enabled
    When the registry builds the provider chain
    Then the chain order is: HIL → remote overlay → policy_gate
    And no local overlay appears before HIL in the chain

  Scenario: First non-PASS verdict short-circuits the chain
    Given a chain of three providers
    And the first returns PASS
    And the second returns REWORK
    And the third would return PASS
    When runPreProviderChain is called
    Then the returned OverlayDecision has verdict REWORK
    And the third provider's invokePre is never called

  Scenario: All providers return PASS
    Given a chain of three providers all returning PASS
    When runPreProviderChain is called
    Then the returned OverlayDecision has verdict PASS

  Scenario: Phase filtering skips non-matching providers
    Given a remote overlay configured with phases: ["planning", "design"]
    And the current task has phase "implementation"
    When runPreProviderChain is called
    Then the remote provider's invokePre is not called
    And the chain continues to the next provider

  Scenario: Disabled provider is skipped
    Given a provider with enabled: false
    When the chain runner processes the chain
    Then the disabled provider's invoke methods are never called

  Scenario: Unknown backend reference is rejected at build time
    Given a remote_overlays entry referencing backend "nonexistent-backend"
    When the registry builds the provider chain
    Then it throws a configuration error naming the missing backend ID
    And no providers are returned

  Scenario: Mutual exclusion of Paired and Review is preserved
    Given a chain where both Review and Paired providers are present and enabled
    When the registry validates the composition rules
    Then it throws a composition error identical to the pre-existing behavior
```

## Related
- FR: FR-001 (OverlayProvider), FR-002 (OverlayDecision), FR-005 (config schema drives registry)
- NFR: NFR-004 (backward compatibility — existing 177 tests must pass)
- Depends on: FR-001, FR-002, FR-005
