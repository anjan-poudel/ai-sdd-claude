# T004 — McpOverlayProvider

## Metadata
- **ID**: T004
- **FR/NFR**: FR-001, FR-002, FR-008, NFR-001, NFR-002, NFR-003
- **Owner**: developer
- **Depends on**: T001, T003, T007
- **Estimate**: L (4-8h)

## Context

`McpOverlayProvider` is the `OverlayProvider` implementation for remote MCP backends. It delegates all MCP communication to `McpClientWrapper` (T003), validates responses with `OverlayInvokeOutputSchema` (from T001), and maps the two-tier failure model per `failure_policy` from the backend config (T007).

Two-tier failure model is the central design decision:
- **Tier 1** (transport error): connection refused, timeout, process crash. Governed by `failure_policy` in the backend config (`skip | warn | fail_closed`). Default is `warn`.
- **Tier 2** (schema violation): invalid JSON, unknown verdict, missing required fields. Always `fail_closed` regardless of `failure_policy`. This is a hard security invariant — a malformed response can never silently pass.

The `blocking: false` field on the remote overlay config overrides Tier 1 to always behave as `warn` (not `fail_closed`). It does NOT override Tier 2.

This provider emits observability events (from T010) for the full invocation lifecycle.

## Files to create/modify

- `src/overlays/mcp/mcp-overlay-provider.ts` — create — `McpOverlayProvider` class
- `tests/overlays/mcp/mcp-overlay-provider.test.ts` — create — all failure modes + lifecycle events

## Implementation spec

### `src/overlays/mcp/mcp-overlay-provider.ts`

```typescript
import type { OverlayProvider, OverlayDecision, OverlayHook, OverlayContext, OverlayVerdict,
              OverlayInvokeInput, OverlayEvidence } from "../../types/overlay-protocol.ts";
import { OverlayInvokeOutputSchema } from "../../types/overlay-protocol.ts";
import type { ResolvedBackendConfig, ResolvedRemoteOverlayConfig } from "../../config/remote-overlay-schema.ts";
import type { TaskResult } from "../../types/index.ts";
import type { ObservabilityEmitter } from "../../observability/emitter.ts";
import { McpClientWrapper } from "./mcp-client.ts";

export class McpOverlayProvider implements OverlayProvider {
  readonly id: string;           // overlay name (config key)
  readonly runtime: "mcp" = "mcp";
  readonly hooks: OverlayHook[];
  readonly enabled: boolean;
  readonly phases?: string[];

  constructor(
    overlayName: string,
    private readonly overlayConfig: ResolvedRemoteOverlayConfig,
    private readonly backendConfig: ResolvedBackendConfig & { runtime: "mcp" },
    private readonly emitter: ObservabilityEmitter,
  ) { ... }

  // Methods conditionally assigned in constructor based on overlayConfig.hooks
  invokePre?(ctx: OverlayContext): Promise<OverlayDecision>;
  invokePost?(ctx: OverlayContext, result: TaskResult): Promise<OverlayDecision>;
}
```

**Constructor hook assignment pattern** (same as LocalOverlayProvider):
```typescript
this.id = overlayName;
this.hooks = overlayConfig.hooks;
this.enabled = overlayConfig.enabled;
this.phases = overlayConfig.phases;

if (overlayConfig.hooks.includes("pre_task")) {
  this.invokePre = (ctx) => this.invoke(ctx, "pre_task", undefined);
}
if (overlayConfig.hooks.includes("post_task")) {
  this.invokePost = (ctx, result) => this.invoke(ctx, "post_task", result);
}
```

**Core `invoke` private method:**

```typescript
private async invoke(
  ctx: OverlayContext,
  hook: OverlayHook,
  taskResult: TaskResult | undefined,
): Promise<OverlayDecision> {
  const start = Date.now();
  const backendId = this.backendConfig.command[0]; // use first command token as backend ID for events
  const client = new McpClientWrapper(this.backendConfig);

  // Effective failure policy — blocking:false overrides Tier 1 to warn
  const effectivePolicy = this.overlayConfig.blocking === false
    ? "warn"
    : this.backendConfig.failure_policy;

  let raw: unknown;
  try {
    this.emitter.emit("overlay.remote.connecting", {
      overlay_name: this.id,
      backend_id: backendId,
      task_id: ctx.task_id,
      workflow_id: ctx.workflow_id,
      run_id: ctx.run_id,
    });

    await client.connect();

    this.emitter.emit("overlay.remote.connected", {
      overlay_name: this.id,
      backend_id: backendId,
      task_id: ctx.task_id,
      duration_ms: Date.now() - start,
    });

    const input = buildInput(ctx, hook, taskResult, this.id, this.overlayConfig.config);

    this.emitter.emit("overlay.remote.invoked", {
      overlay_name: this.id,
      backend_id: backendId,
      hook,
      task_id: ctx.task_id,
    });

    raw = await client.callTool(this.backendConfig.tool!, input);

  } catch (err) {
    // Tier 1: Transport error
    await client.disconnect().catch(() => {/* best-effort */});
    const errorMessage = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;

    this.emitter.emit("overlay.remote.failed", {
      overlay_name: this.id,
      backend_id: backendId,
      hook,
      task_id: ctx.task_id,
      failure_tier: "transport",
      error_message: errorMessage,
      duration_ms: durationMs,
    });

    switch (effectivePolicy) {
      case "skip":
        return { verdict: "PASS" };
      case "warn":
        this.emitter.emit("overlay.remote.fallback", {
          overlay_name: this.id,
          backend_id: backendId,
          hook,
          task_id: ctx.task_id,
          failure_policy: "warn",
        });
        return { verdict: "PASS" };
      case "fail_closed":
        return { verdict: "FAIL", feedback: `Transport error: ${errorMessage}` };
    }
  } finally {
    // Success path cleanup — best-effort disconnect
    await client.disconnect().catch(() => {/* best-effort */});
  }

  // Tier 2: Schema validation — always fail_closed, never overridden by failure_policy
  const parsed = OverlayInvokeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const schemaError = parsed.error.message;
    this.emitter.emit("overlay.remote.failed", {
      overlay_name: this.id,
      backend_id: backendId,
      hook,
      task_id: ctx.task_id,
      failure_tier: "schema",
      error_message: `Schema validation failed: ${schemaError}`,
      duration_ms: Date.now() - start,
    });
    return {
      verdict: "FAIL",
      feedback: `Remote overlay response failed schema validation: ${schemaError}`,
    };
  }

  this.emitter.emit("overlay.remote.decision", {
    overlay_name: this.id,
    backend_id: backendId,
    hook,
    task_id: ctx.task_id,
    verdict: parsed.data.verdict,
    duration_ms: Date.now() - start,
  });

  return mapToDecision(parsed.data, this.id);
}
```

**`mapToDecision` function:**
```typescript
function mapToDecision(parsed: OverlayInvokeOutput, overlayId: string): OverlayDecision {
  return {
    verdict: parsed.verdict,
    feedback: parsed.feedback,
    evidence: parsed.evidence
      ? {
          overlay_id: parsed.evidence.overlay_id ?? overlayId,
          source: "mcp",
          checks: parsed.evidence.checks,
          report_ref: parsed.evidence.report_ref,
          data: parsed.evidence.data,
        }
      : { overlay_id: overlayId, source: "mcp" },
  };
}
```

**`buildInput` function:**
```typescript
function buildInput(
  ctx: OverlayContext,
  hook: OverlayHook,
  result: TaskResult | undefined,
  overlayName: string,
  passthrough?: Record<string, unknown>,
): OverlayInvokeInput {
  return {
    protocol_version: "1",
    overlay_id: overlayName,
    hook,
    workflow: { id: ctx.workflow_id, run_id: ctx.run_id },
    task: {
      id: ctx.task_id,
      phase: (ctx.task_definition as { phase?: string }).phase,
      requirement_ids: (ctx.task_definition as { requirement_ids?: string[] }).requirement_ids,
      acceptance_criteria: (ctx.task_definition as { acceptance_criteria?: unknown[] }).acceptance_criteria,
      scope_excluded: (ctx.task_definition as { scope_excluded?: string[] }).scope_excluded,
    },
    ...(hook === "post_task" && result ? {
      result: {
        outputs: result.outputs,
        handover_state: result.handover_state,
      },
    } : {}),
    config: passthrough,
  };
}
```

Note: `task_definition` uses `[key: string]: unknown` in its type, so casting to access extended fields is acceptable.

## Tests to write

**File**: `tests/overlays/mcp/mcp-overlay-provider.test.ts`

Use a mock `McpClientWrapper` constructor injection. Approach: accept `McpClientWrapper` factory function as a constructor parameter (or use a testable variant). If full DI is not implemented, use a module-level factory function that tests can override via import.

Required test cases:

**Happy path:**
1. Valid `PASS` response → verdict `"PASS"`, feedback `undefined`
2. Valid `REWORK` response with feedback → verdict `"REWORK"`, feedback forwarded
3. Valid `FAIL` response with evidence → verdict `"FAIL"`, `evidence.source === "mcp"`
4. Valid `HIL` response → verdict `"HIL"`

**Tier 1 transport failure (policy-governed):**
5. Transport timeout + `failure_policy: "warn"` → returns PASS; `overlay.remote.failed` event emitted with `failure_tier: "transport"`
6. Transport timeout + `failure_policy: "fail_closed"` → returns FAIL
7. Transport timeout + `failure_policy: "skip"` → returns PASS; no `overlay.remote.failed` event emitted (CLAUDE.md §5: error messages are contracts)
8. `blocking: false` + transport error + `failure_policy: "fail_closed"` → returns PASS (blocking:false overrides to warn behavior)

**Tier 2 schema violation (always fail_closed):**
9. Response with `verdict: "FORCE_ACCEPT"` + `failure_policy: "skip"` → returns FAIL (`failure_policy` does NOT override schema safety)
10. Non-JSON / unparseable response → returns FAIL, `failure_tier: "schema"` in event
11. Response with `protocol_version: "2"` → returns FAIL (Zod rejects `z.literal("1")`)
12. `blocking: false` + schema violation → returns FAIL (blocking:false does not override Tier 2)

**Observability lifecycle:**
13. Successful invocation emits events in order: `overlay.remote.connecting` → `overlay.remote.connected` → `overlay.remote.invoked` → `overlay.remote.decision`
14. `overlay.remote.decision` event includes `verdict` and `duration_ms > 0`
15. Transport failure emits `overlay.remote.fallback` for `warn` policy, not for `skip` policy

**Security:**
16. Secret value in `overlayConfig.config.passthrough` does not appear in emitted event payloads (ObservabilityEmitter sanitizer is invoked by the emitter, not by McpOverlayProvider directly — verify the sanitizer is applied)

## Acceptance criteria

- [ ] `src/overlays/mcp/mcp-overlay-provider.ts` exists and exports `McpOverlayProvider`
- [ ] `runtime` is always `"mcp"`
- [ ] Tier 2 schema violations always return FAIL regardless of `failure_policy` or `blocking`
- [ ] `blocking: false` overrides Tier 1 to `warn` behavior only
- [ ] `protocol_version: "2"` in response causes FAIL (Zod `z.literal("1")` rejects it)
- [ ] `overlay.remote.failed` event has `failure_tier: "transport"` for transport errors
- [ ] `overlay.remote.failed` event has `failure_tier: "schema"` for schema violations
- [ ] `overlay.remote.fallback` emitted for `warn` policy, not for `skip` policy
- [ ] `bun run typecheck` exits 0 — no TypeScript errors
- [ ] All existing 177 tests still pass
