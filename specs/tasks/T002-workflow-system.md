# T002: Workflow System — YAML Schema, DAG Loader, Default Template

**Phase:** 1 (Core Engine)
**Status:** PENDING
**Dependencies:** T001 (agent system)

---

## Context

Workflows are defined as Directed Acyclic Graphs (DAGs) in YAML. The workflow loader parses the YAML, resolves the DAG, detects cycles, and makes the execution plan available to the core engine. The default SDD workflow template mirrors the current `sdd-unified` pipeline.

---

## Acceptance Criteria

```gherkin
Feature: Workflow YAML loader

  Scenario: Load and validate a well-formed workflow
    Given a valid workflow YAML with three tasks A → B → C
    When the workflow loader parses the file
    Then a WorkflowGraph is returned with correct dependency edges
    And all tasks have status PENDING
    And the topological order is [A, B, C]

  Scenario: Detect cyclic dependency
    Given a workflow YAML with a cycle: A → B → A
    When the workflow loader parses the file
    Then a validation error is raised: "Cyclic dependency detected"
    And the process exits before any task runs

  Scenario: Identify parallel tasks
    Given tasks B and C both depend on A and have no other dependencies
    When the workflow loader builds the DAG
    Then B and C are identified as eligible for parallel execution

  Scenario: Loop config validation
    Given a task with a loop but no max_iterations defined
    When the workflow loader validates the task
    Then a validation error is raised: "loop requires max_iterations"

  Scenario: Agent reference validation
    Given a workflow task referencing agent "custom-agent"
    And no agent named "custom-agent" exists in the AgentRegistry
    When the workflow loads
    Then a validation error is raised: "agent 'custom-agent' not found"

  Scenario: Default workflow ships with framework
    Given the framework is installed
    When `ai-sdd run` is called without specifying a workflow
    Then the default-sdd.yaml workflow is used
```

---

## Inputs

- Workflow YAML file (project or default)
- `AgentRegistry` (from T001) — for agent reference validation

## Outputs

- `WorkflowGraph`: DAG representation with tasks, edges, and overlay configs
- Topological execution order
- Parallel task groups

---

## Workflow YAML Schema (Draft)

```yaml
version: "1"                      # required
name: "standard-sdd"             # required

config:
  max_iterations_default: 5       # default MAX_ITERATION for all loops

tasks:
  <task-id>:                      # required; unique identifier
    agent: <agent-name>           # required; must exist in AgentRegistry
    description: "..."            # optional; human-readable
    inputs: [<path>, ...]         # list of input file paths
    outputs: [<path>, ...]        # list of output file paths
    dependencies: [<task-id>, ...] # empty list for root tasks
    requires_human: false         # optional; triggers HIL before execution
    loop:                         # optional; applies to the whole task
      max_iterations: 3
      exit_conditions:
        - "review.decision == GO"
    overlays:                     # optional; per-task overlay config
      paired_workflow:
        enabled: true
        driver_agent: architect
        challenger_agent: pe
        role_switch: session
        max_iterations: 3
        exit_conditions:
          - "pair.challenger_approved == true"
      confidence_loop:
        enabled: true
        threshold: 0.80
      policy_gate:
        enabled: true
        risk_tier: T1            # T0 | T1 | T2
      agentic_review:
        enabled: true
        max_iterations: 3
        exit_conditions:
          - "review.decision == GO"
```

---

## Default SDD Workflow (Outline)

```
define-requirements (ba)
    └── design-l1 (architect)
        ├── review-l1-ba (ba)
        ├── review-l1-pe (pe)
        └── review-l1-le (le)
            └── design-l2 (pe) [depends on all review-l1-*]
                └── design-l3 (le)
                    └── implement (dev)
                        └── review-code (reviewer)
```

Multiple review tasks at each stage enable parallel execution.

---

## Implementation Notes

- DAG cycle detection: topological sort (Kahn's algorithm or DFS).
- Parallel group identification: tasks with satisfied dependencies and no mutual dependency.
- Workflow schema validation: `jsonschema` against `workflows/schema.yaml`.
- Use `pydantic` models for internal `WorkflowGraph` representation.

---

## Files to Create

- `core/workflow_loader.py`
- `workflows/schema.yaml`
- `workflows/default-sdd.yaml`
- `tests/test_workflow_loader.py`

---

## Test Strategy

- Unit tests: valid workflow load, topological ordering, parallel group detection.
- Unit tests: cycle detection, missing agent reference, missing max_iterations.
- Integration test: load default-sdd.yaml end-to-end.

## Rollback/Fallback

- On workflow validation failure, emit a clear error with the offending task ID and field.
- Never execute a workflow that fails validation.
