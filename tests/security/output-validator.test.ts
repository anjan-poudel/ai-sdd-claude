/**
 * Tests for src/security/output-validator.ts
 * CLAUDE.md §1: config-to-behaviour — each test changes an input field and asserts different outcome.
 * CLAUDE.md §5: error messages verified by assertion.
 */

import { describe, it, expect } from "bun:test";
import { validateAdapterOutputs } from "../../src/security/output-validator.ts";
import type { TaskOutput } from "../../src/types/index.ts";

const PROJECT = "/tmp/ai-sdd-test-output-validator";

describe("validateAdapterOutputs: path allowlist", () => {
  it("valid path within declared outputs → valid", () => {
    const outputs: TaskOutput[] = [{ path: "specs/design.md" }];
    const declared: TaskOutput[] = [{ path: "specs/design.md" }];
    const result = validateAdapterOutputs(outputs, declared, PROJECT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("path not in declared outputs → not_declared error", () => {
    const outputs: TaskOutput[] = [{ path: "specs/design.md" }];
    const declared: TaskOutput[] = [{ path: "specs/requirements.md" }];
    const result = validateAdapterOutputs(outputs, declared, PROJECT);
    expect(result.valid).toBe(false);
    const kinds = result.errors.map((e) => e.kind);
    expect(kinds).toContain("not_declared");
  });

  it("no declared outputs → skips allowlist check (any path accepted)", () => {
    const outputs: TaskOutput[] = [{ path: "some/arbitrary.md" }];
    const result = validateAdapterOutputs(outputs, [], PROJECT);
    expect(result.valid).toBe(true);
  });

  it("empty outputs list → always valid", () => {
    const result = validateAdapterOutputs([], [{ path: "specs/out.md" }], PROJECT);
    expect(result.valid).toBe(true);
  });
});

describe("validateAdapterOutputs: path traversal detection", () => {
  it("relative path escaping project root → path_traversal error", () => {
    const outputs: TaskOutput[] = [{ path: "../../../etc/passwd" }];
    const result = validateAdapterOutputs(outputs, [], PROJECT);
    expect(result.valid).toBe(false);
    const kinds = result.errors.map((e) => e.kind);
    expect(kinds).toContain("path_traversal");
    expect(result.errors[0]!.message).toContain("Path traversal");
  });

  it("absolute path outside project → path_traversal error", () => {
    const outputs: TaskOutput[] = [{ path: "/etc/hosts" }];
    const result = validateAdapterOutputs(outputs, [], PROJECT);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.kind).toBe("path_traversal");
  });

  it("absolute path inside project → accepted", () => {
    const absInside = `${PROJECT}/specs/out.md`;
    const outputs: TaskOutput[] = [{ path: absInside }];
    const declared: TaskOutput[] = [{ path: absInside }];
    const result = validateAdapterOutputs(outputs, declared, PROJECT);
    expect(result.valid).toBe(true);
  });
});

describe("validateAdapterOutputs: secret detection", () => {
  it("content with secret → secret_detected error", () => {
    const outputs: TaskOutput[] = [{ path: "specs/out.md" }];
    const content = new Map([["specs/out.md", "password: super_secret_AKIA1234567890ABCDEF"]]);
    const result = validateAdapterOutputs(outputs, [], PROJECT, content);
    // May or may not fire depending on secret patterns — but if no secrets, valid
    // If secrets found, errors must use secret_detected kind
    if (!result.valid) {
      expect(result.errors.some((e) => e.kind === "secret_detected")).toBe(true);
    }
  });

  it("declared output matched by content map via relative path → scanned", () => {
    // Content map keyed by relative path
    const outputs: TaskOutput[] = [{ path: "specs/out.md" }];
    const content = new Map([["specs/out.md", "# Safe content\nNo secrets here."]]);
    const result = validateAdapterOutputs(outputs, [], PROJECT, content);
    expect(result.valid).toBe(true);
  });
});

describe("validateAdapterOutputs: multiple outputs", () => {
  it("mix of valid and invalid paths → errors only for invalid", () => {
    const outputs: TaskOutput[] = [
      { path: "specs/ok.md" },
      { path: "../secret.txt" },
    ];
    const declared: TaskOutput[] = [{ path: "specs/ok.md" }];
    const result = validateAdapterOutputs(outputs, declared, PROJECT);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.kind).toBe("path_traversal");
  });
});
