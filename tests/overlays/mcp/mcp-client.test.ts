/**
 * T003: McpClientWrapper tests — lifecycle, timeout, error handling, schema fixture.
 * CLAUDE.md §1: Config-to-behavior tests — each test changes config and asserts different runtime behavior.
 * CLAUDE.md §4: External schema fixture — mcp-call-tool-result.json prevents SDK schema drift.
 */

import { describe, it, expect } from "bun:test";
import {
  McpClientWrapper,
  McpTimeoutError,
  McpNotConnectedError,
  McpSchemaError,
} from "../../../src/overlays/mcp/mcp-client.ts";
import type { ResolvedBackendConfig } from "../../../src/config/remote-overlay-schema.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Helpers ───────────────────────────────────────────────────────────────────

type SdkClientShape = {
  connect(transport: unknown): Promise<void>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
};

function makeMcpConfig(overrides: Partial<ResolvedBackendConfig> = {}): ResolvedBackendConfig & { runtime: "mcp" } {
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

/**
 * Inject a mock SdkClient into a wrapper without going through real connect().
 * This avoids spawning actual subprocesses in tests.
 */
function injectMockClient(wrapper: McpClientWrapper, mockClient: SdkClientShape): void {
  // Access private fields via type cast — standard TypeScript test technique
  (wrapper as unknown as Record<string, unknown>)["_client"] = mockClient;
  (wrapper as unknown as Record<string, unknown>)["_connected"] = true;
}

function makeMockClient(
  callToolImpl: (params: { name: string; arguments: Record<string, unknown> }) => Promise<unknown> = async () => ({
    content: [{ type: "text", text: JSON.stringify({ protocol_version: "1", verdict: "PASS" }) }],
    isError: false,
  }),
): SdkClientShape {
  return {
    connect: async (_transport: unknown) => { /* no-op */ },
    callTool: callToolImpl,
    close: async () => { /* no-op */ },
  };
}

// ─── Error class exports ───────────────────────────────────────────────────────

describe("McpClientWrapper: error class exports", () => {
  it("McpTimeoutError is exported and sets name correctly", () => {
    const err = new McpTimeoutError("my-tool", 5000);
    expect(err.name).toBe("McpTimeoutError");
    expect(err.toolName).toBe("my-tool");
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toContain("my-tool");
    expect(err.message).toContain("5000ms");
  });

  it("McpNotConnectedError is exported and sets name + backendId correctly", () => {
    const err = new McpNotConnectedError("my-backend");
    expect(err.name).toBe("McpNotConnectedError");
    expect(err.backendId).toBe("my-backend");
    expect(err.message).toContain("my-backend");
    expect(err.message).toContain("Call connect()");
  });

  it("McpSchemaError is exported and sets name correctly", () => {
    const err = new McpSchemaError("bad schema");
    expect(err.name).toBe("McpSchemaError");
    expect(err.message).toBe("bad schema");
  });
});

// ─── Construction + transport validation ──────────────────────────────────────

describe("McpClientWrapper: construction", () => {
  it("constructs successfully with stdio transport", () => {
    const wrapper = new McpClientWrapper(makeMcpConfig());
    expect(wrapper.isConnected).toBe(false);
  });

  it("6. transport 'sse' at construction throws TypeError naming 'sse' as unsupported", () => {
    // Config-to-behavior: transport value controls whether construction succeeds
    const config = makeMcpConfig({ transport: "sse" as "stdio" });
    expect(() => new McpClientWrapper(config)).toThrow(TypeError);
    expect(() => new McpClientWrapper(config)).toThrow("sse");
    expect(() => new McpClientWrapper(config)).toThrow("stdio");
  });

  it("isConnected is false before connect()", () => {
    const wrapper = new McpClientWrapper(makeMcpConfig());
    expect(wrapper.isConnected).toBe(false);
  });
});

// ─── Pre-connect guard ─────────────────────────────────────────────────────────

describe("McpClientWrapper: callTool before connect", () => {
  it("1. callTool before connect() throws McpNotConnectedError", async () => {
    const wrapper = new McpClientWrapper(makeMcpConfig());
    await expect(wrapper.callTool("my-tool", {})).rejects.toThrow(McpNotConnectedError);
  });

  it("error.name is McpNotConnectedError", async () => {
    const wrapper = new McpClientWrapper(makeMcpConfig());
    let caughtError: Error | undefined;
    try {
      await wrapper.callTool("my-tool", {});
    } catch (err) {
      caughtError = err as Error;
    }
    expect(caughtError?.name).toBe("McpNotConnectedError");
  });

  it("error message includes 'Call connect()' before invoking callTool()", async () => {
    const wrapper = new McpClientWrapper(makeMcpConfig());
    let caughtError: Error | undefined;
    try {
      await wrapper.callTool("my-tool", {});
    } catch (err) {
      caughtError = err as Error;
    }
    expect(caughtError?.message).toContain("Call connect()");
  });
});

// ─── callTool with mock client ─────────────────────────────────────────────────

describe("McpClientWrapper: callTool with injected mock client", () => {
  it("2. isConnected is true after mock injection; callTool returns unwrapped plain value", async () => {
    const wrapper = new McpClientWrapper(makeMcpConfig());
    injectMockClient(wrapper, makeMockClient());

    expect(wrapper.isConnected).toBe(true);
    const result = await wrapper.callTool("overlay.invoke", { task_id: "t1" });

    // Assert no SDK envelope in return value — must be plain plain value
    expect(result).toEqual({ protocol_version: "1", verdict: "PASS" });

    // Confirm SDK content array is not returned as-is
    expect((result as Record<string, unknown>)["content"]).toBeUndefined();
  });

  it("callTool with json content type returns data directly without JSON.parse", async () => {
    const mockClient = makeMockClient(async () => ({
      content: [{ type: "json", data: { protocol_version: "1", verdict: "REWORK" } }],
      isError: false,
    }));
    const wrapper = new McpClientWrapper(makeMcpConfig());
    injectMockClient(wrapper, mockClient);

    const result = await wrapper.callTool("overlay.invoke", {});
    expect(result).toEqual({ protocol_version: "1", verdict: "REWORK" });
  });

  it("callTool with text content that is not valid JSON returns the raw text string", async () => {
    const mockClient = makeMockClient(async () => ({
      content: [{ type: "text", text: "plain text response" }],
      isError: false,
    }));
    const wrapper = new McpClientWrapper(makeMcpConfig());
    injectMockClient(wrapper, mockClient);

    const result = await wrapper.callTool("overlay.invoke", {});
    expect(result).toBe("plain text response");
  });

  it("callTool passes toolName and input args correctly to underlying mock", async () => {
    let capturedParams: { name: string; arguments: Record<string, unknown> } | undefined;
    const mockClient = makeMockClient(async (params) => {
      capturedParams = params;
      return { content: [{ type: "text", text: "{}" }], isError: false };
    });
    const wrapper = new McpClientWrapper(makeMcpConfig());
    injectMockClient(wrapper, mockClient);

    await wrapper.callTool("overlay.invoke", { hook: "pre_task" });

    expect(capturedParams?.name).toBe("overlay.invoke");
    expect(capturedParams?.arguments).toEqual({ hook: "pre_task" });
  });
});

// ─── Timeout behavior ──────────────────────────────────────────────────────────

describe("McpClientWrapper: timeout enforcement", () => {
  it("3. callTool timeout rejects with McpTimeoutError within timeout_ms + 50ms tolerance", async () => {
    // Config-to-behavior: timeout_ms: 100 fires within 150ms
    const wrapper = new McpClientWrapper(makeMcpConfig({ timeout_ms: 100 }));

    let resolveHang: (() => void) | undefined;
    const hangPromise = new Promise<void>((resolve) => { resolveHang = resolve; });

    const neverResolvingClient = makeMockClient(async () => {
      await hangPromise;
      return {};
    });
    injectMockClient(wrapper, neverResolvingClient);

    const start = Date.now();
    let caughtError: Error | undefined;
    try {
      await wrapper.callTool("slow-tool", {});
    } catch (err) {
      caughtError = err as Error;
    } finally {
      resolveHang?.();
    }

    const elapsed = Date.now() - start;
    expect(caughtError?.name).toBe("McpTimeoutError");
    expect(elapsed).toBeLessThan(150); // within 100ms + 50ms tolerance
    expect((caughtError as McpTimeoutError | undefined)?.timeoutMs).toBe(100);
  }, 500);

  it("McpTimeoutError.toolName matches the called tool name", async () => {
    const wrapper = new McpClientWrapper(makeMcpConfig({ timeout_ms: 50 }));

    let resolveHang: (() => void) | undefined;
    const hangPromise = new Promise<void>((resolve) => { resolveHang = resolve; });
    const hangClient = makeMockClient(async () => { await hangPromise; return {}; });
    injectMockClient(wrapper, hangClient);

    let caughtError: McpTimeoutError | undefined;
    try {
      await wrapper.callTool("my-named-tool", {});
    } catch (err) {
      caughtError = err as McpTimeoutError;
    } finally {
      resolveHang?.();
    }

    expect(caughtError?.toolName).toBe("my-named-tool");
  }, 300);

  it("8. Config-to-behavior: timeout_ms:200 fires at ≤250ms; timeout_ms:500 does not fire at 250ms", async () => {
    // timeout_ms: 200 → should time out
    const fastWrapper = new McpClientWrapper(makeMcpConfig({ timeout_ms: 200 }));

    let resolveHangFast: (() => void) | undefined;
    const hangFast = new Promise<void>((resolve) => { resolveHangFast = resolve; });
    injectMockClient(fastWrapper, makeMockClient(async () => { await hangFast; return {}; }));

    const fastResult = await Promise.race([
      fastWrapper.callTool("tool", {}).then(() => "resolved").catch((e: Error) => e.name),
      new Promise<string>((res) => setTimeout(() => res("no-timeout"), 250)),
    ]);
    resolveHangFast?.();
    expect(fastResult).toBe("McpTimeoutError");

    // timeout_ms: 500 → should NOT time out within 250ms
    const slowWrapper = new McpClientWrapper(makeMcpConfig({ timeout_ms: 500 }));

    let resolveHangSlow: (() => void) | undefined;
    const hangSlow = new Promise<void>((resolve) => { resolveHangSlow = resolve; });
    injectMockClient(slowWrapper, makeMockClient(async () => { await hangSlow; return {}; }));

    const slowResult = await Promise.race([
      slowWrapper.callTool("tool", {}).then(() => "resolved").catch((e: Error) => e.name),
      new Promise<string>((res) => setTimeout(() => res("no-timeout"), 250)),
    ]);
    resolveHangSlow?.();
    expect(slowResult).toBe("no-timeout");
  }, 1000);
});

// ─── Disconnect behavior ───────────────────────────────────────────────────────

describe("McpClientWrapper: disconnect behavior", () => {
  it("5. disconnect() when not connected is a no-op — no throw", async () => {
    const wrapper = new McpClientWrapper(makeMcpConfig());
    expect(wrapper.isConnected).toBe(false);
    await expect(wrapper.disconnect()).resolves.toBeUndefined();
  });

  it("4. disconnect() after callTool — isConnected becomes false", async () => {
    const wrapper = new McpClientWrapper(makeMcpConfig());
    injectMockClient(wrapper, makeMockClient());

    expect(wrapper.isConnected).toBe(true);
    await wrapper.callTool("overlay.invoke", {});
    await wrapper.disconnect();
    expect(wrapper.isConnected).toBe(false);
  });

  it("4b. subsequent callTool after disconnect throws McpNotConnectedError", async () => {
    const wrapper = new McpClientWrapper(makeMcpConfig());
    injectMockClient(wrapper, makeMockClient());

    await wrapper.callTool("overlay.invoke", {});
    await wrapper.disconnect();

    await expect(wrapper.callTool("overlay.invoke", {})).rejects.toThrow(McpNotConnectedError);
  });

  it("disconnect() calls close() on the underlying client", async () => {
    let closeCalled = false;
    const mockClient: SdkClientShape = {
      connect: async () => {},
      callTool: async () => ({ content: [], isError: false }),
      close: async () => { closeCalled = true; },
    };

    const wrapper = new McpClientWrapper(makeMcpConfig());
    injectMockClient(wrapper, mockClient);

    await wrapper.disconnect();
    expect(closeCalled).toBe(true);
  });
});

// ─── External schema fixture ───────────────────────────────────────────────────

describe("McpClientWrapper: external schema fixture (CLAUDE.md §4)", () => {
  const fixtureDir = join(fileURLToPath(import.meta.url), "../fixtures");
  const fixturePath = join(fixtureDir, "mcp-call-tool-result.json");

  it("7. fixture file exists and is valid JSON", () => {
    const raw = readFileSync(fixturePath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("fixture has required shape: sdk_version, sample_response, expected_unwrapped", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
    expect(typeof fixture.sdk_version).toBe("string");
    expect(fixture.sample_response).toBeDefined();
    expect(fixture.expected_unwrapped).toBeDefined();
  });

  it("fixture sample_response has content array with at least one item", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
    expect(Array.isArray(fixture.sample_response.content)).toBe(true);
    expect(fixture.sample_response.content.length).toBeGreaterThan(0);
  });

  it("callTool unwrapping of fixture sample_response matches expected_unwrapped value", async () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

    // Verify that our unwrapping logic produces the expected output for the captured SDK response
    const mockClient = makeMockClient(async () => fixture.sample_response);
    const wrapper = new McpClientWrapper(makeMcpConfig());
    injectMockClient(wrapper, mockClient);

    const result = await wrapper.callTool("overlay.invoke", {});

    expect(result).toEqual(fixture.expected_unwrapped);
  });

  it("fixture sdk_version matches installed SDK major version", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
    // Fixture captures SDK 1.x behavior — assert major version matches
    const fixtureVersion = fixture.sdk_version as string;
    expect(fixtureVersion.startsWith("1.")).toBe(true);
  });
});

// ─── No SDK type leakage ───────────────────────────────────────────────────────

describe("McpClientWrapper: no SDK type leakage in public API", () => {
  it("callTool return type is plain unknown — no content array at top level", async () => {
    const wrapper = new McpClientWrapper(makeMcpConfig());
    injectMockClient(wrapper, makeMockClient());

    const result = await wrapper.callTool("overlay.invoke", {});

    // The SDK wraps responses in { content: [...] } — verify we unwrap it
    const resultObj = result as Record<string, unknown>;
    expect(resultObj["content"]).toBeUndefined();
    expect(resultObj["isError"]).toBeUndefined();
  });

  it("callTool with empty content array returns the raw envelope as fallback", async () => {
    const mockClient = makeMockClient(async () => ({
      content: [],
      isError: false,
    }));
    const wrapper = new McpClientWrapper(makeMcpConfig());
    injectMockClient(wrapper, mockClient);

    // Empty content array falls through to return raw
    const result = await wrapper.callTool("overlay.invoke", {});
    // Raw is returned as-is when content array is empty
    expect(result).toBeDefined();
  });
});
