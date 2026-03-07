/**
 * Tests for --workflow <name> and --feature <name> CLI flags in run and status commands.
 *
 * Verifies that the workflow search order respects the CLI flags:
 *   0. --workflow <name>  →  .ai-sdd/workflows/<name>.yaml
 *   1. --feature <name>  →  specs/<name>/workflow.yaml
 *   2. specs/workflow.yaml             (greenfield project)
 *   3. .ai-sdd/workflow.yaml           (backward compat)
 *   4. config.workflow in ai-sdd.yaml
 *   5. .ai-sdd/workflows/default-sdd.yaml
 *   6. bundled framework default
 *
 * Also verifies directory-prefix allowlist matching for plan-tasks output.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve, join } from "path";
import { WorkflowLoader } from "../src/core/workflow-loader.ts";

const TMP = resolve(import.meta.dir, ".tmp-cli-workflow-flag");

function makeMinimalWorkflow(name: string): string {
  return `version: "1"\nname: ${name}\ntasks:\n  task-a:\n    agent: dev\n    description: "test task"\n`;
}

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, ".ai-sdd", "workflows"), { recursive: true });
  mkdirSync(join(TMP, "specs"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/**
 * Mirrors the search order logic from run.ts — extracted for testing.
 */
function resolveWorkflowPath(
  projectPath: string,
  opts: {
    cliWorkflowName?: string;
    featureName?: string;
    configWorkflowName?: string;
  } = {},
): string | null {
  const { cliWorkflowName, featureName, configWorkflowName } = opts;

  const cliWorkflowPath = cliWorkflowName
    ? resolve(projectPath, ".ai-sdd", "workflows", `${cliWorkflowName}.yaml`)
    : null;
  const featureWorkflowPath = featureName
    ? resolve(projectPath, "specs", featureName, "workflow.yaml")
    : null;
  const specsWorkflowPath = resolve(projectPath, "specs", "workflow.yaml");
  const workflowPath = resolve(projectPath, ".ai-sdd", "workflow.yaml");
  const configWorkflowPath = configWorkflowName
    ? resolve(projectPath, ".ai-sdd", "workflows", `${configWorkflowName}.yaml`)
    : null;
  const initCopiedPath = resolve(projectPath, ".ai-sdd", "workflows", "default-sdd.yaml");

  const wfPath =
    cliWorkflowPath && existsSync(cliWorkflowPath)
      ? cliWorkflowPath
      : featureWorkflowPath && existsSync(featureWorkflowPath)
        ? featureWorkflowPath
        : existsSync(specsWorkflowPath)
          ? specsWorkflowPath
          : existsSync(workflowPath)
            ? workflowPath
            : configWorkflowPath && existsSync(configWorkflowPath)
              ? configWorkflowPath
              : existsSync(initCopiedPath)
                ? initCopiedPath
                : null;

  return wfPath;
}

/**
 * Mirrors the allowlist check from complete-task.ts — extracted for testing.
 */
function isOutputAllowed(rel: string, declaredPaths: string[]): boolean {
  const normalizedRel = rel.replace(/\\/g, "/");
  return declaredPaths.some((p) => {
    const norm = p.replace(/\\/g, "/");
    if (norm.endsWith("/")) return normalizedRel.startsWith(norm);
    return normalizedRel === norm;
  });
}

describe("CLI --workflow flag: search order", () => {
  it("--workflow flag takes priority over specs/workflow.yaml", () => {
    writeFileSync(join(TMP, "specs", "workflow.yaml"), makeMinimalWorkflow("specs-default"));
    writeFileSync(
      join(TMP, ".ai-sdd", "workflows", "custom.yaml"),
      makeMinimalWorkflow("custom"),
    );

    const path = resolveWorkflowPath(TMP, { cliWorkflowName: "custom" });
    expect(path).toBe(join(TMP, ".ai-sdd", "workflows", "custom.yaml"));

    const wf = WorkflowLoader.loadFile(path!);
    expect(wf.config.name).toBe("custom");
  });

  it("--workflow flag takes priority over .ai-sdd/workflow.yaml", () => {
    writeFileSync(join(TMP, ".ai-sdd", "workflow.yaml"), makeMinimalWorkflow("default"));
    writeFileSync(
      join(TMP, ".ai-sdd", "workflows", "custom.yaml"),
      makeMinimalWorkflow("custom"),
    );

    const path = resolveWorkflowPath(TMP, { cliWorkflowName: "custom" });
    expect(path).toBe(join(TMP, ".ai-sdd", "workflows", "custom.yaml"));
  });

  it("--workflow flag takes priority over config.workflow", () => {
    writeFileSync(
      join(TMP, ".ai-sdd", "workflows", "from-config.yaml"),
      makeMinimalWorkflow("from-config"),
    );
    writeFileSync(
      join(TMP, ".ai-sdd", "workflows", "from-cli.yaml"),
      makeMinimalWorkflow("from-cli"),
    );

    const path = resolveWorkflowPath(TMP, {
      cliWorkflowName: "from-cli",
      configWorkflowName: "from-config",
    });
    expect(path).toBe(join(TMP, ".ai-sdd", "workflows", "from-cli.yaml"));
  });

  it("--feature flag resolves specs/<feature>/workflow.yaml", () => {
    mkdirSync(join(TMP, "specs", "my-feature"), { recursive: true });
    writeFileSync(
      join(TMP, "specs", "my-feature", "workflow.yaml"),
      makeMinimalWorkflow("my-feature"),
    );

    const path = resolveWorkflowPath(TMP, { featureName: "my-feature" });
    expect(path).toBe(join(TMP, "specs", "my-feature", "workflow.yaml"));

    const wf = WorkflowLoader.loadFile(path!);
    expect(wf.config.name).toBe("my-feature");
  });

  it("--feature flag takes priority over specs/workflow.yaml", () => {
    mkdirSync(join(TMP, "specs", "my-feature"), { recursive: true });
    writeFileSync(
      join(TMP, "specs", "my-feature", "workflow.yaml"),
      makeMinimalWorkflow("my-feature"),
    );
    writeFileSync(join(TMP, "specs", "workflow.yaml"), makeMinimalWorkflow("greenfield"));

    const path = resolveWorkflowPath(TMP, { featureName: "my-feature" });
    expect(path).toBe(join(TMP, "specs", "my-feature", "workflow.yaml"));
  });

  it("falls back to specs/workflow.yaml when no feature flag", () => {
    writeFileSync(join(TMP, "specs", "workflow.yaml"), makeMinimalWorkflow("greenfield"));
    writeFileSync(join(TMP, ".ai-sdd", "workflow.yaml"), makeMinimalWorkflow("legacy"));

    const path = resolveWorkflowPath(TMP);
    expect(path).toBe(join(TMP, "specs", "workflow.yaml"));
  });

  it("falls back to .ai-sdd/workflow.yaml when specs/workflow.yaml missing", () => {
    writeFileSync(join(TMP, ".ai-sdd", "workflow.yaml"), makeMinimalWorkflow("fallback"));

    const path = resolveWorkflowPath(TMP);
    expect(path).toBe(join(TMP, ".ai-sdd", "workflow.yaml"));
  });

  it("falls back to config.workflow when both specs/ and .ai-sdd/workflow.yaml missing", () => {
    writeFileSync(
      join(TMP, ".ai-sdd", "workflows", "configured.yaml"),
      makeMinimalWorkflow("configured"),
    );

    const path = resolveWorkflowPath(TMP, { configWorkflowName: "configured" });
    expect(path).toBe(join(TMP, ".ai-sdd", "workflows", "configured.yaml"));
  });

  it("returns null when --workflow points to non-existent file", () => {
    const path = resolveWorkflowPath(TMP, { cliWorkflowName: "does-not-exist" });
    expect(path).toBeNull();
  });

  it("returns null when no workflows exist at all", () => {
    const path = resolveWorkflowPath(TMP);
    expect(path).toBeNull();
  });
});

describe("complete-task: directory-prefix allowlist matching", () => {
  it("exact path match passes", () => {
    expect(isOutputAllowed("specs/design-l1.md", ["specs/design-l1.md"])).toBe(true);
  });

  it("exact path mismatch fails", () => {
    expect(isOutputAllowed("specs/design-l2.md", ["specs/design-l1.md"])).toBe(false);
  });

  it("directory prefix matches any file under that prefix", () => {
    expect(isOutputAllowed("specs/plan-tasks/tasks/TG-01/T-001.md", ["specs/plan-tasks/tasks/"])).toBe(true);
    expect(isOutputAllowed("specs/plan-tasks/tasks/TG-02/T-010.md", ["specs/plan-tasks/tasks/"])).toBe(true);
  });

  it("directory prefix does not match files outside the prefix", () => {
    expect(isOutputAllowed("specs/other-task/tasks/T-001.md", ["specs/plan-tasks/tasks/"])).toBe(false);
  });

  it("non-prefix path declaration does not match with prefix logic", () => {
    // "specs/plan-tasks/plan.md" is an exact path, not a directory prefix
    expect(isOutputAllowed("specs/plan-tasks/plan.md/extra", ["specs/plan-tasks/plan.md"])).toBe(false);
  });

  it("plan-tasks combined outputs: plan.md and tasks/ directory prefix", () => {
    const declared = ["specs/plan-tasks/plan.md", "specs/plan-tasks/tasks/"];
    expect(isOutputAllowed("specs/plan-tasks/plan.md", declared)).toBe(true);
    expect(isOutputAllowed("specs/plan-tasks/tasks/TG-01/T-001.md", declared)).toBe(true);
    expect(isOutputAllowed("specs/plan-tasks/tasks/TG-01/T-002.md", declared)).toBe(true);
    expect(isOutputAllowed("specs/plan-tasks/README.md", declared)).toBe(false);
  });
});
