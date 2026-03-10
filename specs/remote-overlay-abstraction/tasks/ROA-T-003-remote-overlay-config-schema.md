# ROA-T-003: Remote Overlay Config Schema (`src/config/remote-overlay-schema.ts`)

## Metadata
- **Feature:** Remote Overlay Abstraction
- **Component:** Component G — `src/config/remote-overlay-schema.ts`
- **Effort:** S
- **Risk:** LOW
- **Depends on:** ROA-T-001
- **Blocks:** ROA-T-005, ROA-T-006
- **Requirements:** FR-005, NFR-004
- **Status:** COMPLETE — file exists and all Zod schemas are implemented

## Description

Define Zod schemas for the two new optional config sections (`overlay_backends`,
`remote_overlays`) and the `governance` block in `src/config/remote-overlay-schema.ts`.
Expose `parseRemoteOverlayConfig(raw)` as the single parse entry point. These schemas
are parsed independently from the existing `ProjectConfig` to preserve backward
compatibility.

Key schema rules:
- `tool` is required when `runtime === "mcp"` (enforced via `.refine()`).
- `timeout_ms` defaults to `5000`; `failure_policy` defaults to `"warn"`;
  `blocking` defaults to `true`.
- Absence of all three sections returns `undefined` with no errors.
- `ZodError` is thrown on validation failure; callers surface it to the user.

The `validate-config` CLI command in `src/cli/commands/validate-config.ts` must call
`parseRemoteOverlayConfig` and surface any `ZodError` with a non-zero exit code,
using the same error format as existing config validation errors.

## Files to create/modify

| File | Action |
|------|--------|
| `src/config/remote-overlay-schema.ts` | Create |
| `src/cli/commands/validate-config.ts` | Modify — add remote overlay config validation step |
| `src/cli/config-loader.ts` | Modify — add `loadRemoteOverlayConfig()` helper |

## Acceptance criteria

```gherkin
Feature: Remote overlay configuration schema

  Scenario: Valid overlay_backends and remote_overlays config is accepted
    Given a raw config with valid overlay_backends and remote_overlays sections
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

  Scenario: Absence of the section returns undefined without errors
    Given a raw config with no overlay_backends, remote_overlays, or governance keys
    When parseRemoteOverlayConfig is called
    Then it returns undefined
    And no errors or warnings are produced

  Scenario: validate-config reports new config errors with consistent format
    Given a .ai-sdd/ai-sdd.yaml with an invalid remote overlay config section
    When "ai-sdd validate-config" is run
    Then the command exits with a non-zero status code
    And the output includes the validation error message
```

## Implementation notes

- `OverlayBackendConfigSchema` uses `.refine()` for the MCP `tool` requirement.
  This validation runs at parse time, not deferred to `McpOverlayProvider` construction.
- `RemoteOverlaysSectionSchema` is `.optional()` — absent sections return `undefined`.
- All new Zod-inferred types are exported:
  `ResolvedBackendConfig`, `ResolvedRemoteOverlayConfig`, `ResolvedGovernanceConfig`,
  `ResolvedOverlayConfig`.
- No `eval()` or dynamic execution anywhere in this file (NFR-003 static check).

## Definition of done

- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests in `tests/config/remote-overlay-schema.test.ts`
- [ ] CLI integration test verifies `validate-config` exit code for invalid remote overlay config
- [ ] `bun run typecheck` passes with zero errors
- [ ] `bun test` shows all 505+ existing tests still pass
