# FR-005: Configuration Schema

## Metadata
- **Area:** Configuration
- **Priority:** MUST
- **Source:** REMOTE-OVERLAY-PLAN.md §4.1, §4.2; constitution.md Scope

## Description

The system must define and validate two new top-level configuration sections in `.ai-sdd/ai-sdd.yaml` using Zod schemas located in `src/config/remote-overlay-schema.ts`. Both sections are optional; their absence must leave all existing behavior unchanged.

### `overlay_backends`

A map of backend ID to backend configuration. Each backend describes a remote process that implements the `overlay.invoke` protocol.

Zod schema:

```typescript
const OverlayBackendConfig = z.object({
  runtime: z.enum(["cli", "mcp"]),
  command: z.array(z.string()),
  tool: z.string().optional(),            // required when runtime is "mcp"
  transport: z.enum(["stdio"]).default("stdio"),
  timeout_ms: z.number().int().positive().default(5000),
  failure_policy: z.enum(["skip", "warn", "fail_closed"]).default("warn"),
  env: z.record(z.string()).optional(),   // environment variables for CLI runtime
});
```

Additional validation rule: when `runtime` is `"mcp"`, the `tool` field must be present. This must be enforced as a Zod `.refine()` check, not only at runtime.

### `remote_overlays`

A map of overlay name to remote overlay configuration. Each entry binds a named overlay to a backend and declares its hooks and phase scope.

Zod schema:

```typescript
const RemoteOverlayConfig = z.object({
  backend: z.string(),
  enabled: z.boolean().default(true),
  hooks: z.array(z.enum(["pre_task", "post_task"])).min(1),
  phases: z.array(z.string()).optional(),
  blocking: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});
```

### `governance` block

A top-level governance configuration block must be added to `ProjectConfig`:

```typescript
const GovernanceConfig = z.object({
  requirements_lock: z.enum(["off", "warn", "enforce"]).default("warn"),
});
```

Default value when omitted: `{ requirements_lock: "warn" }`.

### Config merge

The new config sections must be parsed and validated as part of the existing 4-layer config merge order: `CLI flags > project .ai-sdd/ai-sdd.yaml > src/config/defaults.ts`. They must not replace any existing config keys. The `validate-config` CLI command must report validation errors for the new sections using the same error format as existing config validation.

## Acceptance Criteria

```gherkin
Feature: Remote overlay configuration schema validation

  Scenario: Valid overlay_backends and remote_overlays config is accepted
    Given a .ai-sdd/ai-sdd.yaml with a valid overlay_backends and remote_overlays section
    When the config loader parses the file
    Then no validation errors are raised
    And the parsed config exposes overlay_backends and remote_overlays as typed objects

  Scenario: MCP backend without tool field is rejected
    Given an overlay_backends entry with runtime "mcp" and no "tool" field
    When the config loader parses the file
    Then a validation error is raised
    And the error message states that "tool" is required for mcp runtime

  Scenario: hooks array with zero entries is rejected
    Given a remote_overlays entry with an empty hooks array
    When the config loader parses the file
    Then a validation error is raised naming the empty hooks constraint

  Scenario: timeout_ms defaults to 5000 when omitted
    Given an overlay_backends entry with no timeout_ms field
    When the config loader parses the entry
    Then the parsed config has timeout_ms equal to 5000

  Scenario: failure_policy defaults to warn when omitted
    Given an overlay_backends entry with no failure_policy field
    When the config loader parses the entry
    Then the parsed config has failure_policy equal to "warn"

  Scenario: Absence of overlay_backends leaves existing behavior unchanged
    Given a .ai-sdd/ai-sdd.yaml with no overlay_backends or remote_overlays sections
    When the workflow engine runs
    Then it behaves identically to pre-feature behavior
    And no errors or warnings about missing remote overlay config are emitted

  Scenario: validate-config command reports new config errors
    Given a .ai-sdd/ai-sdd.yaml with an invalid remote overlay config
    When "ai-sdd validate-config" is run
    Then the command exits with a non-zero status
    And the output includes the validation error details in the same format as existing errors
```

## Related
- FR: FR-004 (registry consumes this config), FR-003 (McpClientWrapper built from OverlayBackendConfig)
- NFR: NFR-004 (backward compatibility — existing config must not break)
- Depends on: none (standalone schema definition)
