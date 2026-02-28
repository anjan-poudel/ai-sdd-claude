/**
 * Overlay composition rules — invariants and validation.
 *
 * Invariants:
 * 1. HIL is always first in the chain when enabled
 * 2. Evidence gate is always post-task (never pre-task)
 * 3. T2 risk tier always triggers HIL
 * 4. Confidence is always advisory (never blocks)
 * 5. Paired and Review are mutually exclusive (cannot both be enabled)
 */

import type { BaseOverlay } from "./base-overlay.ts";

export interface CompositionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateOverlayCombination(
  overlays: BaseOverlay[],
): CompositionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const names = overlays.map((o) => o.name);
  const enabledNames = overlays.filter((o) => o.enabled).map((o) => o.name);

  // Invariant 1: HIL must be first when present
  if (enabledNames.includes("hil")) {
    const hilIdx = enabledNames.indexOf("hil");
    if (hilIdx !== 0) {
      errors.push("Invariant 1 violated: HIL overlay must be first in the chain");
    }
  }

  // Invariant 2: Evidence gate must be at position 2 (after HIL) when both present
  if (enabledNames.includes("hil") && enabledNames.includes("policy_gate")) {
    const hilIdx = enabledNames.indexOf("hil");
    const gateIdx = enabledNames.indexOf("policy_gate");
    if (gateIdx <= hilIdx) {
      errors.push("Invariant 2 violated: Evidence gate must come after HIL");
    }
  }

  // Invariant 5: Paired and Review are mutually exclusive
  if (enabledNames.includes("paired") && enabledNames.includes("review")) {
    errors.push("Invariant 5 violated: Paired and Review overlays are mutually exclusive — cannot both be enabled");
  }

  // Warning: Confidence should come after gate when both present
  if (enabledNames.includes("policy_gate") && enabledNames.includes("confidence")) {
    const gateIdx = enabledNames.indexOf("policy_gate");
    const confIdx = enabledNames.indexOf("confidence");
    if (confIdx < gateIdx) {
      warnings.push("Confidence overlay should come after policy gate in the chain");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Build the standard overlay chain in locked order:
 * HIL → Evidence Gate → Agentic Review → Paired Workflow → Confidence Loop → Agent Execution
 */
export function buildOverlayChain(overlays: {
  hil?: BaseOverlay;
  policy_gate?: BaseOverlay;
  review?: BaseOverlay;
  paired?: BaseOverlay;
  confidence?: BaseOverlay;
}): BaseOverlay[] {
  const chain: BaseOverlay[] = [];
  if (overlays.hil) chain.push(overlays.hil);
  if (overlays.policy_gate) chain.push(overlays.policy_gate);
  if (overlays.review) chain.push(overlays.review);
  if (overlays.paired) chain.push(overlays.paired);
  if (overlays.confidence) chain.push(overlays.confidence);
  return chain;
}
