# Remote Overlay Implementation Plan - codex

Date: 2026-03-07
Related docs:
- `specs/merge-coding-standards/remote-overlay-mcp-architecture-codex.md`
- `specs/merge-coding-standards/hybrid-mcp-sidecar-strategy-codex.md`

## Goal

Implement a transport-neutral overlay system so `ai-sdd` can run:
1. local overlays in-process
2. external governance overlays via CLI sidecar first
3. MCP-backed remote overlays second

The first external overlay will be:

`requirements_governor`

## 1. Exact `ai-sdd` Interfaces

### Add to [`src/types/index.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/types/index.ts)

```ts
export type OverlayVerdict = "PASS" | "REWORK" | "FAIL" | "HIL";
export type OverlayHook = "pre_task" | "post_task";
export type OverlayRuntime = "local" | "cli" | "mcp";

export interface OverlayEvidence {
  overlay_id: string;
  source: OverlayRuntime;
  report_ref?: string;
  checks?: string[];
  data?: Record<string, unknown>;
}

export interface OverlayDecision {
  verdict: OverlayVerdict;
  feedback?: string;
  updated_context?: Partial<AgentContext>;
  evidence?: OverlayEvidence;
}

export interface OverlayBackendConfig {
  runtime: "cli" | "mcp";
  command?: string[];
  tool?: string;
  timeout_ms?: number;
  env?: Record<string, string>;
}

export interface RemoteOverlayConfig {
  backend: string;
  enabled?: boolean;
  hooks: OverlayHook[];
  phases?: string[];
  blocking?: boolean;
  config?: Record<string, unknown>;
}
```

Extend `ProjectConfig`:

```ts
overlay_backends?: Record<string, OverlayBackendConfig>;
remote_overlays?: Record<string, RemoteOverlayConfig>;
governance?: {
  requirements_lock?: "off" | "warn" | "enforce";
};
```

Extend `TaskDefinition` minimally:

```ts
requirement_ids?: string[];
acceptance_criteria?: Array<{
  scenario: string;
  given: string | string[];
  when: string;
  then: string[];
  and?: string[];
}>;
scope_excluded?: string[];
budget?: {
  max_new_files?: number;
  max_loc_delta?: number;
  max_new_public_apis?: number;
};
phase?: string;
```

### Add typed governance handover payload

```ts
export interface GatedHandoverState {
  tests_passed?: boolean;
  lint_passed?: boolean;
  security_clean?: boolean;
  ac_coverage?: Record<string, boolean>;
  new_files_created?: number;
  loc_delta?: number;
  new_public_apis?: number;
  blockers?: string[];
}
```

## 2. Overlay Runtime Layer

### New file

[`src/overlays/provider.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/provider.ts)

```ts
import type { OverlayContext } from "./base-overlay.ts";
import type {
  OverlayDecision,
  OverlayRuntime,
  OverlayHook,
  TaskResult,
} from "../types/index.ts";

export interface OverlayProvider {
  readonly id: string;
  readonly runtime: OverlayRuntime;
  readonly enabled: boolean;
  readonly hooks: OverlayHook[];
  readonly phases?: string[];

  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}
```

### Local compatibility adapter

New file:
[`src/overlays/local-overlay-provider.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/local-overlay-provider.ts)

Purpose:
1. wrap existing `BaseOverlay`
2. translate `OverlayResult` / `PostTaskOverlayResult` into `OverlayDecision`
3. keep engine migration low-risk

This lets existing overlays remain unchanged initially.

## 3. CLI Sidecar Provider

### New file

[`src/overlays/cli/cli-overlay-provider.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/cli/cli-overlay-provider.ts)

Responsibilities:
1. spawn external command
2. pass normalized JSON request over stdin or temp file
3. parse JSON response into `OverlayDecision`
4. enforce timeout
5. map transport errors to:
   - skip with warning in `warn`
   - fail closed in `enforce`

This is the first runtime to implement because it avoids MCP client work and reuses current `coding-standards` assets faster.

## 4. MCP Provider

### New file

[`src/overlays/mcp/mcp-overlay-provider.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/mcp/mcp-overlay-provider.ts)

Responsibilities:
1. connect to external MCP server
2. call one tool only: `overlay.invoke`
3. translate result into `OverlayDecision`
4. preserve same behavior contract as CLI provider

Important:
The transport must change without changing engine behavior. `cli` and `mcp` must share the same request/response schema.

## 5. Engine Changes

### Minimal change strategy

Do not rewrite the engine around a new concept immediately. Add a second chain runner for providers and migrate the chain build step.

### New file

[`src/overlays/provider-chain.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/provider-chain.ts)

Functions:
1. `runPreProviderChain()`
2. `runPostProviderChain()`

Behavior:
1. apply phase filtering before invocation
2. respect provider enabled flags
3. stop on first non-`PASS` decision

### Update [`src/core/engine.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/core/engine.ts)

Replace direct assumption of `BaseOverlay[]` with resolved provider chain:
1. local overlays wrapped as providers
2. remote overlays appended in configured order

Keep current HIL logic local. Remote provider may return `HIL`, but only local HIL overlay creates queue items and waits for resolution.

## 6. Overlay Resolution and Config Compilation

### New file

[`src/overlays/registry.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/registry.ts)

Responsibilities:
1. build local providers from built-in overlays
2. build remote providers from `remote_overlays`
3. compile both into one ordered runtime chain

Recommended default order:
1. `hil` local
2. `requirements_governor` remote
3. `policy_gate` local
4. `review` local
5. `paired` local
6. `confidence` local

This preserves current chain shape while inserting governance where it adds value.

## 7. MCP Schema to Add in `coding-standards`

### Add one new MCP tool

In:
[`tools/mcp-server/src/index.ts`](/Users/anjan/workspace/projects/coding-standards/tools/mcp-server/src/index.ts)

Tool name:

`overlay.invoke`

### Request schema

```json
{
  "type": "object",
  "properties": {
    "protocol_version": { "type": "string" },
    "overlay_id": { "type": "string" },
    "hook": { "type": "string", "enum": ["pre_task", "post_task"] },
    "workflow": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "run_id": { "type": "string" }
      },
      "required": ["id", "run_id"]
    },
    "task": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "phase": { "type": "string" },
        "requirement_ids": { "type": "array", "items": { "type": "string" } },
        "acceptance_criteria": { "type": "array" },
        "scope_excluded": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["id"]
    },
    "artifacts": {
      "type": "object",
      "properties": {
        "requirements_lock_path": { "type": "string" },
        "state_path": { "type": "string" }
      }
    },
    "result": {
      "type": "object",
      "properties": {
        "outputs": { "type": "array" },
        "handover_state": { "type": "object" }
      }
    },
    "config": {
      "type": "object",
      "properties": {
        "mode": { "type": "string", "enum": ["off", "warn", "enforce"] }
      }
    }
  },
  "required": ["protocol_version", "overlay_id", "hook", "workflow", "task"]
}
```

### Response schema

```json
{
  "type": "object",
  "properties": {
    "protocol_version": { "type": "string" },
    "verdict": { "type": "string", "enum": ["PASS", "REWORK", "FAIL", "HIL"] },
    "feedback": { "type": "string" },
    "evidence": {
      "type": "object",
      "properties": {
        "overlay_id": { "type": "string" },
        "source": { "type": "string", "enum": ["mcp"] },
        "checks": { "type": "array", "items": { "type": "string" } },
        "report_ref": { "type": "string" },
        "data": { "type": "object" }
      },
      "required": ["overlay_id", "source"]
    }
  },
  "required": ["protocol_version", "verdict"]
}
```

## 8. First Remote Overlay: `requirements_governor`

### Behavior

Pre-task:
1. check lock exists when mode is `warn` or `enforce`
2. check task has requirement linkage when governance fields are present
3. on planning/design phases, optionally run planning readiness checks

Post-task:
1. validate scope exclusions
2. run traceability/gap checks
3. compare spec hash when lock exists
4. summarize AC coverage if provided

### Internal implementation inside `coding-standards`

Use current assets rather than re-implementing there:
1. `tools/validators`
2. `tools/query-engine`
3. `scripts/reproducibility-check.sh`
4. `scripts/semantic-drift-check.sh`

The new MCP facade should compose these, not replace them.

## 9. Minimal Spike Plan

### Spike 1: `ai-sdd` local abstraction

Deliverables:
1. `OverlayDecision`
2. `OverlayProvider`
3. local overlay adapter
4. no behavior regression in current overlays

Success:
1. existing tests still pass or only need mechanical updates
2. engine behavior unchanged for local-only config

### Spike 2: CLI sidecar `requirements_governor`

Deliverables:
1. `CliOverlayProvider`
2. one external command contract
3. `remote_overlays` config support

Success:
1. one task can be gated by external governance in `warn` mode
2. failures surface as `NEEDS_REWORK` with clear feedback

### Spike 3: `coding-standards` MCP facade

Deliverables:
1. `overlay.invoke` in `coding-standards`
2. response mapped to normalized overlay decision

Success:
1. same overlay request works over both `cli` and `mcp`
2. ai-sdd switches transport without engine changes

## 10. Files to Change First

In `ai-sdd`:
1. [`src/types/index.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/types/index.ts)
2. [`src/core/engine.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/core/engine.ts)
3. [`src/overlays/provider.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/provider.ts)
4. [`src/overlays/provider-chain.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/provider-chain.ts)
5. [`src/overlays/local-overlay-provider.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/local-overlay-provider.ts)
6. [`src/overlays/cli/cli-overlay-provider.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/cli/cli-overlay-provider.ts)
7. [`src/overlays/mcp/mcp-overlay-provider.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/mcp/mcp-overlay-provider.ts)
8. [`src/overlays/registry.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/overlays/registry.ts)
9. [`src/cli/config-loader.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/config-loader.ts)
10. [`src/cli/commands/init.ts`](/Users/anjan/workspace/projects/ai/ai-sdd/ai-sdd-claude/src/cli/commands/init.ts)

In `coding-standards`:
1. [`tools/mcp-server/src/index.ts`](/Users/anjan/workspace/projects/coding-standards/tools/mcp-server/src/index.ts)

## Final Recommendation

Implement the abstraction first, not the whole governance feature set.

The order should be:
1. local/remote overlay contract
2. CLI sidecar provider
3. one bundled external governance overlay
4. MCP transport for the same overlay

That gives you the best of both repos with the least risk and the least growth in `ai-sdd` complexity.

