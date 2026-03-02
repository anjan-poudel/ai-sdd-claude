/**
 * Adapter factory tests — verifies config.adapter.type drives instantiation.
 */

import { describe, it, expect } from "bun:test";
import { createAdapter } from "../../src/adapters/factory.ts";
import { MockAdapter } from "../../src/adapters/mock-adapter.ts";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code-adapter.ts";
import { OpenAIAdapter } from "../../src/adapters/openai-adapter.ts";

describe("createAdapter", () => {
  it("returns MockAdapter for type=mock", () => {
    const adapter = createAdapter({ type: "mock" });
    expect(adapter).toBeInstanceOf(MockAdapter);
    expect(adapter.adapter_type).toBe("mock");
  });

  it("returns ClaudeCodeAdapter for type=claude_code", () => {
    const adapter = createAdapter({ type: "claude_code" });
    expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
    expect(adapter.adapter_type).toBe("claude_code");
  });

  it("returns ClaudeCodeAdapter with delegation dispatch_mode by default", () => {
    const adapter = createAdapter({ type: "claude_code" }) as ClaudeCodeAdapter;
    expect(adapter.dispatch_mode).toBe("delegation");
  });

  it("passes dispatch_mode override to ClaudeCodeAdapter", () => {
    const adapter = createAdapter({ type: "claude_code", dispatch_mode: "direct" }) as ClaudeCodeAdapter;
    expect(adapter.dispatch_mode).toBe("direct");
  });

  it("returns OpenAIAdapter for type=openai", () => {
    const adapter = createAdapter({ type: "openai" });
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
    expect(adapter.adapter_type).toBe("openai");
  });

  it("throws for type=roo_code with an actionable message", () => {
    expect(() => createAdapter({ type: "roo_code" })).toThrow(
      "roo_code is not a runtime adapter",
    );
  });

  it("never returns MockAdapter when type=claude_code", () => {
    const adapter = createAdapter({ type: "claude_code" });
    expect(adapter).not.toBeInstanceOf(MockAdapter);
  });

  it("never returns MockAdapter when type=openai", () => {
    const adapter = createAdapter({ type: "openai" });
    expect(adapter).not.toBeInstanceOf(MockAdapter);
  });
});
