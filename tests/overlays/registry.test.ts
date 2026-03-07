/**
 * T005: Overlay Registry tests — chain order, error cases, backward compat.
 * CLAUDE.md §1: Config-to-behavior pattern.
 * CLAUDE.md §3: No silent stubs — unknown backend and other errors must throw.
 */

import { describe, it, expect } from "bun:test";
import { buildProviderChain, RegistryError } from "../../src/overlays/registry.ts";
import {
  validateProviderCombination,
  validateOverlayCombination,
} from "../../src/overlays/composition-rules.ts";
import { LocalOverlayProvider } from "../../src/overlays/local-overlay-provider.ts";
import { McpOverlayProvider } from "../../src/overlays/mcp/mcp-overlay-provider.ts";
import type { BaseOverlay, OverlayContext as LegacyContext, OverlayResult } from "../../src/overlays/base-overlay.ts";
import type { ResolvedOverlayConfig } from "../../src/config/remote-overlay-schema.ts";
import type { ObservabilityEmitter } from "../../src/observability/emitter.ts";
import type { OverlayProvider } from "../../src/types/overlay-protocol.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBaseOverlay(name: string, enabled = true): BaseOverlay {
  return {
    name,
    enabled,
    async preTask(_ctx: LegacyContext): Promise<OverlayResult> {
      return { proceed: true };
    },
  };
}

function makeEmitter(): ObservabilityEmitter {
  return {
    emit: () => {},
    on: () => {},
    off: () => {},
  } as unknown as ObservabilityEmitter;
}

function makeMcpBackendConfig() {
  return {
    runtime: "mcp" as const,
    command: ["my-mcp-server"],
    tool: "overlay.invoke",
    transport: "stdio" as const,
    timeout_ms: 5000,
    failure_policy: "warn" as const,
  };
}

function makeMcpRemoteConfig(backendId: string) {
  return {
    backend: backendId,
    enabled: true,
    hooks: ["pre_task" as const],
    blocking: true,
  };
}

// ─── Chain order invariants ────────────────────────────────────────────────────

describe("buildProviderChain: chain order invariants", () => {
  it("1. Local-only config (no remote): chain order is HIL → policy_gate → confidence", () => {
    const chain = buildProviderChain({
      localOverlays: {
        hil: makeBaseOverlay("hil"),
        policy_gate: makeBaseOverlay("policy_gate"),
        confidence: makeBaseOverlay("confidence"),
      },
    });

    expect(chain).toHaveLength(3);
    expect(chain[0]!.id).toBe("hil");
    expect(chain[1]!.id).toBe("policy_gate");
    expect(chain[2]!.id).toBe("confidence");
    // All should be local providers
    for (const provider of chain) {
      expect(provider).toBeInstanceOf(LocalOverlayProvider);
    }
  });

  it("2. HIL is always first: even when overlays arrive in arbitrary order, HIL is at index 0", () => {
    // The registry always puts HIL first regardless of any other config
    const chain = buildProviderChain({
      localOverlays: {
        confidence: makeBaseOverlay("confidence"),
        policy_gate: makeBaseOverlay("policy_gate"),
        hil: makeBaseOverlay("hil"),
      },
    });

    expect(chain[0]!.id).toBe("hil");
  });

  it("3. Remote overlay appears at index 1 (after HIL, before policy_gate)", () => {
    const remoteConfig: ResolvedOverlayConfig = {
      overlay_backends: {
        "my-backend": makeMcpBackendConfig(),
      },
      remote_overlays: {
        "coding-standards": makeMcpRemoteConfig("my-backend"),
      },
    };

    const chain = buildProviderChain({
      localOverlays: {
        hil: makeBaseOverlay("hil"),
        policy_gate: makeBaseOverlay("policy_gate"),
        confidence: makeBaseOverlay("confidence"),
      },
      remoteConfig,
      emitter: makeEmitter(),
    });

    expect(chain).toHaveLength(4);
    expect(chain[0]!.id).toBe("hil");
    expect(chain[0]!.runtime).toBe("local");
    expect(chain[1]!.id).toBe("coding-standards");
    expect(chain[1]!.runtime).toBe("mcp");
    expect(chain[2]!.id).toBe("policy_gate");
    expect(chain[3]!.id).toBe("confidence");
  });

  it("4. Multiple remote overlays preserve config insertion order", () => {
    const remoteConfig: ResolvedOverlayConfig = {
      overlay_backends: {
        "backend-a": makeMcpBackendConfig(),
        "backend-b": { ...makeMcpBackendConfig(), command: ["backend-b-cmd"] },
      },
      remote_overlays: {
        "alpha-overlay": makeMcpRemoteConfig("backend-a"),
        "beta-overlay": makeMcpRemoteConfig("backend-b"),
      },
    };

    const chain = buildProviderChain({
      localOverlays: {
        hil: makeBaseOverlay("hil"),
        policy_gate: makeBaseOverlay("policy_gate"),
      },
      remoteConfig,
      emitter: makeEmitter(),
    });

    expect(chain).toHaveLength(4);
    expect(chain[0]!.id).toBe("hil");
    expect(chain[1]!.id).toBe("alpha-overlay");
    expect(chain[2]!.id).toBe("beta-overlay");
    expect(chain[3]!.id).toBe("policy_gate");
  });
});

// ─── Error cases ──────────────────────────────────────────────────────────────

describe("buildProviderChain: error cases", () => {
  it("5. Unknown backend reference → RegistryError naming both overlay and missing backend ID", () => {
    const remoteConfig: ResolvedOverlayConfig = {
      overlay_backends: {
        "some-other-backend": makeMcpBackendConfig(),
      },
      remote_overlays: {
        "my-overlay": makeMcpRemoteConfig("nonexistent-backend"),
      },
    };

    expect(() =>
      buildProviderChain({
        localOverlays: { hil: makeBaseOverlay("hil") },
        remoteConfig,
        emitter: makeEmitter(),
      })
    ).toThrow(RegistryError);

    expect(() =>
      buildProviderChain({
        localOverlays: { hil: makeBaseOverlay("hil") },
        remoteConfig,
        emitter: makeEmitter(),
      })
    ).toThrow("my-overlay");

    expect(() =>
      buildProviderChain({
        localOverlays: { hil: makeBaseOverlay("hil") },
        remoteConfig,
        emitter: makeEmitter(),
      })
    ).toThrow("nonexistent-backend");
  });

  it("6. Both Review and Paired enabled → RegistryError with mutually exclusive message", () => {
    expect(() =>
      buildProviderChain({
        localOverlays: {
          review: makeBaseOverlay("review"),
          paired: makeBaseOverlay("paired"),
        },
      })
    ).toThrow(RegistryError);

    expect(() =>
      buildProviderChain({
        localOverlays: {
          review: makeBaseOverlay("review"),
          paired: makeBaseOverlay("paired"),
        },
      })
    ).toThrow("mutually exclusive");
  });

  it("7. enabled: false remote overlay is excluded from chain — chain length asserted", () => {
    const remoteConfig: ResolvedOverlayConfig = {
      overlay_backends: {
        "my-backend": makeMcpBackendConfig(),
      },
      remote_overlays: {
        "disabled-overlay": {
          ...makeMcpRemoteConfig("my-backend"),
          enabled: false,
        },
      },
    };

    const chain = buildProviderChain({
      localOverlays: {
        hil: makeBaseOverlay("hil"),
        policy_gate: makeBaseOverlay("policy_gate"),
      },
      remoteConfig,
      emitter: makeEmitter(),
    });

    // disabled-overlay must not be in chain — only hil + policy_gate
    expect(chain).toHaveLength(2);
    expect(chain.every((p) => p.runtime === "local")).toBe(true);
  });
});

// ─── Backward compatibility ────────────────────────────────────────────────────

describe("buildProviderChain: backward compatibility", () => {
  it("8. remoteConfig absent → chain contains only LocalOverlayProvider instances", () => {
    const chain = buildProviderChain({
      localOverlays: {
        hil: makeBaseOverlay("hil"),
        policy_gate: makeBaseOverlay("policy_gate"),
        confidence: makeBaseOverlay("confidence"),
      },
    });

    for (const provider of chain) {
      expect(provider).toBeInstanceOf(LocalOverlayProvider);
      expect(provider).not.toBeInstanceOf(McpOverlayProvider);
    }
  });

  it("9. All existing overlay types produce valid LocalOverlayProvider — constructor does not throw", () => {
    const overlayNames = ["hil", "policy_gate", "review", "paired", "confidence"];
    for (const name of overlayNames) {
      const overlay = makeBaseOverlay(name);
      expect(() => new LocalOverlayProvider(overlay)).not.toThrow();
    }
  });

  it("Empty remote_overlays section → all local providers (no McpOverlayProvider)", () => {
    const remoteConfig: ResolvedOverlayConfig = {
      overlay_backends: {
        "my-backend": makeMcpBackendConfig(),
      },
      remote_overlays: {},
    };

    const chain = buildProviderChain({
      localOverlays: {
        hil: makeBaseOverlay("hil"),
        policy_gate: makeBaseOverlay("policy_gate"),
      },
      remoteConfig,
      emitter: makeEmitter(),
    });

    expect(chain).toHaveLength(2);
    for (const provider of chain) {
      expect(provider).toBeInstanceOf(LocalOverlayProvider);
    }
  });

  it("No localOverlays and no remoteConfig → empty chain", () => {
    const chain = buildProviderChain({ localOverlays: {} });
    expect(chain).toHaveLength(0);
  });
});

// ─── Provider type assertions ──────────────────────────────────────────────────

describe("buildProviderChain: provider type assertions", () => {
  it("Remote overlay with mcp backend → McpOverlayProvider instance", () => {
    const remoteConfig: ResolvedOverlayConfig = {
      overlay_backends: {
        "mcp-backend": makeMcpBackendConfig(),
      },
      remote_overlays: {
        "remote-gov": makeMcpRemoteConfig("mcp-backend"),
      },
    };

    const chain = buildProviderChain({
      localOverlays: {},
      remoteConfig,
      emitter: makeEmitter(),
    });

    expect(chain).toHaveLength(1);
    expect(chain[0]).toBeInstanceOf(McpOverlayProvider);
    expect(chain[0]!.runtime).toBe("mcp");
    expect(chain[0]!.id).toBe("remote-gov");
  });

  it("Missing emitter when remote overlay is configured → RegistryError", () => {
    const remoteConfig: ResolvedOverlayConfig = {
      overlay_backends: {
        "my-backend": makeMcpBackendConfig(),
      },
      remote_overlays: {
        "my-overlay": makeMcpRemoteConfig("my-backend"),
      },
    };

    expect(() =>
      buildProviderChain({
        localOverlays: {},
        remoteConfig,
        // no emitter provided
      })
    ).toThrow(RegistryError);
  });
});

// ─── validateProviderCombination tests ────────────────────────────────────────

describe("validateProviderCombination: composition rules", () => {
  function makeProvider(id: string, runtime: "local" | "mcp" = "local", enabled = true): OverlayProvider {
    return {
      id,
      runtime,
      hooks: ["pre_task"],
      enabled,
    };
  }

  it("11. Valid chain (HIL → remote → policy_gate → confidence) → valid: true", () => {
    const providers: OverlayProvider[] = [
      makeProvider("hil", "local"),
      makeProvider("coding-standards", "mcp"),
      makeProvider("policy_gate", "local"),
      makeProvider("confidence", "local"),
    ];

    const result = validateProviderCombination(providers);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("12. Remote provider after policy_gate → errors includes Invariant 6 message", () => {
    const providers: OverlayProvider[] = [
      makeProvider("hil", "local"),
      makeProvider("policy_gate", "local"),
      makeProvider("coding-standards", "mcp"), // after policy_gate — violation
    ];

    const result = validateProviderCombination(providers);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Invariant 6"))).toBe(true);
    expect(result.errors.some((e) => e.includes("remote"))).toBe(true);
    expect(result.errors.some((e) => e.includes("policy_gate"))).toBe(true);
  });

  it("13. Existing validateOverlayCombination still works — no regression", () => {
    // Invariant 1 check using old function
    const chain = [
      { name: "policy_gate", enabled: true },
      { name: "hil", enabled: true },
    ];
    const result = validateOverlayCombination(chain as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("first"))).toBe(true);
  });

  it("HIL at wrong position (not first) → Invariant 1 violation", () => {
    const providers: OverlayProvider[] = [
      makeProvider("policy_gate", "local"),
      makeProvider("hil", "local"), // HIL not first
    ];

    const result = validateProviderCombination(providers);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Invariant 1"))).toBe(true);
  });

  it("Review and Paired both enabled → Invariant 5 violation", () => {
    const providers: OverlayProvider[] = [
      makeProvider("review", "local"),
      makeProvider("paired", "local"),
    ];

    const result = validateProviderCombination(providers);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Invariant 5"))).toBe(true);
    expect(result.errors.some((e) => e.includes("mutually exclusive"))).toBe(true);
  });

  it("Empty providers array → valid: true", () => {
    const result = validateProviderCombination([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("Disabled HIL at wrong position is not counted as violation", () => {
    const providers: OverlayProvider[] = [
      makeProvider("policy_gate", "local"),
      makeProvider("hil", "local", false), // disabled — exempt from invariant 1
    ];

    const result = validateProviderCombination(providers);
    // Disabled hil should not trigger invariant 1 since it's not in the enabled list
    expect(result.errors.some((e) => e.includes("Invariant 1"))).toBe(false);
  });
});
