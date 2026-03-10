# T001 — Type System Foundation

## Metadata
- **ID**: T001
- **FR/NFR**: FR-001, FR-002, NFR-004
- **Owner**: developer
- **Depends on**: none
- **Estimate**: M (2-4h)

## Context

The codebase currently has two parallel overlay type systems that will diverge over time: `BaseOverlay` in `src/overlays/base-overlay.ts` (returns `OverlayResult` / `PostTaskOverlayResult`) and the engine which consumes those results directly. The remote overlay abstraction requires a normalized protocol type — `OverlayDecision` — that every provider returns, regardless of whether it is local or remote.

This task creates `src/types/overlay-protocol.ts` as the canonical home for all transport-agnostic protocol types. It also exports these types from `src/types/index.ts` so downstream tasks have a single import location. This is a pure addition with zero behavioral changes — no existing files are modified beyond the `index.ts` re-export.

## Files to create/modify

- `src/types/overlay-protocol.ts` — create — all protocol types (OverlayVerdict, OverlayDecision, OverlayProvider interface, OverlayContext, OverlayInvokeOutputSchema, OverlayInvokeInput)
- `src/types/index.ts` — modify — add `export * from "./overlay-protocol.ts"` and add `overlay_evidence` field to `TaskState`, add remote overlay event types to `EventType`
- `tests/overlays/overlay-protocol.test.ts` — create — Zod schema tests for the wire format

## Implementation spec

### `src/types/overlay-protocol.ts`

```typescript
import { z } from "zod";
import type { AgentContext, TaskResult } from "./index.ts";

export type OverlayRuntime = "local" | "cli" | "mcp";
export type OverlayHook = "pre_task" | "post_task";

// String union (not enum keyword) — ensures TypeScript exhaustiveness checks
// compile-fail if a new value is added without a handler in switch statements.
export type OverlayVerdict = "PASS" | "REWORK" | "FAIL" | "HIL";

export interface OverlayEvidence {
  overlay_id: string;
  source: OverlayRuntime;
  checks?: string[];
  report_ref?: string;
  data?: Record<string, unknown>;
}

export interface OverlayDecision {
  verdict: OverlayVerdict;
  feedback?: string;
  /** Engine MUST strip identity fields (task_id, status, workflow_id, run_id) before applying. */
  updated_context?: Partial<AgentContext>;
  evidence?: OverlayEvidence;
}

export interface OverlayContext {
  task_id: string;
  workflow_id: string;
  run_id: string;
  task_definition: import("./index.ts").TaskDefinition;
  agent_context: AgentContext;
}

export interface OverlayProvider {
  readonly id: string;
  readonly runtime: OverlayRuntime;
  readonly hooks: OverlayHook[];
  readonly enabled: boolean;
  readonly phases?: string[];
  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}

// Zod schema for MCP wire format — only schema used to validate remote responses
export const OverlayInvokeOutputSchema = z.object({
  protocol_version: z.literal("1"),
  verdict: z.enum(["PASS", "REWORK", "FAIL", "HIL"]),
  feedback: z.string().optional(),
  evidence: z.object({
    overlay_id: z.string(),
    checks: z.array(z.string()).optional(),
    report_ref: z.string().optional(),
    data: z.record(z.unknown()).optional(),
  }).optional(),
});

export type OverlayInvokeOutput = z.infer<typeof OverlayInvokeOutputSchema>;

export interface OverlayInvokeInput {
  protocol_version: "1";
  overlay_id: string;
  hook: OverlayHook;
  workflow: { id: string; run_id: string };
  task: {
    id: string;
    phase?: string;
    requirement_ids?: string[];
    acceptance_criteria?: unknown[];
    scope_excluded?: string[];
  };
  artifacts?: {
    requirements_lock_path?: string;
    state_path?: string;
    outputs?: Array<{ path: string; contract?: string }>;
  };
  result?: {
    outputs?: Array<{ path: string; contract?: string }>;
    handover_state?: Record<string, unknown>;
  };
  config?: Record<string, unknown>;
}
```

### Modifications to `src/types/index.ts`

1. Add `overlay_evidence` optional field to `TaskState`:
   ```typescript
   overlay_evidence?: import("./overlay-protocol.ts").OverlayEvidence;
   ```
2. Add remote overlay event types to `EventType`:
   ```typescript
   | "overlay.remote.connecting"
   | "overlay.remote.connected"
   | "overlay.remote.invoked"
   | "overlay.remote.decision"
   | "overlay.remote.failed"
   | "overlay.remote.fallback"
   ```
3. Add `export * from "./overlay-protocol.ts"` at the end of the file.

Note: `OverlayContext` in `overlay-protocol.ts` is structurally identical to `OverlayContext` in `base-overlay.ts`. Do NOT delete the `base-overlay.ts` version — it is imported by all existing overlay implementations. Both must coexist until overlays are migrated.

## Tests to write

**File**: `tests/overlays/overlay-protocol.test.ts`

```typescript
// Tests must use Bun test runner: import { test, expect } from "bun:test"
// Test: OverlayInvokeOutputSchema accepts a valid response
// Test: OverlayInvokeOutputSchema rejects unknown verdict "FORCE_ACCEPT"
// Test: OverlayInvokeOutputSchema rejects response missing verdict field
// Test: OverlayInvokeOutputSchema rejects protocol_version "2"
// Test: OverlayInvokeOutputSchema rejects empty string (parse attempt)
// Test: OverlayInvokeOutputSchema accepts optional evidence field absent
// Test: OverlayInvokeOutputSchema accepts all four valid verdict values
```

For each rejection test, use `OverlayInvokeOutputSchema.safeParse(input)` and assert `result.success === false`.

## Acceptance criteria

- [ ] `src/types/overlay-protocol.ts` exists and exports all types listed above
- [ ] `OverlayVerdict` is a string union (`type`, not `enum`)
- [ ] `OverlayInvokeOutputSchema` rejects `verdict: "FORCE_ACCEPT"` with `success: false`
- [ ] `OverlayInvokeOutputSchema` rejects `protocol_version: "2"` with `success: false`
- [ ] `TaskState` in `src/types/index.ts` includes `overlay_evidence?: OverlayEvidence`
- [ ] `EventType` in `src/types/index.ts` includes all 6 remote overlay event types
- [ ] `bun run typecheck` exits 0 — no TypeScript errors
- [ ] All existing 177 tests still pass
- [ ] `tests/overlays/overlay-protocol.test.ts` exists with tests for all 7 schema scenarios above
