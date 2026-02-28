/**
 * T013: Artifact contract tests
 */

import { describe, it, expect } from "bun:test";
import { ArtifactRegistry } from "../src/artifacts/registry.ts";
import { ArtifactValidator } from "../src/artifacts/validator.ts";
import { checkCompatibility, parseContractRef } from "../src/artifacts/compatibility.ts";
import { resolve } from "path";

const SCHEMA_PATH = resolve(import.meta.dir, "../data/artifacts/schema.yaml");

describe("ArtifactRegistry", () => {
  it("loads schema.yaml without error", () => {
    const registry = new ArtifactRegistry();
    expect(() => registry.loadFile(SCHEMA_PATH)).not.toThrow();
  });

  it("has known contracts after load", () => {
    const registry = new ArtifactRegistry();
    registry.loadFile(SCHEMA_PATH);
    expect(registry.has("requirements_doc")).toBe(true);
    expect(registry.has("review_report")).toBe(true);
    expect(registry.has("spec_gate_report")).toBe(true);
  });

  it("getStrict throws for unknown contract", () => {
    const registry = new ArtifactRegistry();
    registry.loadFile(SCHEMA_PATH);
    expect(() => registry.getStrict("nonexistent")).toThrow("not found");
  });

  it("get returns null for unknown contract", () => {
    const registry = new ArtifactRegistry();
    registry.loadFile(SCHEMA_PATH);
    expect(registry.get("nonexistent")).toBeNull();
  });

  it("rejects missing schema file", () => {
    const registry = new ArtifactRegistry();
    expect(() => registry.loadFile("/nonexistent/path.yaml")).toThrow("not found");
  });
});

describe("ArtifactValidator", () => {
  let registry: ArtifactRegistry;

  registry = new ArtifactRegistry();
  registry.loadFile(SCHEMA_PATH);

  it("validates content with required sections present", () => {
    const validator = new ArtifactValidator(registry);
    const content = `# Requirements Doc\n\n## Overview\n\nTest project.\n\n## Requirements\n\nReq 1.\n\n## Acceptance Criteria\n\nGiven...`;
    const result = validator.validate(content, "requirements_doc");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails validation when required section is missing", () => {
    const validator = new ArtifactValidator(registry);
    const content = `# Requirements Doc\n\n## Overview\n\nTest.`;
    const result = validator.validate(content, "requirements_doc");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Requirements"))).toBe(true);
  });

  it("legacy mode skips validation for unknown contract", () => {
    const validator = new ArtifactValidator(registry);
    const result = validator.validate("anything", "unknown_contract", true);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("strict mode fails for unknown contract", () => {
    const validator = new ArtifactValidator(registry);
    const result = validator.validate("anything", "unknown_contract", false);
    expect(result.valid).toBe(false);
  });
});

describe("Compatibility", () => {
  it("same major version is compatible", () => {
    const result = checkCompatibility(
      { name: "req", version: "1", description: "" },
      { name: "req", version: "1.1", description: "" },
    );
    expect(result.compatible).toBe(true);
  });

  it("different major versions are incompatible", () => {
    const result = checkCompatibility(
      { name: "req", version: "1", description: "" },
      { name: "req", version: "2", description: "" },
    );
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("Major version mismatch");
  });

  it("different contract names are incompatible", () => {
    const result = checkCompatibility(
      { name: "requirements_doc", version: "1", description: "" },
      { name: "review_report", version: "1", description: "" },
    );
    expect(result.compatible).toBe(false);
  });
});

describe("parseContractRef", () => {
  it("parses name@version", () => {
    expect(parseContractRef("requirements_doc@1")).toEqual({ name: "requirements_doc", version: "1" });
  });

  it("defaults to version 1 when no @ present", () => {
    expect(parseContractRef("requirements_doc")).toEqual({ name: "requirements_doc", version: "1" });
  });
});
