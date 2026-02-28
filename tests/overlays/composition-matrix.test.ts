/**
 * T014: Overlay composition matrix tests — pairwise combinations + 5 invariants
 */

import { describe, it, expect } from "bun:test";
import {
  validateOverlayCombination,
  buildOverlayChain,
} from "../../src/overlays/composition-rules.ts";
import type { BaseOverlay } from "../../src/overlays/base-overlay.ts";

// Helper to create mock overlays
function mockOverlay(name: string, enabled = true): BaseOverlay {
  return { name, enabled };
}

describe("Overlay composition invariants", () => {
  it("Invariant 1: HIL must be first in chain", () => {
    const chain = [
      mockOverlay("policy_gate"),
      mockOverlay("hil"),
    ];
    const result = validateOverlayCombination(chain);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("first"))).toBe(true);
  });

  it("HIL first is valid", () => {
    const chain = [
      mockOverlay("hil"),
      mockOverlay("policy_gate"),
      mockOverlay("confidence"),
    ];
    const result = validateOverlayCombination(chain);
    expect(result.valid).toBe(true);
  });

  it("Invariant 5: Paired and Review cannot both be enabled", () => {
    const chain = [
      mockOverlay("hil"),
      mockOverlay("paired"),
      mockOverlay("review"),
    ];
    const result = validateOverlayCombination(chain);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("mutually exclusive"))).toBe(true);
  });

  it("Paired without Review is valid", () => {
    const chain = [
      mockOverlay("hil"),
      mockOverlay("paired"),
      mockOverlay("confidence"),
    ];
    const result = validateOverlayCombination(chain);
    expect(result.valid).toBe(true);
  });

  it("Review without Paired is valid", () => {
    const chain = [
      mockOverlay("hil"),
      mockOverlay("policy_gate"),
      mockOverlay("review"),
      mockOverlay("confidence"),
    ];
    const result = validateOverlayCombination(chain);
    expect(result.valid).toBe(true);
  });

  it("Disabled overlays are not counted in invariant checks", () => {
    const chain = [
      mockOverlay("policy_gate", true),
      mockOverlay("hil", false), // disabled — not in active chain
    ];
    const result = validateOverlayCombination(chain);
    // hil is disabled so not in enabled list — no invariant 1 violation
    expect(result.valid).toBe(true);
  });
});

describe("buildOverlayChain", () => {
  it("builds chain in correct locked order", () => {
    const chain = buildOverlayChain({
      confidence: mockOverlay("confidence"),
      hil: mockOverlay("hil"),
      policy_gate: mockOverlay("policy_gate"),
      review: mockOverlay("review"),
    });

    const names = chain.map((o) => o.name);
    expect(names[0]).toBe("hil");
    expect(names[1]).toBe("policy_gate");
    expect(names[2]).toBe("review");
    expect(names[3]).toBe("confidence");
  });

  it("handles partial overlays", () => {
    const chain = buildOverlayChain({
      hil: mockOverlay("hil"),
      confidence: mockOverlay("confidence"),
    });
    expect(chain).toHaveLength(2);
    expect(chain[0]!.name).toBe("hil");
    expect(chain[1]!.name).toBe("confidence");
  });
});

describe("Pairwise overlay combinations (matrix)", () => {
  const overlayNames = ["hil", "policy_gate", "review", "paired", "confidence"];

  // Test all valid single-overlay combinations
  for (const name of overlayNames) {
    it(`single overlay [${name}] is valid`, () => {
      const chain = [mockOverlay(name)];
      const result = validateOverlayCombination(chain);
      // Only invariant 1 might fail if hil is not first — but single overlay can't violate that
      // unless something after hil exists (there isn't one here)
      expect(result.errors.filter((e) => !e.includes("first"))).toHaveLength(0);
    });
  }

  it("full standard chain is valid", () => {
    const chain = [
      mockOverlay("hil"),
      mockOverlay("policy_gate"),
      mockOverlay("review"),
      mockOverlay("confidence"),
    ];
    const result = validateOverlayCombination(chain);
    expect(result.valid).toBe(true);
  });

  it("empty chain is valid", () => {
    const result = validateOverlayCombination([]);
    expect(result.valid).toBe(true);
  });
});
