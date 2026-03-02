/**
 * Adapter factory — reads config.adapter.type and returns the right RuntimeAdapter.
 *
 * This is the single place where adapter type → class binding lives.
 * Adding a new adapter type requires handling it here; the `satisfies never`
 * guard produces a compile error if a case is missing.
 */

import type { RuntimeAdapter } from "./base-adapter.ts";
import { MockAdapter } from "./mock-adapter.ts";
import { ClaudeCodeAdapter } from "./claude-code-adapter.ts";
import { OpenAIAdapter } from "./openai-adapter.ts";
import type { AdapterType, DispatchMode } from "../types/index.ts";

export interface AdapterFactoryConfig {
  type: AdapterType;
  dispatch_mode?: DispatchMode;
  // claude_code options
  timeout_ms?: number;
  model?: string;
  // openai options
  api_key?: string;
  base_url?: string;
  organization?: string;
  [key: string]: unknown;
}

export function createAdapter(config: AdapterFactoryConfig): RuntimeAdapter {
  switch (config.type) {
    case "mock":
      return new MockAdapter();

    case "claude_code":
      return new ClaudeCodeAdapter({
        dispatch_mode: config.dispatch_mode ?? "delegation",
        ...(config.timeout_ms !== undefined && { timeout_ms: config.timeout_ms as number }),
        ...(config.model !== undefined && { model: config.model as string }),
      });

    case "openai":
      return new OpenAIAdapter({
        ...(config.api_key !== undefined && { api_key: config.api_key as string }),
        ...(config.model !== undefined && { model: config.model as string }),
        ...(config.base_url !== undefined && { base_url: config.base_url as string }),
        ...(config.timeout_ms !== undefined && { timeout_ms: config.timeout_ms as number }),
        ...(config.organization !== undefined && { organization: config.organization as string }),
      });

    case "roo_code":
      throw new Error(
        "roo_code is not a runtime adapter — it uses the MCP server as the integration point. " +
        "Set adapter.type to claude_code, openai, or mock in .ai-sdd/ai-sdd.yaml, " +
        "then run: ai-sdd serve --mcp for Roo Code to connect.",
      );

    default:
      // Exhaustiveness check: compile error if AdapterType gains a new value
      // without a matching case above.
      config.type satisfies never;
      throw new Error(`Unknown adapter type: '${(config as AdapterFactoryConfig).type}'`);
  }
}
