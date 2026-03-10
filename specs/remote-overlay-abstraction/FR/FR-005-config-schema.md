# FR-005: Configuration Schema for Overlay Backends and Remote Overlays

## Metadata
- **Area:** Configuration
- **Priority:** MUST
- **Source:** constitution.md — Scope; `src/config/remote-overlay-schema.ts` (Zod schemas and parsers)

## Description

The system must define and Zod-validate two new optional top-level configuration sections that
can appear in `.ai-sdd/ai-sdd.yaml`. These sections are parsed separately from the existing
`ProjectConfig` to preserve backward compatibility. Their complete absence must result in
zero behavioral change and zero warnings.

### `overlay_backends`

A map from a backend ID string to a backend configuration object. Each backend describes how
to launch and communicate with a single remote overlay server.

Zod schema (each field annotated with default behavior):

```typescript
const OverlayBackendConfigSchema = z.object({
  runtime: z.enum(["cli", "mcp"]),
  command: z.array(z.string()).min(1),          // required; at least one element
  tool: z.string().optional(),                  // required when runtime is "mcp"
  transport: z.enum(["stdio"]).default("stdio"),
  timeout_ms: z.number().int().positive().default(5000),
  failure_policy: z.enum(["skip", "warn", "fail_closed"]).default("warn"),
  env: z.record(z.string()).optional(),
}).refine(
  (data) => data.runtime !== "mcp" || data.tool !== undefined,
  { message: "overlay_backends: 'tool' is required when runtime is 'mcp'", path: ["tool"] }
);
```

The `command` array must contain at least one element (the executable path). The `refine`
constraint enforcing `tool` when `runtime` is `"mcp"` must run as a Zod refinement, not only
at runtime in `McpOverlayProvider`.

### `remote_overlays`

A map from an overlay name string to a remote overlay configuration. Each entry binds a named
overlay to a backend and declares which hooks and task phases it applies to.

Zod schema:

```typescript
const RemoteOverlayConfigSchema = z.object({
  backend: z.string(),
  enabled: z.boolean().default(true),
  hooks: z.array(z.enum(["pre_task", "post_task"])).min(1, {
    message: "remote_overlays: 'hooks' must contain at least one hook (pre_task or post_task)",
  }),
  phases: z.array(z.string()).optional(),
  blocking: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});
```

The `blocking` field controls Tier 1 failure behavior in `McpOverlayProvider`: when `false`,
any transport error is treated as `failure_policy: "warn"` regardless of the backend's configured
`failure_policy`. Schema violations (Tier 2) are always `fail_closed` regardless of `blocking`.

### `governance` block

A top-level `governance` section captures requirements-lock enforcement mode:

```typescript
const GovernanceConfigSchema = z.object({
  requirements_lock: z.enum(["off", "warn", "enforce"]).default("warn"),
});
```

This section is optional at the top level of `ai-sdd.yaml`. Absence defaults to
`{ requirements_lock: "warn" }`.

### Container schema

The three sections are grouped in a container schema that is parsed independently:

```typescript
const RemoteOverlaysSectionSchema = z.object({
  governance: GovernanceConfigSchema.optional(),
  overlay_backends: z.record(OverlayBackendConfigSchema).optional(),
  remote_overlays: z.record(RemoteOverlayConfigSchema).optional(),
}).optional();
```

The parser function `parseRemoteOverlayConfig(raw: unknown)` must return `undefined` when the
section is absent, and must throw `ZodError` on validation failure.

### Config merge integration

The new sections must be loaded as part of the config loading pipeline. Existing `ProjectConfig`
fields must not be modified. The `ai-sdd validate-config` CLI command must surface validation
errors for the new sections using the same error format and exit code as existing config
validation errors.

## Acceptance criteria

```gherkin
Feature: Remote overlay configuration schema

  Scenario: Valid overlay_backends and remote_overlays config is accepted
    Given a .ai-sdd/ai-sdd.yaml with valid overlay_backends and remote_overlays sections
    When parseRemoteOverlayConfig parses the config
    Then no error is raised
    And the returned object exposes typed overlay_backends and remote_overlays maps

  Scenario: MCP backend without tool field is rejected with actionable message
    Given an overlay_backends entry with runtime "mcp" and no "tool" field
    When parseRemoteOverlayConfig parses the config
    Then a ZodError is raised
    And the error message states "'tool' is required when runtime is 'mcp'"

  Scenario: hooks array with zero entries is rejected
    Given a remote_overlays entry with hooks as an empty array
    When parseRemoteOverlayConfig parses the config
    Then a ZodError is raised naming the minimum-one-hook constraint

  Scenario: timeout_ms defaults to 5000 when omitted
    Given an overlay_backends entry with no timeout_ms field
    When parseRemoteOverlayConfig parses the entry
    Then the resolved config has timeout_ms equal to 5000

  Scenario: failure_policy defaults to warn when omitted
    Given an overlay_backends entry with no failure_policy field
    When parseRemoteOverlayConfig parses the entry
    Then the resolved config has failure_policy equal to "warn"

  Scenario: blocking defaults to true when omitted
    Given a remote_overlays entry with no blocking field
    When parseRemoteOverlayConfig parses the entry
    Then the resolved config has blocking equal to true

  Scenario: Absence of the section returns undefined without errors
    Given a .ai-sdd/ai-sdd.yaml with no overlay_backends, remote_overlays, or governance keys
    When parseRemoteOverlayConfig is called with the raw config
    Then it returns undefined
    And no errors or warnings are produced

  Scenario: validate-config reports new config errors with consistent format
    Given a .ai-sdd/ai-sdd.yaml with an invalid remote overlay config section
    When "ai-sdd validate-config" is run
    Then the command exits with a non-zero status code
    And the output includes the validation error message
```

## Related
- FR: FR-003 (McpClientWrapper constructed from ResolvedBackendConfig), FR-004 (registry consumes ResolvedOverlayConfig)
- NFR: NFR-004 (backward compatibility — absent config must not change behavior)
- Depends on: none (standalone Zod schema definitions)
