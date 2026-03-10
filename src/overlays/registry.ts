/**
 * Overlay registry — builds the unified OverlayProvider chain from local and remote configs.
 * Chain order is locked: HIL → remote overlays → policy_gate → review/paired → traceability → confidence
 */
import type { OverlayProvider } from "../types/overlay-protocol.ts";
import type { ResolvedOverlayConfig, ResolvedBackendConfig } from "../config/remote-overlay-schema.ts";
import type { BaseOverlay } from "./base-overlay.ts";
import type { ObservabilityEmitter } from "../observability/emitter.ts";
import { LocalOverlayProvider } from "./local-overlay-provider.ts";
import { McpOverlayProvider } from "./mcp/mcp-overlay-provider.ts";
import { validateProviderCombination } from "./composition-rules.ts";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export interface RegistryInput {
  localOverlays: {
    hil?: BaseOverlay;
    policy_gate?: BaseOverlay;
    review?: BaseOverlay;
    paired?: BaseOverlay;
    traceability?: BaseOverlay;
    confidence?: BaseOverlay;
  };
  remoteConfig?: ResolvedOverlayConfig;
  /** backendId → resolved tool name from auto-discovery. Populated by resolveBackendTools(). */
  resolvedBackendTools?: Map<string, string>;
  emitter?: ObservabilityEmitter; // required only when remoteConfig has remote_overlays
}

export function buildProviderChain(input: RegistryInput): OverlayProvider[] {
  const chain: OverlayProvider[] = [];

  // 1. HIL first
  if (input.localOverlays.hil) {
    chain.push(new LocalOverlayProvider(input.localOverlays.hil));
  }

  // 2. Remote overlays (after HIL, before policy_gate)
  if (input.remoteConfig?.remote_overlays) {
    for (const [name, cfg] of Object.entries(input.remoteConfig.remote_overlays)) {
      if (!cfg.enabled) continue;

      const backend = input.remoteConfig.overlay_backends?.[cfg.backend];
      if (!backend) {
        throw new RegistryError(
          `remote_overlays['${name}'] references unknown backend '${cfg.backend}'. ` +
          `Add '${cfg.backend}' to overlay_backends in your config.`
        );
      }

      if (backend.runtime === "mcp") {
        if (!input.emitter) {
          throw new RegistryError(
            `remote_overlays['${name}'] requires an ObservabilityEmitter but none was provided.`
          );
        }
        const resolvedTool = input.resolvedBackendTools?.get(cfg.backend);
        chain.push(new McpOverlayProvider(
          name,
          cfg,
          backend as ResolvedBackendConfig & { runtime: "mcp" },
          input.emitter,
          undefined,
          resolvedTool,
        ));
      } else {
        throw new RegistryError(
          `remote_overlays['${name}']: backend runtime '${backend.runtime}' is not yet supported. ` +
          `Only 'mcp' is supported in this release.`
        );
      }
    }
  }

  // 3. Policy gate
  if (input.localOverlays.policy_gate) {
    chain.push(new LocalOverlayProvider(input.localOverlays.policy_gate));
  }

  // 4. Check mutual exclusion BEFORE adding review/paired
  const reviewEnabled = input.localOverlays.review?.enabled;
  const pairedEnabled = input.localOverlays.paired?.enabled;
  if (reviewEnabled && pairedEnabled) {
    throw new RegistryError(
      "Invariant 5 violated: Paired and Review overlays are mutually exclusive — cannot both be enabled"
    );
  }

  // 5. Review and Paired
  if (input.localOverlays.review) {
    chain.push(new LocalOverlayProvider(input.localOverlays.review));
  }
  if (input.localOverlays.paired) {
    chain.push(new LocalOverlayProvider(input.localOverlays.paired));
  }

  // 5b. Traceability (between review/paired and confidence)
  if (input.localOverlays.traceability) {
    chain.push(new LocalOverlayProvider(input.localOverlays.traceability));
  }

  // 6. Confidence
  if (input.localOverlays.confidence) {
    chain.push(new LocalOverlayProvider(input.localOverlays.confidence));
  }

  // 7. Validate the built chain
  const validation = validateProviderCombination(chain);
  if (!validation.valid) {
    throw new RegistryError(validation.errors.join("; "));
  }

  return chain;
}
