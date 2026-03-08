/**
 * Standards enforcement tests.
 *
 * Verifies:
 * - Auto-discovery of *.md files under standards/
 * - Explicit standards_paths override
 * - standards_paths=[] disables enforcement
 * - Standards content is merged into the resolved constitution
 * - Missing file: warning by default, error when strict=true
 * - --standards CLI arg parsing: comma-separated paths, "none" disables
 */

import { describe, it, expect, afterEach } from "bun:test";
import { ConstitutionResolver } from "../src/constitution/resolver.ts";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const TMP = "/tmp/ai-sdd-standards-test";

function setup(files: Record<string, string>): string {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(TMP, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return TMP;
}

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("standards: auto-discovery", () => {
  it("auto-discovers *.md files under standards/ and appends to constitution", () => {
    setup({
      "constitution.md": "# Project constitution",
      "standards/java/CLAUDE-java.md": "# Java rules\nUse hexagonal architecture.",
      "standards/kotlin/CLAUDE-kotlin.md": "# Kotlin rules\nUse extension functions.",
    });

    const resolver = new ConstitutionResolver({ project_path: TMP, strict_parse: false });
    const result = resolver.resolve();

    expect(result.content).toContain("# Project constitution");
    expect(result.content).toContain("## Coding Standards");
    expect(result.content).toContain("# Java rules");
    expect(result.content).toContain("# Kotlin rules");
    expect(result.sources).toContain(join(TMP, "standards/java/CLAUDE-java.md"));
    expect(result.sources).toContain(join(TMP, "standards/kotlin/CLAUDE-kotlin.md"));
  });

  it("sorts standards files deterministically (alphabetical by directory then name)", () => {
    setup({
      "constitution.md": "# Constitution",
      "standards/a-lang/rules.md": "# A lang",
      "standards/b-lang/rules.md": "# B lang",
    });

    const resolver = new ConstitutionResolver({ project_path: TMP, strict_parse: false });
    const result = resolver.resolve();
    const aPos = result.content.indexOf("# A lang");
    const bPos = result.content.indexOf("# B lang");
    expect(aPos).toBeLessThan(bPos);
  });

  it("no standards/ directory: constitution resolved normally without standards section", () => {
    setup({ "constitution.md": "# Just the constitution" });

    const resolver = new ConstitutionResolver({ project_path: TMP, strict_parse: false });
    const result = resolver.resolve();

    expect(result.content).toContain("# Just the constitution");
    expect(result.content).not.toContain("## Coding Standards");
  });
});

describe("standards: explicit paths override", () => {
  it("uses explicit standards_paths instead of auto-discovery", () => {
    setup({
      "constitution.md": "# Constitution",
      "standards/java/CLAUDE-java.md": "# Java (should be ignored)",
      "custom-rules/my-rules.md": "# Custom rules",
    });

    const resolver = new ConstitutionResolver({
      project_path: TMP,
      strict_parse: false,
      standards_paths: ["custom-rules/my-rules.md"],
    });
    const result = resolver.resolve();

    expect(result.content).toContain("# Custom rules");
    expect(result.content).not.toContain("# Java (should be ignored)");
  });

  it("standards_paths=[] disables standards entirely", () => {
    setup({
      "constitution.md": "# Constitution",
      "standards/java/CLAUDE-java.md": "# Java rules",
    });

    const resolver = new ConstitutionResolver({
      project_path: TMP,
      strict_parse: false,
      standards_paths: [],
    });
    const result = resolver.resolve();

    expect(result.content).not.toContain("## Coding Standards");
    expect(result.content).not.toContain("# Java rules");
  });

  it("accepts absolute paths in standards_paths", () => {
    setup({
      "constitution.md": "# Constitution",
      "standards/abs-rules.md": "# Absolute rules",
    });

    const resolver = new ConstitutionResolver({
      project_path: TMP,
      strict_parse: false,
      standards_paths: [join(TMP, "standards/abs-rules.md")],
    });
    const result = resolver.resolve();
    expect(result.content).toContain("# Absolute rules");
  });
});

describe("standards: missing file handling", () => {
  it("warns (default) when a standards file is missing", () => {
    setup({ "constitution.md": "# Constitution" });

    const resolver = new ConstitutionResolver({
      project_path: TMP,
      strict_parse: false,
      standards_paths: ["does-not-exist.md"],
      standards_strict: false,
    });
    const result = resolver.resolve();
    expect(result.warnings.some((w) => w.includes("does-not-exist.md"))).toBe(true);
    expect(result.content).not.toContain("## Coding Standards");
  });

  it("throws when standards_strict=true and a file is missing", () => {
    setup({ "constitution.md": "# Constitution" });

    const resolver = new ConstitutionResolver({
      project_path: TMP,
      strict_parse: false,
      standards_paths: ["does-not-exist.md"],
      standards_strict: true,
    });
    expect(() => resolver.resolve()).toThrow("does-not-exist.md");
  });
});

describe("standards: CLI --standards arg parsing", () => {
  it('"none" maps to standards_paths=[] (disabled)', () => {
    // Simulates what run.ts does when --standards none is passed
    const standardsArg: string | undefined = "none";
    const paths: string[] | undefined = standardsArg === "none"
      ? []
      : standardsArg.split(",").map((p: string) => p.trim()).filter(Boolean);

    expect(paths).toEqual([]);
  });

  it("comma-separated paths are split correctly", () => {
    const standardsArg = "standards/java/CLAUDE-java.md,standards/kotlin/CLAUDE-kotlin.md";
    const paths = standardsArg.split(",").map((p) => p.trim()).filter(Boolean);
    expect(paths).toEqual([
      "standards/java/CLAUDE-java.md",
      "standards/kotlin/CLAUDE-kotlin.md",
    ]);
  });

  it("single path without commas is treated as one item", () => {
    const standardsArg = "standards/java/CLAUDE-java.md";
    const paths = standardsArg.split(",").map((p) => p.trim()).filter(Boolean);
    expect(paths).toEqual(["standards/java/CLAUDE-java.md"]);
  });

  it("undefined arg falls through to config/auto-discovery", () => {
    const standardsArg = undefined;
    const configPaths: string[] | undefined = undefined; // auto-discover
    const paths: string[] | undefined = standardsArg === "none"
      ? []
      : standardsArg !== undefined
        ? (standardsArg as string).split(",").map((p) => p.trim()).filter(Boolean)
        : configPaths;
    expect(paths).toBeUndefined();
  });
});

describe("standards: resolveForTask delegates to resolve", () => {
  it("resolveForTask includes standards content", () => {
    setup({
      "constitution.md": "# Constitution",
      "standards/rules.md": "# Task-level rules",
    });

    const resolver = new ConstitutionResolver({ project_path: TMP, strict_parse: false });
    const result = resolver.resolveForTask("some-task");
    expect(result.content).toContain("# Task-level rules");
  });
});
