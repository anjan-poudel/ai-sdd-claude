/**
 * T002: Workflow loader tests
 */

import { describe, it, expect } from "bun:test";
import { WorkflowLoader } from "../src/core/workflow-loader.ts";
import { resolve } from "path";

const LIBRARY_DIR = resolve(import.meta.dir, "../data/task-library");

const DEFAULT_WORKFLOW = resolve(import.meta.dir, "../data/workflows/default-sdd.yaml");

describe("WorkflowLoader: default workflow", () => {
  it("loads default-sdd.yaml without error", () => {
    const graph = WorkflowLoader.loadFile(DEFAULT_WORKFLOW);
    expect(graph.config.name).toBe("default-sdd");
    expect(graph.config.version).toBe("1");
  });

  it("builds parallel execution groups", () => {
    const graph = WorkflowLoader.loadFile(DEFAULT_WORKFLOW);
    expect(graph.execution_plan.groups.length).toBeGreaterThan(0);
    expect(graph.execution_plan.all_tasks.length).toBeGreaterThan(0);
  });

  it("first group contains tasks with no dependencies", () => {
    const graph = WorkflowLoader.loadFile(DEFAULT_WORKFLOW);
    const firstGroup = graph.execution_plan.groups[0];
    expect(firstGroup).toBeDefined();
    expect(firstGroup!.tasks).toContain("define-requirements");
  });

  it("dependencies are correctly mapped", () => {
    const graph = WorkflowLoader.loadFile(DEFAULT_WORKFLOW);
    const deps = graph.dependencies.get("design-l1");
    expect(deps).toBeDefined();
    expect(deps!.has("define-requirements")).toBe(true);
  });

  it("getReadyTasks returns only tasks with met deps", () => {
    const graph = WorkflowLoader.loadFile(DEFAULT_WORKFLOW);
    const completedSet = new Set(["define-requirements"]);
    const ready = graph.getReadyTasks(completedSet);
    expect(ready).toContain("design-l1");
    expect(ready).not.toContain("define-requirements");
  });

  it("getDownstream returns transitive dependents", () => {
    const graph = WorkflowLoader.loadFile(DEFAULT_WORKFLOW);
    const downstream = graph.getDownstream("define-requirements");
    expect(downstream.has("design-l1")).toBe(true);
  });
});

describe("WorkflowLoader: YAML parsing", () => {
  it("detects dependency cycles", () => {
    const yaml = `
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: task a
    depends_on: [b]
  b:
    agent: dev
    description: task b
    depends_on: [a]
`;
    expect(() => WorkflowLoader.loadYAML(yaml)).toThrow("cycle");
  });

  it("rejects unknown dependency references", () => {
    const yaml = `
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: task a
    depends_on: [nonexistent]
`;
    expect(() => WorkflowLoader.loadYAML(yaml)).toThrow("nonexistent");
  });

  it("rejects invalid DSL expressions in exit_conditions", () => {
    const yaml = `
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: task a
    exit_conditions:
      - "eval('bad')"
`;
    expect(() => WorkflowLoader.loadYAML(yaml)).toThrow();
  });

  it("accepts valid DSL exit_conditions", () => {
    const yaml = `
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: task a
    exit_conditions:
      - "review.decision == GO"
`;
    expect(() => WorkflowLoader.loadYAML(yaml)).not.toThrow();
  });

  it("rejects missing agent with no use: to supply it", () => {
    const yaml = `
version: "1"
name: test
tasks:
  a:
    description: task a
`;
    expect(() => WorkflowLoader.loadYAML(yaml)).toThrow("agent is required");
  });

  it("rejects missing description with no use: or template to supply it", () => {
    const yaml = `
version: "1"
name: test
tasks:
  a:
    agent: dev
`;
    expect(() => WorkflowLoader.loadYAML(yaml)).toThrow("description is required");
  });
});

describe("WorkflowLoader: T022 engine built-in defaults", () => {
  it("applies engine default hil.enabled = true when no overlays specified", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: task a
`);
    const task = graph.getTask("a");
    expect(task.overlays?.hil?.enabled).toBe(true);
  });

  it("applies engine default policy_gate.risk_tier = T1", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: task a
`);
    const task = graph.getTask("a");
    expect(task.overlays?.policy_gate?.risk_tier).toBe("T1");
  });

  it("applies engine default max_rework_iterations = 3", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: task a
`);
    const task = graph.getTask("a");
    expect(task.max_rework_iterations).toBe(3);
  });
});

describe("WorkflowLoader: T022 workflow-level defaults", () => {
  it("workflow defaults override engine defaults", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
defaults:
  overlays:
    hil: { enabled: false }
  max_rework_iterations: 2
tasks:
  a:
    agent: dev
    description: task a
`);
    const task = graph.getTask("a");
    expect(task.overlays?.hil?.enabled).toBe(false);
    expect(task.max_rework_iterations).toBe(2);
  });

  it("per-overlay-key merge: workflow default does not clobber other overlay keys", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
defaults:
  overlays:
    hil: { enabled: false }
tasks:
  a:
    agent: dev
    description: task a
    overlays:
      policy_gate: { risk_tier: T2 }
`);
    const task = graph.getTask("a");
    expect(task.overlays?.hil?.enabled).toBe(false);
    expect(task.overlays?.policy_gate?.risk_tier).toBe("T2");
  });

  it("task-level overlay override wins over workflow default", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
defaults:
  overlays:
    policy_gate: { risk_tier: T1 }
tasks:
  a:
    agent: dev
    description: task a
    overlays:
      policy_gate: { risk_tier: T2 }
`);
    expect(graph.getTask("a").overlays?.policy_gate?.risk_tier).toBe("T2");
  });
});

describe("WorkflowLoader: T022 task library (use:)", () => {
  it("use: standard-review resolves agent to reviewer", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: implement
  review:
    use: standard-review
    description: review it
    depends_on: [a]
`, LIBRARY_DIR);
    expect(graph.getTask("review").agent).toBe("reviewer");
  });

  it("use: standard-review sets review.enabled = true", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: implement
  review:
    use: standard-review
    description: review it
    depends_on: [a]
`, LIBRARY_DIR);
    expect(graph.getTask("review").overlays?.review?.enabled).toBe(true);
  });

  it("substitutes {{task_id}} in library output paths", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: implement
  verify-fix:
    use: standard-review
    description: review it
    depends_on: [a]
`, LIBRARY_DIR);
    const outputs = graph.getTask("verify-fix").outputs ?? [];
    expect(outputs.some((o) => o.path.includes("verify-fix"))).toBe(true);
    expect(outputs.some((o) => o.path.includes("{{task_id}}"))).toBe(false);
  });

  it("inline outputs override library outputs", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: implement
  review:
    use: standard-review
    description: review it
    depends_on: [a]
    outputs:
      - path: custom/my-review.md
`, LIBRARY_DIR);
    const outputs = graph.getTask("review").outputs ?? [];
    expect(outputs[0]?.path).toBe("custom/my-review.md");
  });

  it("inline overlay overrides library overlay", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: implement
  review:
    use: standard-review
    description: review it
    depends_on: [a]
    overlays:
      policy_gate: { risk_tier: T2 }
`, LIBRARY_DIR);
    expect(graph.getTask("review").overlays?.policy_gate?.risk_tier).toBe("T2");
    // review.enabled from template should be preserved
    expect(graph.getTask("review").overlays?.review?.enabled).toBe(true);
  });

  it("resolves description from template when not specified inline", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: implement
  review:
    use: standard-review
    depends_on: [a]
`, LIBRARY_DIR);
    const desc = graph.getTask("review").description;
    expect(typeof desc).toBe("string");
    expect(desc.length).toBeGreaterThan(0);
  });

  it("inline description overrides template description", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    agent: dev
    description: implement
  review:
    use: standard-review
    description: "Custom review instructions for this workflow."
    depends_on: [a]
`, LIBRARY_DIR);
    expect(graph.getTask("review").description).toBe("Custom review instructions for this workflow.");
  });

  it("zero-config task: only use: and depends_on", () => {
    const graph = WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  implement:
    use: standard-implement
    depends_on: []
  review:
    use: standard-review
    depends_on: [implement]
`, LIBRARY_DIR);
    const impl = graph.getTask("implement");
    expect(impl.agent).toBe("dev");
    expect(typeof impl.description).toBe("string");
    const rev = graph.getTask("review");
    expect(rev.agent).toBe("reviewer");
    expect(typeof rev.description).toBe("string");
  });

  it("throws on nonexistent library template", () => {
    expect(() => WorkflowLoader.loadYAML(`
version: "1"
name: test
tasks:
  a:
    use: nonexistent-template
`, LIBRARY_DIR)).toThrow("nonexistent-template");
  });
});

describe("WorkflowLoader: T022 example workflows load with defaults", () => {
  const examples = [
    "01-quickfix",
    "02-agile-feature",
    "03-api-first",
    "04-platform-service",
    "05-greenfield-product",
    "06-regulated-enterprise",
  ];

  for (const name of examples) {
    it(`loads ${name} without error`, () => {
      const path = resolve(import.meta.dir, `../data/workflows/examples/${name}.yaml`);
      expect(() => WorkflowLoader.loadFile(path)).not.toThrow();
    });
  }
});
