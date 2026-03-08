# MCP Server Integration

## Overview

ai-sdd integrates two external MCP servers as remote overlays via its native remote overlay
support. Both servers run as `post_task` gates on `implement` phase tasks, providing
evidence-based checks without blocking the workflow (non-blocking, failure policy: warn).

## Backends

### repeatability-gate (repeatability-mcp-server)

| Property | Value |
|----------|-------|
| Backend  | `repeatability-mcp` |
| Runtime  | `mcp` |
| Tool     | `lock_validate` |
| Script   | `/Users/anjan/workspace/projects/ai/repeatability-mcp-server/dist/index.js` |
| Hooks    | `post_task` |
| Phases   | `implement` |
| Blocking | false |
| failure_policy | warn |

Validates requirement lock drift — checks that implemented tasks cover all locked requirements
and detects coverage gaps. Uses the `lock_validate` tool from `requirement-lock-server`
(npm package name), which requires a built `dist/` directory (`pnpm build` in the repo).

### coding-standards-gate (coding-standards-mcp-server)

| Property | Value |
|----------|-------|
| Backend  | `coding-standards-mcp` |
| Runtime  | `mcp` |
| Tool     | `check_requirements` |
| Script   | `/Users/anjan/workspace/projects/coding-standards/tools/mcp-server/dist/index.js` |
| Hooks    | `post_task` |
| Phases   | `implement` |
| Blocking | false |
| failure_policy | warn |

Validates implementation output against coding standards schema. Uses the
`check_requirements` tool from `@coding-standards/mcp-server`. Requires the tools/mcp-server
`dist/` to be built (`npm run build`).

## Availability Probing

At `ai-sdd run` startup, before building the overlay chain, each enabled remote overlay's
backend command paths are probed for existence. Any absolute or relative path in the
`command[]` array that is not found on disk triggers a console warning and the overlay is
skipped for that run:

```
[ai-sdd] Remote overlay 'coding-standards-gate' unavailable: path not found:
  /path/to/coding-standards/tools/mcp-server/dist/index.js.
  Skipping. Set enabled: false in ai-sdd.yaml to suppress this warning.
```

System commands (e.g. `node`, `bun`) are not probed — only file paths are checked.

## Disable Mechanisms

Three ways to disable remote overlays (in increasing permanence):

### 1. Environment variables (per-run, no config change)

```bash
# Disable all remote overlays for this run
AI_SDD_DISABLE_REMOTE_OVERLAYS=true ai-sdd run

# Disable a specific overlay (NAME = overlay key, uppercase, hyphens→underscores)
AI_SDD_DISABLE_OVERLAY_REPEATABILITY_GATE=true ai-sdd run
AI_SDD_DISABLE_OVERLAY_CODING_STANDARDS_GATE=true ai-sdd run
```

Useful when overlays are configured at user/team level but need to be suppressed for
a specific project or run. Prints a console warning when triggered.

### 2. Config file (persistent, per-project override)

Set `enabled: false` in `.ai-sdd/ai-sdd.yaml`:

```yaml
remote_overlays:
  coding-standards-gate:
    backend: coding-standards-mcp
    enabled: false   # silently skipped, no warning
    hooks: [post_task]
    phases: [implement]
    blocking: false
```

### 3. Remove from config (complete removal)

Delete or comment out the `remote_overlays` entry entirely to stop the overlay from
being loaded at all.

## Two-Tier Failure Model

Both overlays inherit the standard McpOverlayProvider failure model:

- **Tier 1 (transport)** — governed by `failure_policy: warn`. On connect/call failure:
  emits `overlay.remote.failed` + `overlay.remote.fallback`, returns `PASS`. Run continues.
- **Tier 2 (schema)** — always `fail_closed`. If MCP response fails `OverlayInvokeOutputSchema`
  validation, returns `FAIL` verdict regardless of `failure_policy`.
- **blocking: false** — overrides Tier 1 to effectively `warn` regardless of `failure_policy`.
  Schema (Tier 2) failures still propagate.

## Config Location

All configuration is in `.ai-sdd/ai-sdd.yaml` under `overlay_backends` and `remote_overlays`
sections. See that file for the full configuration with inline comments.
