/**
 * T001: OverlayInvokeOutputSchema wire-format validation tests.
 */

import { describe, it, expect } from "bun:test";
import { OverlayInvokeOutputSchema } from "../../src/types/overlay-protocol.ts";

describe("OverlayInvokeOutputSchema: valid inputs", () => {
  it("accepts a valid PASS response", () => {
    const result = OverlayInvokeOutputSchema.safeParse({
      protocol_version: "1",
      verdict: "PASS",
      feedback: "All checks passed.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all four valid verdict values", () => {
    const verdicts = ["PASS", "REWORK", "FAIL", "HIL"] as const;
    for (const verdict of verdicts) {
      const result = OverlayInvokeOutputSchema.safeParse({
        protocol_version: "1",
        verdict,
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts optional evidence field absent", () => {
    const result = OverlayInvokeOutputSchema.safeParse({
      protocol_version: "1",
      verdict: "REWORK",
      feedback: "Needs rework.",
      // no evidence field
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional evidence field present", () => {
    const result = OverlayInvokeOutputSchema.safeParse({
      protocol_version: "1",
      verdict: "FAIL",
      feedback: "Scope drift detected.",
      evidence: {
        overlay_id: "coding-standards",
        checks: ["scope_drift", "traceability"],
        report_ref: "/tmp/report.json",
        data: { drift_score: 0.85 },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("OverlayInvokeOutputSchema: rejection cases", () => {
  it("rejects unknown verdict 'FORCE_ACCEPT'", () => {
    const result = OverlayInvokeOutputSchema.safeParse({
      protocol_version: "1",
      verdict: "FORCE_ACCEPT",
    });
    expect(result.success).toBe(false);
  });

  it("rejects response missing verdict field", () => {
    const result = OverlayInvokeOutputSchema.safeParse({
      protocol_version: "1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects protocol_version '2'", () => {
    const result = OverlayInvokeOutputSchema.safeParse({
      protocol_version: "2",
      verdict: "PASS",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty string (parse attempt)", () => {
    const result = OverlayInvokeOutputSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects null input", () => {
    const result = OverlayInvokeOutputSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});
