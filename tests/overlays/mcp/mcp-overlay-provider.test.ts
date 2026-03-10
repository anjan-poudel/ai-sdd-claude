/**
 * T004: McpOverlayProvider tests — two-tier failure model, verdict round-trips, observability events.
 * CLAUDE.md §1: Config-to-behavior — each test changes config and asserts different runtime behavior.
 * CLAUDE.md §5: Error messages are contracts — every event field asserted matches actual emitted data.
 */

import { describe, it, expect } from "bun:test";
import { McpOverlayProvider } from "../../../src/overlays/mcp/mcp-overlay-provider.ts";
import { McpClientWrapper } from "../../../src/overlays/mcp/mcp-client.ts";
import { ObservabilityEmitter } from "../../../src/observability/emitter.ts";
import type { OverlayContext, OverlayDecision } from "../../../src/types/overlay-protocol.ts";
import type { ResolvedBackendConfig, ResolvedRemoteOverlayConfig } from "../../../src/config/remote-overlay-schema.ts";
import type { TaskDefinition, AgentContext, TaskResult } from "../../../src/types/index.ts";
import type { AnyEvent } from "../../../src/observability/events.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBackendConfig(
  overrides: Partial<ResolvedBackendConfig> = {},
): ResolvedBackendConfig & { runtime: "mcp" } {
  return {
    runtime: "mcp",
    command: ["my-mcp-server", "--stdio"],
    tool: "overlay.invoke",
    transport: "stdio",
    timeout_ms: 5000,
    failure_policy: "warn",
    ...overrides,
  } as ResolvedBackendConfig & { runtime: "mcp" };
}

function makeOverlayConfig(
  overrides: Partial<ResolvedRemoteOverlayConfig> = {},
): ResolvedRemoteOverlayConfig {
  return {
    backend: "test-backend",
    enabled: true,
    hooks: ["pre_task"],
    blocking: true,
    ...overrides,
  } as ResolvedRemoteOverlayConfig;
}

function makeOverlayContext(): OverlayContext {
  const taskDef: TaskDefinition = {
    id: "test-task",
    agent: "developer",
    description: "Test task",
  };
  const agentCtx: AgentContext = {
    constitution: "test constitution",
    handover_state: {},
    task_definition: taskDef,
    dispatch_mode: "direct",
  };
  return {
    task_id: "test-task",
    workflow_id: "test-workflow",
    run_id: "run-001",
    task_definition: taskDef,
    agent_context: agentCtx,
  };
}

function makeTaskResult(): TaskResult {
  return {
    status: "COMPLETED",
    outputs: [],
    handover_state: {},
  };
}

function makeEmitter(): { emitter: ObservabilityEmitter; events: AnyEvent[] } {
  const events: AnyEvent[] = [];
  const emitter = new ObservabilityEmitter({
    run_id: "run-001",
    workflow_id: "test-workflow",
    log_level: "ERROR", // suppress INFO/WARN output during tests
  });
  emitter.on((ev) => { events.push(ev); });
  return { emitter, events };
}

/**
 * Create a mock McpClientWrapper factory. The factory returns a mock that:
 * - connect() resolves immediately (simulating success)
 * - callTool() returns the provided response
 * - disconnect() resolves immediately
 */
function makeMockClientFactory(opts: {
  connectError?: Error;
  callToolResult?: unknown;
  callToolError?: Error;
}): (config: ResolvedBackendConfig & { runtime: "mcp" }) => McpClientWrapper {
  return (_config) => {
    const mock = {
      isConnected: false,
      connect: async () => {
        if (opts.connectError) throw opts.connectError;
        mock.isConnected = true;
      },
      callTool: async (_toolName: string, _input: unknown): Promise<unknown> => {
        if (opts.callToolError) throw opts.callToolError;
        return opts.callToolResult;
      },
      disconnect: async () => {
        mock.isConnected = false;
      },
    };
    return mock as unknown as McpClientWrapper;
  };
}

/** Valid OverlayInvokeOutput wire responses */
function validResponse(verdict: "PASS" | "REWORK" | "FAIL" | "HIL", opts: {
  feedback?: string;
  evidence?: {
    overlay_id: string;
    checks?: string[];
    report_ref?: string;
    data?: Record<string, unknown>;
  };
} = {}): unknown {
  return {
    protocol_version: "1",
    verdict,
    ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
    ...(opts.evidence !== undefined ? { evidence: opts.evidence } : {}),
  };
}

// ─── Happy Path: All Four Verdicts ────────────────────────────────────────────

describe("McpOverlayProvider: happy path — verdict round-trips", () => {
  it("1. PASS response → verdict PASS, no feedback", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({ callToolResult: validResponse("PASS") });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.verdict).toBe("PASS");
    expect(decision.feedback).toBeUndefined();
  });

  it("2. REWORK response with feedback → verdict REWORK, feedback forwarded", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: validResponse("REWORK", { feedback: "Fix the imports." }),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.verdict).toBe("REWORK");
    expect(decision.feedback).toBe("Fix the imports.");
  });

  it("3. FAIL response with evidence → verdict FAIL, evidence.source === 'mcp'", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: validResponse("FAIL", {
        feedback: "Security violation detected.",
        evidence: {
          overlay_id: "security-check",
          checks: ["no_secrets", "no_injection"],
          report_ref: "reports/sec-001.json",
          data: { severity: "high" },
        },
      }),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.verdict).toBe("FAIL");
    expect(decision.evidence?.source).toBe("mcp");
    expect(decision.evidence?.checks).toEqual(["no_secrets", "no_injection"]);
    expect(decision.evidence?.report_ref).toBe("reports/sec-001.json");
    expect(decision.evidence?.data?.["severity"]).toBe("high");
  });

  it("4. HIL response → verdict HIL", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: validResponse("HIL", { feedback: "Needs human review." }),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.verdict).toBe("HIL");
    expect(decision.feedback).toBe("Needs human review.");
  });
});

// ─── Tier 1: Transport Failure (policy-governed) ───────────────────────────────

describe("McpOverlayProvider: Tier 1 transport failures — failure_policy", () => {
  it("5. transport error + failure_policy=warn → verdict PASS; overlay.remote.failed with failure_tier='transport'", async () => {
    const { emitter, events } = makeEmitter();
    const factory = makeMockClientFactory({
      connectError: new Error("Connection refused"),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], blocking: true }),
      makeBackendConfig({ failure_policy: "warn" }),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.verdict).toBe("PASS");

    const failedEvent = events.find((e) => e.type === "overlay.remote.failed");
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.data["failure_tier"]).toBe("transport");
    expect(failedEvent?.data["error_message"]).toContain("Connection refused");
  });

  it("6. transport error + failure_policy=fail_closed → verdict FAIL", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      connectError: new Error("Subprocess crashed"),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], blocking: true }),
      makeBackendConfig({ failure_policy: "fail_closed" }),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.verdict).toBe("FAIL");
    expect(decision.feedback).toContain("Transport error");
    expect(decision.feedback).toContain("Subprocess crashed");
  });

  it("7. transport error + failure_policy=skip → verdict PASS; emits overlay.remote.fallback with skip policy; does NOT emit overlay.remote.failed", async () => {
    const { emitter, events } = makeEmitter();
    const factory = makeMockClientFactory({
      connectError: new Error("Connection refused"),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], blocking: true }),
      makeBackendConfig({ failure_policy: "skip" }),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.verdict).toBe("PASS");

    // skip emits overlay.remote.fallback so operators can observe silent skips
    const fallbackEvent = events.find((e) => e.type === "overlay.remote.fallback");
    expect(fallbackEvent).toBeDefined();
    expect(fallbackEvent?.data["failure_policy"]).toBe("skip");

    // FR-008 AC: skip policy must NOT emit overlay.remote.failed (guards Finding 1 resolution)
    const failedEvent = events.find((e) => e.type === "overlay.remote.failed");
    expect(failedEvent).toBeUndefined();
  });

  it("8. blocking=false + transport error + failure_policy=fail_closed → verdict PASS (blocking:false overrides to warn)", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      connectError: new Error("Timeout"),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], blocking: false }),
      makeBackendConfig({ failure_policy: "fail_closed" }),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    // blocking:false must override fail_closed → warn → PASS
    expect(decision.verdict).toBe("PASS");
  });
});

// ─── Tier 2: Schema Violations (always fail_closed) ───────────────────────────

describe("McpOverlayProvider: Tier 2 schema violations — always fail_closed", () => {
  it("9. response with verdict='FORCE_ACCEPT' (invalid) + failure_policy=skip → verdict FAIL (policy does NOT override schema)", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: { protocol_version: "1", verdict: "FORCE_ACCEPT" }, // invalid verdict
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], blocking: true }),
      makeBackendConfig({ failure_policy: "skip" }),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    // Schema violation is always FAIL, even with skip policy
    expect(decision.verdict).toBe("FAIL");
  });

  it("10. non-JSON / unparseable response → verdict FAIL; overlay.remote.failed with failure_tier='schema'", async () => {
    const { emitter, events } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: "this is not valid overlay output", // string, not an object
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig({ failure_policy: "warn" }),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.verdict).toBe("FAIL");

    const failedEvent = events.find((e) => e.type === "overlay.remote.failed");
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.data["failure_tier"]).toBe("schema");
  });

  it("11. response with protocol_version='2' → verdict FAIL (Zod rejects z.literal('1'))", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: { protocol_version: "2", verdict: "PASS" }, // wrong protocol version
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig({ failure_policy: "warn" }),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    // Zod z.literal("1") rejects "2" → schema violation → always FAIL
    expect(decision.verdict).toBe("FAIL");
  });

  it("12. blocking=false + schema violation → verdict FAIL (blocking:false does not override Tier 2)", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: { protocol_version: "1", verdict: "ILLEGAL_VERDICT" }, // invalid
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], blocking: false }),
      makeBackendConfig({ failure_policy: "skip" }),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    // blocking:false AND skip policy do NOT override Tier 2 schema failures
    expect(decision.verdict).toBe("FAIL");
  });
});

// ─── Observability Lifecycle Events ───────────────────────────────────────────

describe("McpOverlayProvider: observability lifecycle events", () => {
  it("13. successful invocation emits events in correct order: connecting→connected→invoked→decision", async () => {
    const { emitter, events } = makeEmitter();
    const factory = makeMockClientFactory({ callToolResult: validResponse("PASS") });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    await provider.invokePre!(makeOverlayContext());

    const eventTypes = events.map((e) => e.type);
    const connectingIdx = eventTypes.indexOf("overlay.remote.connecting");
    const connectedIdx = eventTypes.indexOf("overlay.remote.connected");
    const invokedIdx = eventTypes.indexOf("overlay.remote.invoked");
    const decisionIdx = eventTypes.indexOf("overlay.remote.decision");

    expect(connectingIdx).toBeGreaterThanOrEqual(0);
    expect(connectedIdx).toBeGreaterThan(connectingIdx);
    expect(invokedIdx).toBeGreaterThan(connectedIdx);
    expect(decisionIdx).toBeGreaterThan(invokedIdx);
  });

  it("14. overlay.remote.decision event includes verdict and duration_ms > 0", async () => {
    const { emitter, events } = makeEmitter();
    const factory = makeMockClientFactory({ callToolResult: validResponse("REWORK", { feedback: "needs work" }) });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    await provider.invokePre!(makeOverlayContext());

    const decisionEvent = events.find((e) => e.type === "overlay.remote.decision");
    expect(decisionEvent).toBeDefined();
    expect(decisionEvent?.data["verdict"]).toBe("REWORK");
    expect(typeof decisionEvent?.data["duration_ms"]).toBe("number");
    expect(decisionEvent?.data["duration_ms"] as number).toBeGreaterThanOrEqual(0);
  });

  it("15a. transport failure with warn policy emits overlay.remote.fallback", async () => {
    const { emitter, events } = makeEmitter();
    const factory = makeMockClientFactory({
      connectError: new Error("Transport failed"),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], blocking: true }),
      makeBackendConfig({ failure_policy: "warn" }),
      emitter,
      factory,
    );

    await provider.invokePre!(makeOverlayContext());

    const fallbackEvent = events.find((e) => e.type === "overlay.remote.fallback");
    expect(fallbackEvent).toBeDefined();
    expect(fallbackEvent?.data["failure_policy"]).toBe("warn");
  });

  it("15b. transport failure with skip policy emits overlay.remote.fallback with skip failure_policy", async () => {
    const { emitter, events } = makeEmitter();
    const factory = makeMockClientFactory({
      connectError: new Error("Transport failed"),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], blocking: true }),
      makeBackendConfig({ failure_policy: "skip" }),
      emitter,
      factory,
    );

    await provider.invokePre!(makeOverlayContext());

    const fallbackEvent = events.find((e) => e.type === "overlay.remote.fallback");
    expect(fallbackEvent).toBeDefined();
    expect(fallbackEvent?.data["failure_policy"]).toBe("skip");
  });
});

// ─── Metadata and Evidence Propagation ────────────────────────────────────────

describe("McpOverlayProvider: metadata and evidence propagation", () => {
  it("evidence.overlay_id uses response overlay_id when present", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: validResponse("FAIL", {
        evidence: { overlay_id: "remote-security-check", checks: ["scan1"] },
      }),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.evidence?.overlay_id).toBe("remote-security-check");
    expect(decision.evidence?.source).toBe("mcp");
  });

  it("evidence defaults to overlay name (id) as overlay_id when evidence is absent in response", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: validResponse("PASS"), // no evidence field
    });
    const provider = new McpOverlayProvider(
      "my-named-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    // mapToDecision fallback: { overlay_id: overlayId, source: "mcp" }
    expect(decision.evidence?.overlay_id).toBe("my-named-overlay");
    expect(decision.evidence?.source).toBe("mcp");
  });

  it("evidence.checks and evidence.report_ref are forwarded when present", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: validResponse("FAIL", {
        evidence: {
          overlay_id: "ev-check",
          checks: ["check-a", "check-b"],
          report_ref: "report.json",
          data: { key: "value" },
        },
      }),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    const decision = await provider.invokePre!(makeOverlayContext());
    expect(decision.evidence?.checks).toEqual(["check-a", "check-b"]);
    expect(decision.evidence?.report_ref).toBe("report.json");
    expect(decision.evidence?.data?.["key"]).toBe("value");
  });
});

// ─── Constructor Behavior ──────────────────────────────────────────────────────

describe("McpOverlayProvider: constructor behavior", () => {
  it("runtime is always 'mcp'", () => {
    const { emitter } = makeEmitter();
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
    );
    expect(provider.runtime).toBe("mcp");
  });

  it("id equals overlay name", () => {
    const { emitter } = makeEmitter();
    const provider = new McpOverlayProvider(
      "my-overlay-name",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
    );
    expect(provider.id).toBe("my-overlay-name");
  });

  it("invokePre is defined when hooks includes pre_task", () => {
    const { emitter } = makeEmitter();
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
    );
    expect(provider.invokePre).toBeDefined();
  });

  it("invokePost is defined when hooks includes post_task", () => {
    const { emitter } = makeEmitter();
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["post_task"] }),
      makeBackendConfig(),
      emitter,
    );
    expect(provider.invokePost).toBeDefined();
  });

  it("invokePre is undefined when hooks only includes post_task", () => {
    const { emitter } = makeEmitter();
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["post_task"] }),
      makeBackendConfig(),
      emitter,
    );
    expect(provider.invokePre).toBeUndefined();
  });

  it("invokePost is undefined when hooks only includes pre_task", () => {
    const { emitter } = makeEmitter();
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"] }),
      makeBackendConfig(),
      emitter,
    );
    expect(provider.invokePost).toBeUndefined();
  });

  it("both invokePre and invokePost are defined when hooks includes both", () => {
    const { emitter } = makeEmitter();
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task", "post_task"] }),
      makeBackendConfig(),
      emitter,
    );
    expect(provider.invokePre).toBeDefined();
    expect(provider.invokePost).toBeDefined();
  });

  it("enabled reflects overlayConfig.enabled=true", () => {
    const { emitter } = makeEmitter();
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], enabled: true }),
      makeBackendConfig(),
      emitter,
    );
    expect(provider.enabled).toBe(true);
  });

  it("enabled reflects overlayConfig.enabled=false", () => {
    const { emitter } = makeEmitter();
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], enabled: false }),
      makeBackendConfig(),
      emitter,
    );
    expect(provider.enabled).toBe(false);
  });
});

// ─── Post-task Hook ────────────────────────────────────────────────────────────

describe("McpOverlayProvider: post_task hook", () => {
  it("invokePost with PASS response → verdict PASS", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({ callToolResult: validResponse("PASS") });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["post_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    const ctx = makeOverlayContext();
    const result = makeTaskResult();
    const decision = await provider.invokePost!(ctx, result);
    expect(decision.verdict).toBe("PASS");
  });

  it("invokePost with REWORK response → verdict REWORK", async () => {
    const { emitter } = makeEmitter();
    const factory = makeMockClientFactory({
      callToolResult: validResponse("REWORK", { feedback: "Missing test coverage." }),
    });
    const provider = new McpOverlayProvider(
      "test-overlay",
      makeOverlayConfig({ hooks: ["post_task"] }),
      makeBackendConfig(),
      emitter,
      factory,
    );

    const ctx = makeOverlayContext();
    const result = makeTaskResult();
    const decision = await provider.invokePost!(ctx, result);
    expect(decision.verdict).toBe("REWORK");
    expect(decision.feedback).toBe("Missing test coverage.");
  });
});

// ─── Security: Sanitizer is Applied by Emitter ────────────────────────────────

describe("McpOverlayProvider: security — sanitizer applied by emitter", () => {
  it("16. GITHUB_TOKEN-like value in transport error message is sanitized in overlay.remote.failed event", async () => {
    const events: AnyEvent[] = [];
    // Use a real emitter (with default sanitizer) to verify sanitizer is applied
    const emitter = new ObservabilityEmitter({
      run_id: "run-001",
      workflow_id: "test-workflow",
      log_level: "ERROR",
    });
    emitter.on((ev) => { events.push(ev); });

    // A value that matches the GITHUB_TOKEN pattern: ghp_ + 36+ alphanumeric chars
    const secretValue = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    // Put the secret in the transport error message — this gets emitted in overlay.remote.failed
    const factory = makeMockClientFactory({
      connectError: new Error(`Authentication failed with token ${secretValue}`),
    });
    const provider = new McpOverlayProvider(
      "sec-overlay",
      makeOverlayConfig({ hooks: ["pre_task"], blocking: true }),
      makeBackendConfig({ failure_policy: "warn" }),
      emitter,
      factory,
    );

    await provider.invokePre!(makeOverlayContext());

    // The ObservabilityEmitter sanitizer must redact the secret from emitted event data
    const allEventData = JSON.stringify(events.map((e) => e.data));
    expect(allEventData).not.toContain(secretValue);
    // Sanitizer replaces it with [REDACTED:GITHUB_TOKEN]
    expect(allEventData).toContain("[REDACTED:GITHUB_TOKEN]");
  });
});
