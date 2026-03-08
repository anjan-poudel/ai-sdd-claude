# FR-001: Overlay Provider Interface and Provider Types

## Metadata
- **Area:** Overlay Abstraction
- **Priority:** MUST
- **Source:** constitution.md — Deliverables; `src/types/overlay-protocol.ts` (canonical type definition); `src/overlays/local-overlay-provider.ts`, `src/overlays/mcp/mcp-overlay-provider.ts`

## Description

The system must define a transport-agnostic `OverlayProvider` interface as the single contract
satisfied by all overlay implementations, regardless of whether they execute in-process (local)
or on a remote server (MCP). This interface is the only type the provider chain runner and the
engine ever see; they must not import or reference concrete provider classes directly.

The interface must carry the following members:

- `id: string` — unique identifier for this overlay within the chain
- `runtime: OverlayRuntime` — one of `"local" | "cli" | "mcp"` (string union, not an enum keyword, to enable TypeScript exhaustiveness checking)
- `hooks: OverlayHook[]` — one or both of `["pre_task"]`, `["post_task"]`, `["pre_task", "post_task"]`
- `enabled: boolean` — when false the chain runner must skip invocation entirely
- `phases?: string[]` — optional list of task phases this overlay applies to; absent means applies to all phases
- `invokePre?(ctx: OverlayContext): Promise<OverlayDecision>` — must be present when `hooks` includes `"pre_task"`
- `invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>` — must be present when `hooks` includes `"post_task"`

Two concrete implementations must exist:

**`LocalOverlayProvider`** (`src/overlays/local-overlay-provider.ts`) wraps an existing `BaseOverlay` in the `OverlayProvider` interface. It must translate `OverlayResult` / `PostTaskOverlayResult` to `OverlayDecision` using a deterministic mapping. It must expose the inner `BaseOverlay` via a public `inner` property so the engine can access `awaitResolution` on the HIL overlay. Construction must throw a `TypeError` if the wrapped overlay implements neither `preTask` nor `postTask`.

**`McpOverlayProvider`** (`src/overlays/mcp/mcp-overlay-provider.ts`) delegates invocations to a remote MCP server via `McpClientWrapper`. It must not call any MCP SDK methods directly; all SDK calls are delegated to `McpClientWrapper`. It must accept an injectable `clientFactory` parameter for testability.

All types that are part of the `OverlayProvider` interface contract must be defined in `src/types/overlay-protocol.ts` and re-exported from `src/types/index.ts`.

## Acceptance criteria

```gherkin
Feature: OverlayProvider interface and provider types

  Scenario: LocalOverlayProvider wraps BaseOverlay and satisfies the interface
    Given a BaseOverlay instance with both preTask and postTask methods
    When it is wrapped in a LocalOverlayProvider
    Then provider.id equals the inner overlay's name
    And provider.runtime equals "local"
    And provider.hooks contains both "pre_task" and "post_task"
    And provider.enabled reflects the inner overlay's enabled property
    And provider.inner exposes the original BaseOverlay instance

  Scenario: LocalOverlayProvider with no hooks rejects at construction time
    Given a BaseOverlay instance that implements neither preTask nor postTask
    When it is wrapped in a LocalOverlayProvider
    Then the constructor throws a TypeError
    And the error message names the overlay and states that at least one hook method is required

  Scenario: McpOverlayProvider satisfies the interface without SDK leakage
    Given a valid ResolvedRemoteOverlayConfig and a ResolvedBackendConfig with runtime "mcp"
    When an McpOverlayProvider is constructed with overlay name "coding-standards"
    Then provider.id equals "coding-standards"
    And provider.runtime equals "mcp"
    And provider.hooks matches the hooks declared in the config
    And the public API of the provider exposes no MCP SDK types

  Scenario: OverlayProvider interface is transport-agnostic at the call site
    Given a chain containing one LocalOverlayProvider and one McpOverlayProvider
    When the engine iterates the chain as OverlayProvider[]
    Then both providers are dispatched through the same invokePre or invokePost call signature
    And no provider-type-specific dispatch logic appears in the engine

  Scenario: OverlayRuntime exhaustiveness check at compile time
    Given the OverlayRuntime string union "local" | "cli" | "mcp"
    When a switch statement over runtime values has no default branch
    Then TypeScript compilation fails if any union member is unhandled
```

## Related
- NFR: NFR-001 (performance — no overhead from abstraction layer), NFR-002 (reliability — wrapping introduces no new failure modes), NFR-004 (backward compatibility — LocalOverlayProvider must preserve existing behavior exactly)
- Depends on: none (this is the foundational interface)
