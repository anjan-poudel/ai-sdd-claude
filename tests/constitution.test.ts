/**
 * T003 + T016: Constitution resolver and manifest writer tests
 */

import { describe, it, expect, afterEach } from "bun:test";
import { ConstitutionResolver } from "../src/constitution/resolver.ts";
import { ManifestWriter, upsertManifestSection } from "../src/constitution/manifest-writer.ts";
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import type { WorkflowState } from "../src/types/index.ts";

const TEST_DIR = "/tmp/ai-sdd-constitution-test";

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
});

describe("ConstitutionResolver", () => {
  it("returns empty result when no constitution found (strict=false)", () => {
    const resolver = new ConstitutionResolver({
      project_path: TEST_DIR,
      strict_parse: false,
    });
    mkdirSync(TEST_DIR, { recursive: true });
    const result = resolver.resolve();
    expect(result.content).toBe("");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("throws when no constitution found (strict=true)", () => {
    const resolver = new ConstitutionResolver({
      project_path: TEST_DIR,
      strict_parse: true,
    });
    mkdirSync(TEST_DIR, { recursive: true });
    expect(() => resolver.resolve()).toThrow();
  });

  it("reads CLAUDE.md as constitution", () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), "# Project Constitution\n\nTest content.", "utf-8");
    const resolver = new ConstitutionResolver({ project_path: TEST_DIR, strict_parse: false });
    const result = resolver.resolve();
    expect(result.content).toContain("Test content");
    expect(result.sources).toHaveLength(1);
  });

  it("resolveForTask returns same content as resolve() in Phase 1", () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, "constitution.md"), "# Constitution", "utf-8");
    const resolver = new ConstitutionResolver({ project_path: TEST_DIR, strict_parse: false });
    const full = resolver.resolve();
    const forTask = resolver.resolveForTask("task-1");
    expect(forTask.content).toBe(full.content);
  });
});

describe("ManifestWriter", () => {
  it("creates constitution.md with manifest section", () => {
    mkdirSync(join(TEST_DIR, ".ai-sdd"), { recursive: true });
    const writer = new ManifestWriter(join(TEST_DIR, ".ai-sdd", "constitution.md"), TEST_DIR);

    const state: WorkflowState = {
      schema_version: "1",
      workflow: "test",
      project: TEST_DIR,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tasks: {
        "task-1": {
          status: "COMPLETED",
          started_at: "2026-01-01T00:00:00Z",
          completed_at: "2026-01-01T00:01:00Z",
          outputs: [{ path: "output.md", contract: "requirements_doc" }],
          iterations: 1,
        },
      },
    };

    writer.writeArtifactManifest(state);

    const constitutionPath = join(TEST_DIR, ".ai-sdd", "constitution.md");
    expect(existsSync(constitutionPath)).toBe(true);

    const content = readFileSync(constitutionPath, "utf-8");
    expect(content).toContain("## Workflow Artifacts");
    expect(content).toContain("task-1");
    expect(content).toContain("output.md");
  });

  it("upsertManifestSection replaces existing section", () => {
    const original = "# Header\n\n## Workflow Artifacts\n\n_old content_\n\n<!-- end:workflow-artifacts -->\n\n## Footer";
    const newSection = "## Workflow Artifacts\n\n_new content_\n\n<!-- end:workflow-artifacts -->";
    const result = upsertManifestSection(original, newSection);
    expect(result).toContain("_new content_");
    expect(result).not.toContain("_old content_");
    expect(result).toContain("## Footer");
  });

  it("upsertManifestSection appends when no existing section", () => {
    const original = "# Header\n\nSome content.";
    const newSection = "## Workflow Artifacts\n\n_content_\n\n<!-- end:workflow-artifacts -->";
    const result = upsertManifestSection(original, newSection);
    expect(result).toContain("# Header");
    expect(result).toContain("## Workflow Artifacts");
  });

  it("idempotent: double-write produces same content", () => {
    mkdirSync(join(TEST_DIR, ".ai-sdd"), { recursive: true });
    const writer = new ManifestWriter(join(TEST_DIR, ".ai-sdd", "constitution.md"), TEST_DIR);

    const state: WorkflowState = {
      schema_version: "1",
      workflow: "test",
      project: TEST_DIR,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tasks: {
        "task-1": {
          status: "COMPLETED",
          started_at: null,
          completed_at: "2026-01-01T00:01:00Z",
          outputs: [{ path: "output.md" }],
          iterations: 1,
        },
      },
    };

    writer.writeArtifactManifest(state);
    const first = readFileSync(join(TEST_DIR, ".ai-sdd", "constitution.md"), "utf-8");

    writer.writeArtifactManifest(state);
    const second = readFileSync(join(TEST_DIR, ".ai-sdd", "constitution.md"), "utf-8");

    expect(first).toBe(second);
  });
});
