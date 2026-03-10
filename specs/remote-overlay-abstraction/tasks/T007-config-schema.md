# T007 — Config Schema

## Metadata
- **ID**: T007
- **FR/NFR**: FR-005, NFR-004
- **Owner**: developer
- **Depends on**: T001
- **Estimate**: M (2-4h)

## Context

Remote overlays need two new config sections in `.ai-sdd/ai-sdd.yaml`: `overlay_backends` (defines remote processes) and `remote_overlays` (binds overlays to backends with hooks and phase filters). A third section, `governance`, configures requirements enforcement mode.

The config loader is `src/cli/config-loader.ts` (locate by checking the import in `src/cli/commands/run.ts`). The new schemas must be parsed separately from `ProjectConfig` to preserve backward compatibility — the 177 existing tests import `ProjectConfig` from `src/types/index.ts` and must not be broken by new fields.

**Important**: Do not add `overlay_backends` or `remote_overlays` as fields on `ProjectConfig`. Instead, create `src/config/remote-overlay-schema.ts` with independent schemas and a `parseRemoteOverlayConfig()` function. The `governance` block is the only exception — it is added as an optional field on `ProjectConfig` because it is a simple scalar and has a default.

The `validate-config` CLI command must surface errors from the new schemas in the same format as existing errors.

## Files to create/modify

- `src/config/remote-overlay-schema.ts` — create — Zod schemas + `parseRemoteOverlayConfig()`
- `src/types/index.ts` — modify — add `governance?: { requirements_lock?: "off" | "warn" | "enforce" }` to `ProjectConfig`
- `src/config/defaults.ts` — modify — add `governance: { requirements_lock: "warn" }` to `DEFAULT_CONFIG`
- `src/cli/config-loader.ts` — locate and modify — parse remote overlay config section alongside project config
- `src/cli/commands/validate-config.ts` — modify — call `parseRemoteOverlayConfig` and report errors in existing format
- `tests/config/remote-overlay-schema.test.ts` — create — schema validation tests

## Implementation spec

### `src/config/remote-overlay-schema.ts`

```typescript
import { z } from "zod";

export const OverlayBackendConfigSchema = z.object({
  runtime: z.enum(["cli", "mcp"]),
  command: z.array(z.string()).min(1),
  tool: z.string().optional(),                           // required when runtime is "mcp"
  transport: z.enum(["stdio"]).default("stdio"),
  timeout_ms: z.number().int().positive().default(5000),
  failure_policy: z.enum(["skip", "warn", "fail_closed"]).default("warn"),
  env: z.record(z.string()).optional(),
}).refine(
  (data) => data.runtime !== "mcp" || data.tool !== undefined,
  {
    message: "overlay_backends: 'tool' is required when runtime is 'mcp'",
    path: ["tool"],
  },
);

export const RemoteOverlayConfigSchema = z.object({
  backend: z.string(),
  enabled: z.boolean().default(true),
  hooks: z.array(z.enum(["pre_task", "post_task"])).min(1, {
    message: "remote_overlays: 'hooks' must contain at least one hook (pre_task or post_task)",
  }),
  phases: z.array(z.string()).optional(),
  blocking: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});

export const GovernanceConfigSchema = z.object({
  requirements_lock: z.enum(["off", "warn", "enforce"]).default("warn"),
});

export const RemoteOverlaysSectionSchema = z.object({
  governance: GovernanceConfigSchema.optional(),
  overlay_backends: z.record(OverlayBackendConfigSchema).optional(),
  remote_overlays: z.record(RemoteOverlayConfigSchema).optional(),
}).optional();

export type ResolvedBackendConfig = z.infer<typeof OverlayBackendConfigSchema>;
export type ResolvedRemoteOverlayConfig = z.infer<typeof RemoteOverlayConfigSchema>;
export type ResolvedGovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

export interface ResolvedOverlayConfig {
  governance?: ResolvedGovernanceConfig;
  overlay_backends?: Record<string, ResolvedBackendConfig>;
  remote_overlays?: Record<string, ResolvedRemoteOverlayConfig>;
}

/**
 * Parse and validate the remote overlay config section.
 * Returns undefined if the section is absent (no-op for existing configs).
 * Throws ZodError on validation failure.
 */
export function parseRemoteOverlayConfig(raw: unknown): ResolvedOverlayConfig | undefined {
  const result = RemoteOverlaysSectionSchema.parse(raw);
  return result;
}
```

### Modifications to `src/types/index.ts`

Add optional `governance` field to `ProjectConfig`:
```typescript
governance?: {
  requirements_lock?: "off" | "warn" | "enforce";
};
```

### Modifications to `src/config/defaults.ts`

Add governance default to `DEFAULT_CONFIG`. The `Required<ProjectConfig>` constraint requires this field to be present:
```typescript
governance: {
  requirements_lock: "warn",
},
```

Note: if `Required<ProjectConfig>` cannot accommodate a nested optional, define the governance field as non-optional with a default value type.

### Locate and modify the config loader

The config loader is imported as `loadProjectConfig` in `src/cli/commands/run.ts`, `status.ts`, etc. Find the file by running `grep -r "loadProjectConfig" src/cli/` to locate `src/cli/config-loader.ts`.

The loader reads the YAML file and returns `ProjectConfig`. Modify it to also call `parseRemoteOverlayConfig(rawYaml)` and return it alongside the project config. Two options:
- Option A: Return a new type `{ config: ProjectConfig; remoteOverlayConfig?: ResolvedOverlayConfig }` from `loadProjectConfig`.
- Option B: Create a separate `loadRemoteOverlayConfig(projectPath)` function.

Prefer **Option B** to avoid breaking the existing `loadProjectConfig` signature used by 177 tests. The CLI `run.ts` calls both functions.

### Modifications to `src/cli/commands/validate-config.ts`

Add a validation step for the remote overlay config:
```typescript
try {
  const rawConfig = loadRawYaml(projectPath); // read raw YAML without parsing
  parseRemoteOverlayConfig(rawConfig);
  console.log("  ✓ remote overlay config (overlay_backends / remote_overlays)");
} catch (err) {
  console.error(`  ✗ remote overlay config: ${err instanceof Error ? err.message : String(err)}`);
  hasErrors = true;
}
```

Note: only execute this block when the YAML file has at least one of `overlay_backends`, `remote_overlays`, or `governance` keys, to avoid false errors on files that predate the feature.

## Tests to write

**File**: `tests/config/remote-overlay-schema.test.ts`

Required test cases:

**Schema validation:**
1. Valid MCP backend + remote overlay config accepted — `parseRemoteOverlayConfig` returns typed object
2. MCP backend without `tool` field → ZodError — message includes `"tool"` and `"mcp"`
3. `hooks: []` (empty array) → ZodError — message includes `"hooks"` and minimum constraint
4. `timeout_ms` defaults to 5000 when omitted — parsed config has `timeout_ms === 5000`
5. `failure_policy` defaults to `"warn"` when omitted — parsed config has `failure_policy === "warn"` (CLAUDE.md §1: config field change → behavior change)
6. `enabled` defaults to `true` when omitted
7. `blocking` defaults to `true` when omitted
8. Absent section (input `undefined`) → `parseRemoteOverlayConfig(undefined)` returns `undefined`
9. Absent section → no behavior change (existing config files load without error)

**Config-to-behavior tests (CLAUDE.md §1 — required):**
10. `failure_policy: "fail_closed"` → when integrated with `McpOverlayProvider` (T004), a transport error causes FAIL verdict. Change to `failure_policy: "warn"` → transport error causes PASS. Assert different verdicts.
11. `timeout_ms: 100` → `McpClientWrapper` times out at ~100ms. Change to `timeout_ms: 2000` → same mock server does not time out. Assert different outcomes.

**CLI integration (CLAUDE.md §7 — one integration test per CLI command):**
12. `validate-config` command with invalid remote overlay config → exits with non-zero status; output includes error details in same format as existing errors
13. `validate-config` command with no remote overlay config present → exits zero; no false errors emitted

**Error messages are contracts (CLAUDE.md §5):**
14. MCP backend without tool: assert the error message text includes `"tool"` and `"mcp"` exactly as documented — not just that an error is thrown

## Acceptance criteria

- [ ] `src/config/remote-overlay-schema.ts` exists and exports all schemas and types
- [ ] MCP backend without `tool` throws ZodError with message naming `"tool"` and `"mcp"`
- [ ] `hooks: []` throws ZodError with message naming the minimum constraint
- [ ] `timeout_ms` defaults to 5000
- [ ] `failure_policy` defaults to `"warn"`
- [ ] `parseRemoteOverlayConfig(undefined)` returns `undefined`
- [ ] `ProjectConfig` in `src/types/index.ts` has optional `governance` field
- [ ] `DEFAULT_CONFIG` in `src/config/defaults.ts` has `governance.requirements_lock === "warn"`
- [ ] `validate-config` command reports schema errors for new sections
- [ ] Existing `.ai-sdd/ai-sdd.yaml` files without new keys load without errors
- [ ] `bun run typecheck` exits 0
- [ ] All existing 177 tests still pass
