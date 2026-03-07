# FR-001: Overlay Provider Interface

## Metadata
- **Area:** Overlay Abstraction
- **Priority:** MUST
- **Source:** REMOTE-OVERLAY-PLAN.md §2.2; remote-overlay-mcp-architecture-codex.md §2; constitution.md Deliverables

## Description

The system must define a transport-agnostic `OverlayProvider` interface that all overlay implementations — local in-process and remote MCP — must satisfy. This interface is the single contract that the provider chain runner uses to invoke overlays without knowledge of their runtime type.

The interface must carry the following properties and methods:

```typescript
interface OverlayProvider {
  readonly id: string;
  readonly runtime: OverlayRuntime;   // "local" | "cli" | "mcp"
  readonly hooks: OverlayHook[];       // ["pre_task"] | ["post_task"] | both
  readonly enabled: boolean;
  readonly phases?: string[];          // optional phase filter

  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}
```

The supporting type `OverlayRuntime` must be the enum `"local" | "cli" | "mcp"`. The `OverlayHook` type must be `"pre_task" | "post_task"`. A provider must declare at least one hook and implement the corresponding method. Declaring a hook without implementing the method is a configuration error detected at provider construction time.

All types and the interface must be defined in `src/types/overlay-protocol.ts`.

## Acceptance Criteria

```gherkin
Feature: OverlayProvider interface definition

  Scenario: Local provider satisfies interface
    Given a LocalOverlayProvider instance wrapping a BaseOverlay
    When the provider chain runner queries provider.hooks
    Then the returned array contains "pre_task", "post_task", or both
    And provider.runtime equals "local"
    And provider.enabled reflects the underlying BaseOverlay enabled flag

  Scenario: MCP provider satisfies interface
    Given a McpOverlayProvider instance configured with a backend
    When the provider chain runner queries provider.hooks
    Then the returned array matches the hooks declared in remote_overlays config
    And provider.runtime equals "mcp"

  Scenario: Provider declares hook without implementing method
    Given a provider implementation that declares hooks: ["pre_task"]
    But omits the invokePre method
    When the provider registry attempts to construct the provider
    Then construction throws a configuration error
    And the error message names the missing method and provider id

  Scenario: OverlayRuntime is exhaustively typed
    Given the OverlayRuntime type definition
    When a switch statement over runtime is written without a default branch
    Then TypeScript compilation rejects any unhandled runtime value
```

## Related
- NFR: NFR-001 (performance), NFR-002 (reliability)
- Depends on: none (foundational)
