/**
 * T002: Workflow loader tests
 */

import { describe, it, expect } from "bun:test";
import { WorkflowLoader } from "../src/core/workflow-loader.ts";
import { resolve } from "path";

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

  it("rejects missing task agent field", () => {
    const yaml = `
version: "1"
name: test
tasks:
  a:
    description: task a
`;
    expect(() => WorkflowLoader.loadYAML(yaml)).toThrow();
  });
});
