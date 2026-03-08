/**
 * McpOverlayProvider — delegates overlay invocations to remote MCP servers.
 * Implements two-tier failure model: transport errors governed by failure_policy,
 * schema violations always fail_closed.
 */
import type {
  OverlayProvider,
  OverlayDecision,
  OverlayHook,
  OverlayContext,
  OverlayInvokeInput,
  OverlayInvokeOutput,
} from "../../types/overlay-protocol.ts";
import { OverlayInvokeOutputSchema } from "../../types/overlay-protocol.ts";
import type { ResolvedBackendConfig, ResolvedRemoteOverlayConfig } from "../../config/remote-overlay-schema.ts";
import type { TaskResult } from "../../types/index.ts";
import type { ObservabilityEmitter } from "../../observability/emitter.ts";
import { McpClientWrapper } from "./mcp-client.ts";

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
      ...(((ctx.task_definition as { phase?: string }).phase) !== undefined && { phase: (ctx.task_definition as { phase?: string }).phase }),
      ...(((ctx.task_definition as { requirement_ids?: string[] }).requirement_ids) !== undefined && { requirement_ids: (ctx.task_definition as { requirement_ids?: string[] }).requirement_ids }),
      ...(((ctx.task_definition as { acceptance_criteria?: unknown[] }).acceptance_criteria) !== undefined && { acceptance_criteria: (ctx.task_definition as { acceptance_criteria?: unknown[] }).acceptance_criteria }),
      ...(((ctx.task_definition as { scope_excluded?: string[] }).scope_excluded) !== undefined && { scope_excluded: (ctx.task_definition as { scope_excluded?: string[] }).scope_excluded }),
    },
    ...(hook === "post_task" && result ? {
      result: {
        ...(result.outputs !== undefined && { outputs: result.outputs }),
        ...(result.handover_state !== undefined && { handover_state: result.handover_state }),
      },
    } : {}),
    ...(passthrough !== undefined && { config: passthrough }),
  };
}

function mapToDecision(parsed: OverlayInvokeOutput, overlayId: string): OverlayDecision {
  return {
    verdict: parsed.verdict,
    ...(parsed.feedback !== undefined && { feedback: parsed.feedback }),
    evidence: parsed.evidence
      ? {
          overlay_id: parsed.evidence.overlay_id ?? overlayId,
          source: "mcp",
          ...(parsed.evidence.checks !== undefined && { checks: parsed.evidence.checks }),
          ...(parsed.evidence.report_ref !== undefined && { report_ref: parsed.evidence.report_ref }),
          ...(parsed.evidence.data !== undefined && { data: parsed.evidence.data }),
        }
      : { overlay_id: overlayId, source: "mcp" },
  };
}

export class McpOverlayProvider implements OverlayProvider {
  readonly id: string;
  readonly runtime: "mcp" = "mcp";
  readonly hooks: OverlayHook[];
  readonly enabled: boolean;
  readonly phases?: string[];

  invokePre?: (ctx: OverlayContext) => Promise<OverlayDecision>;
  invokePost?: (ctx: OverlayContext, result: TaskResult) => Promise<OverlayDecision>;

  /** @internal - injectable client factory for testability */
  private readonly _clientFactory: (config: ResolvedBackendConfig & { runtime: "mcp" }) => McpClientWrapper;

  constructor(
    overlayName: string,
    private readonly overlayConfig: ResolvedRemoteOverlayConfig,
    private readonly backendConfig: ResolvedBackendConfig & { runtime: "mcp" },
    private readonly emitter: ObservabilityEmitter,
    clientFactory?: (config: ResolvedBackendConfig & { runtime: "mcp" }) => McpClientWrapper,
  ) {
    this._clientFactory = clientFactory ?? ((cfg) => new McpClientWrapper(cfg));
    this.id = overlayName;
    this.hooks = overlayConfig.hooks;
    this.enabled = overlayConfig.enabled;
    if (overlayConfig.phases !== undefined) {
      this.phases = overlayConfig.phases;
    }

    if (overlayConfig.hooks.includes("pre_task")) {
      this.invokePre = (ctx) => this.invoke(ctx, "pre_task", undefined);
    }
    if (overlayConfig.hooks.includes("post_task")) {
      this.invokePost = (ctx, result) => this.invoke(ctx, "post_task", result);
    }
  }

  private async invoke(
    ctx: OverlayContext,
    hook: OverlayHook,
    taskResult: TaskResult | undefined,
  ): Promise<OverlayDecision> {
    const start = Date.now();
    const backendId = this.backendConfig.command[0] ?? "unknown";
    const client = this._clientFactory(this.backendConfig);

    // Effective failure policy — blocking:false overrides Tier 1 to warn
    const effectivePolicy = this.overlayConfig.blocking === false
      ? "warn"
      : this.backendConfig.failure_policy;

    let raw: unknown;
    let connectSucceeded = false;
    try {
      this.emitter.emit("overlay.remote.connecting", {
        overlay_name: this.id,
        backend_id: backendId,
        task_id: ctx.task_id,
        workflow_id: ctx.workflow_id,
        run_id: ctx.run_id,
      });

      await client.connect();
      connectSucceeded = true;

      this.emitter.emit("overlay.remote.connected", {
        overlay_name: this.id,
        backend_id: backendId,
        task_id: ctx.task_id,
        workflow_id: ctx.workflow_id,
        run_id: ctx.run_id,
        duration_ms: Date.now() - start,
      });

      const input = buildInput(ctx, hook, taskResult, this.id, this.overlayConfig.config as Record<string, unknown> | undefined);

      // Emitted before the MCP call is made — indicates the overlay is in-flight.
      // overlay.remote.decision or overlay.remote.failed is emitted after resolution.
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

      switch (effectivePolicy) {
        case "skip":
          // skip: emit overlay.remote.fallback ONLY — no overlay.remote.failed.
          // FR-008 AC: "no overlay.remote.failed event is emitted" for skip policy.
          this.emitter.emit("overlay.remote.fallback", {
            overlay_name: this.id,
            backend_id: backendId,
            hook,
            task_id: ctx.task_id,
            failure_policy: "skip",
          });
          return { verdict: "PASS" };
        case "warn":
          // warn: emit overlay.remote.failed so operators can diagnose, then fallback.
          this.emitter.emit("overlay.remote.failed", {
            overlay_name: this.id,
            backend_id: backendId,
            hook,
            task_id: ctx.task_id,
            failure_tier: "transport",
            error_message: errorMessage,
            duration_ms: durationMs,
          });
          this.emitter.emit("overlay.remote.fallback", {
            overlay_name: this.id,
            backend_id: backendId,
            hook,
            task_id: ctx.task_id,
            failure_policy: "warn",
          });
          return { verdict: "PASS" };
        case "fail_closed":
          this.emitter.emit("overlay.remote.failed", {
            overlay_name: this.id,
            backend_id: backendId,
            hook,
            task_id: ctx.task_id,
            failure_tier: "transport",
            error_message: errorMessage,
            duration_ms: durationMs,
          });
          return { verdict: "FAIL", feedback: `Transport error: ${errorMessage}` };
      }
    } finally {
      // Success path cleanup — best-effort disconnect
      if (connectSucceeded) {
        await client.disconnect().catch(() => {/* best-effort */});
      }
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
}
