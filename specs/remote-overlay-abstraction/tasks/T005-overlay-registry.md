# T005 — Overlay Registry

## Metadata
- **ID**: T005
- **FR/NFR**: FR-004, NFR-004
- **Owner**: developer
- **Depends on**: T001, T002, T004, T007
- **Estimate**: M (2-4h)

## Context

Currently the engine receives an `OverlayChain` (`BaseOverlay[]`) built by `buildOverlayChain()` in `src/overlays/composition-rules.ts`. The CLI `run` command constructs each overlay individually and passes them in. After this task, the engine will instead receive `OverlayProvider[]` from `buildProviderChain()` in `src/overlays/registry.ts`.

The registry is a pure build-time function (runs once at engine startup). It:
1. Wraps all existing local overlays in `LocalOverlayProvider` instances.
2. Constructs `McpOverlayProvider` instances for each enabled remote overlay.
3. Returns the unified ordered chain in the locked order: `HIL → remote overlays → policy_gate → review/paired → confidence`.
4. Validates composition rules at build time (not per-task).

In Phase 1 (local overlays only, no remote config), the registry must produce the same effective chain as the current `buildOverlayChain` call, preserving backward compatibility for all 177 existing tests.

## Files to create/modify

- `src/overlays/registry.ts` — create — `buildProviderChain()` pure function + `RegistryError`
- `src/overlays/composition-rules.ts` — modify — add `validateProviderCombination()` for the new chain type; keep `validateOverlayCombination()` unchanged
- `tests/overlays/registry.test.ts` — create — chain order + error cases

## Implementation spec

### `src/overlays/registry.ts`

```typescript
import type { OverlayProvider } from "../types/overlay-protocol.ts";
import type { ResolvedOverlayConfig } from "../config/remote-overlay-schema.ts";
import type { BaseOverlay } from "./base-overlay.ts";
import type { ObservabilityEmitter } from "../observability/emitter.ts";
import { LocalOverlayProvider } from "./local-overlay-provider.ts";
import { McpOverlayProvider } from "./mcp/mcp-overlay-provider.ts";
import { validateProviderCombination } from "./composition-rules.ts";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export interface RegistryInput {
  localOverlays: {
    hil?: BaseOverlay;
    policy_gate?: BaseOverlay;
    review?: BaseOverlay;
    paired?: BaseOverlay;
    confidence?: BaseOverlay;
  };
  remoteConfig?: ResolvedOverlayConfig;
  emitter?: ObservabilityEmitter; // required only when remoteConfig has remote_overlays
}

export function buildProviderChain(input: RegistryInput): OverlayProvider[];
```

**Chain build algorithm (exact order — this is an invariant):**
```
1. chain = []
2. if input.localOverlays.hil → chain.push(new LocalOverlayProvider(hil))
3. if input.remoteConfig?.remote_overlays:
     for each [name, cfg] of Object.entries(remote_overlays) (insertion order preserved):
       if !cfg.enabled: continue
       backend = input.remoteConfig.overlay_backends?.[cfg.backend]
       if !backend:
         throw new RegistryError(
           `remote_overlays['${name}'] references unknown backend '${cfg.backend}'. ` +
           `Add '${cfg.backend}' to overlay_backends in your config.`
         )
       if backend.runtime === "mcp":
         chain.push(new McpOverlayProvider(name, cfg, backend as ResolvedBackendConfig & { runtime: "mcp" }, emitter!))
       // CLI runtime: defer to Phase 3 — throw RegistryError for now
       else:
         throw new RegistryError(
           `remote_overlays['${name}']: backend runtime '${backend.runtime}' is not yet supported. ` +
           `Only 'mcp' is supported in this release.`
         )
4. if input.localOverlays.policy_gate → chain.push(new LocalOverlayProvider(policy_gate))
5. Check mutual exclusion BEFORE adding review/paired:
   if review?.enabled && paired?.enabled:
     throw new RegistryError(
       "Invariant 5 violated: Paired and Review overlays are mutually exclusive — cannot both be enabled"
     )
6. if input.localOverlays.review → chain.push(new LocalOverlayProvider(review))
7. if input.localOverlays.paired → chain.push(new LocalOverlayProvider(paired))
8. if input.localOverlays.confidence → chain.push(new LocalOverlayProvider(confidence))
9. // Validate the built chain
   const validation = validateProviderCombination(chain);
   if (!validation.valid):
     throw new RegistryError(validation.errors.join("; "))
10. return chain
```

**Note on `emitter` parameter**: When `remoteConfig` has no `remote_overlays`, `emitter` is never used. Accept it as optional in `RegistryInput` but throw `RegistryError` if a remote overlay is configured and `emitter` is `undefined`.

### Modification to `src/overlays/composition-rules.ts`

Add `validateProviderCombination()` as a new exported function alongside the existing `validateOverlayCombination()`. Do NOT modify the existing function.

```typescript
import type { OverlayProvider } from "../types/overlay-protocol.ts";

export function validateProviderCombination(
  providers: OverlayProvider[],
): CompositionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const enabledProviders = providers.filter((p) => p.enabled);

  // Invariant 1: HIL must be first when present
  const hilIdx = enabledProviders.findIndex((p) => p.id === "hil" && p.runtime === "local");
  if (hilIdx > 0) {
    errors.push("Invariant 1 violated: HIL overlay must be first in the chain");
  }

  // Invariant 5: Paired and Review mutually exclusive
  const hasReview = enabledProviders.some((p) => p.id === "review");
  const hasPaired = enabledProviders.some((p) => p.id === "paired");
  if (hasReview && hasPaired) {
    errors.push("Invariant 5 violated: Paired and Review overlays are mutually exclusive — cannot both be enabled");
  }

  // Invariant 6 (new): remote overlays must not appear after policy_gate
  const policyGateIdx = providers.findIndex((p) => p.id === "policy_gate" && p.runtime === "local");
  const lastRemoteIdx = providers.reduce((max, p, i) =>
    p.runtime !== "local" ? i : max, -1
  );
  if (policyGateIdx >= 0 && lastRemoteIdx > policyGateIdx) {
    errors.push(
      `Invariant 6 violated: remote overlays must not appear after policy_gate in the chain. ` +
      `Remote provider at index ${lastRemoteIdx} is after policy_gate at index ${policyGateIdx}.`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}
```

### CLI `run` command wiring

The CLI `run` command in `src/cli/commands/run.ts` currently calls `buildOverlayChain()` and passes the result to the `Engine` constructor as `overlayChain`. After T009 lands, it must call `buildProviderChain()` instead.

**This wiring is done in T009**. T005 only creates the registry and the composition rule extension. The `run.ts` file is not modified here.

## Tests to write

**File**: `tests/overlays/registry.test.ts`

Required test cases:

**Chain order invariants:**
1. Local-only config (no remote): chain order is HIL → policy_gate → confidence (for typical default overlays)
2. HIL is always first: even if overlays are passed in a different order, HIL appears at chain index 0
3. Remote overlay appears at index 1 (after HIL, before policy_gate): assert with one remote overlay configured
4. Multiple remote overlays preserve config insertion order: verify chain indices

**Error cases (no silent stubs — CLAUDE.md §3):**
5. Unknown backend reference → `RegistryError` with message naming the missing backend ID and the overlay name
6. Both Review and Paired enabled → `RegistryError` with message matching the existing composition error
7. `enabled: false` remote overlay is excluded from chain — chain length asserted

**Backward compat:**
8. `remoteConfig` absent → chain contains only `LocalOverlayProvider` instances; no `McpOverlayProvider`
9. All existing overlay types produce valid `LocalOverlayProvider` instances — constructor does not throw

**Integration point test (CLAUDE.md §2):**
10. After T009 lands, assert that `buildProviderChain` is called (not `buildOverlayChain`) when the engine runs — test lives in `tests/engine.test.ts`

**Composition rules extension:**
11. `validateProviderCombination`: valid chain (HIL → remote → policy_gate → confidence) → `valid: true`
12. `validateProviderCombination`: remote after policy_gate → `errors` includes Invariant 6 message
13. Existing `validateOverlayCombination` tests still pass (no regression)

## Acceptance criteria

- [ ] `src/overlays/registry.ts` exists and exports `buildProviderChain` and `RegistryError`
- [ ] Chain order is locked: HIL → remote overlays → policy_gate → review/paired → confidence
- [ ] Unknown backend reference throws `RegistryError` with actionable message naming both the overlay and the backend
- [ ] `enabled: false` remote overlay is excluded from the chain
- [ ] `validateProviderCombination` exported from `composition-rules.ts` enforces Invariants 1, 5, and 6
- [ ] Existing `validateOverlayCombination` function unchanged
- [ ] `bun run typecheck` exits 0
- [ ] All existing 177 tests still pass
