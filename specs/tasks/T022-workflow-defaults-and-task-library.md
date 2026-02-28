# T022: Workflow Defaults + Task Library (Convention over Configuration)

**Phase:** 1 (Core Engine — retroactive improvement to T002)
**Status:** IN_PROGRESS
**Dependencies:** T002 (workflow system), T012 (expression DSL)
**Size:** S (3 days)

---

## Problem

Every workflow repeats the same boilerplate on every task. Common patterns
(standard review, standard implement) are re-defined from scratch in each workflow
file. A new user faces 80+ line workflow files before they can run anything.

**Duplication observed across the 6 example workflows:**
- `hil: enabled: false` copy-pasted on ~80% of tasks in every workflow
- The reviewer pattern (agent, overlays, output contract) fully repeated in every workflow
- `platform-service` has `design-component-a` / `design-component-b` with 95% identical bodies
- `max_rework_iterations: 3` and `policy_gate: risk_tier: T1` appear constantly

---

## Target: a minimal workflow that just works

```yaml
version: "1"
name: quick-feature

tasks:
  implement:
    use: standard-implement
    depends_on: []

  review:
    use: standard-review
    depends_on: [implement]
```

This 6-line workflow is complete. Agent, description, overlays, and output contract
are all supplied by the templates. Override any field inline when you need specifics
for this workflow. Nothing needs to be specified unless it differs from the template.

---

## Solution: Three layers

### Layer 1 — Engine built-in task defaults

Applied to every task in every workflow, regardless of workflow configuration.
These are the "safe defaults" that make the framework secure and observable by default.

```
engine defaults:
  overlays:
    hil:         { enabled: true }     # HIL is on unless explicitly disabled
    policy_gate: { risk_tier: T1 }     # tests + lint required by default
  max_rework_iterations: 3
```

These match the spirit of the existing spec (HIL default ON in CLAUDE.md) but now
are applied uniformly at the task level.

### Layer 2 — Workflow-level `defaults:` block

Overrides engine defaults for every task in the workflow. Use this to set a
workflow-wide baseline that differs from engine defaults.

```yaml
version: "1"
name: quickfix

defaults:
  overlays:
    hil: { enabled: false }   # hotfix: no HIL for speed
  max_rework_iterations: 2

tasks:
  implement-fix:
    agent: dev
    description: "..."
    # inherits: hil.enabled=false, policy_gate.risk_tier=T1 (engine default), max_rework=2

  verify-fix:
    use: standard-review
    description: "..."
    depends_on: [implement-fix]
    # inherits workflow defaults; standard-review sets review.enabled=true
```

### Layer 3 — Task library with `use:` reference

Tasks in `data/task-library/` define reusable partial task templates. A workflow
task uses `use: <name>` to pull in the template, then only specifies what's unique
(`description`, `depends_on`, any overrides).

```yaml
tasks:
  review:
    use: standard-review               # pulls from data/task-library/standard-review.yaml
    description: "Review implementation against acceptance criteria."
    depends_on: [implement]
    # agent, overlays, outputs — all from the template
```

`{{task_id}}` in library output paths is substituted with the actual task ID.

---

## Merge Order (per task, left-to-right, later wins)

```
engine built-in defaults
  → workflow defaults: block
    → task library template (if use: present)
      → task inline definition
```

For `overlays`, merge is **per-overlay-key** (not whole-object replace):
```
engine:   overlays.hil.enabled = true, overlays.policy_gate.risk_tier = T1
workflow: overlays.hil.enabled = false
task:     overlays.policy_gate.risk_tier = T2
result:   hil.enabled=false, policy_gate.risk_tier=T2  ✓
```

For scalar fields, last-writer wins. For `exit_conditions` (list), workflow defaults
prepend to task's own list.

---

## Task Library

Templates live in `data/task-library/`. They provide the invariant properties of each
task type (agent role and output contract). Policy (HIL, risk tier) is intentionally
left to engine defaults and workflow `defaults:` so templates stay composable across
contexts.

**Role primitives** — provide the agent role and contract; policy comes from workflow defaults:

| Template | Agent | Contract | HIL | Risk |
|---|---|---|---|---|
| `define-requirements` | `ba` | `requirements_doc` | on | T0 |
| `design-architecture` | `architect` | `architecture_l1` | on | T0 |
| `design-component` | `pe` | `component_design_l2` | off | T0 |
| `plan-tasks` | `le` | `task_breakdown_l3` | off | T0 |
| `standard-implement` | `dev` | `implementation` | off | T1 |
| `standard-review` | `reviewer` | `review_report` | off | T1 |

**Named workflow stages** — complete task definitions; use directly by task ID:

| Template | Semantic | Agent | Contract | HIL | Risk |
|---|---|---|---|---|---|
| `review-l1` | L1 architecture review | `reviewer` | `review_report` | off | T1 |
| `review-l2` | L2 component design review | `reviewer` | `review_report` | off | T1 |
| `review-implementation` | Final code review | `reviewer` | `review_report` | off | T1 |
| `security-design-review` | Security-focused design audit | `reviewer` | `review_report` | off | T1 |
| `security-test` | Security testing pass | `reviewer` | `review_report` | off | T1 |
| `final-sign-off` | T2 mandatory production gate | `reviewer` | `review_report` | off | T2 |

### Template files

**`define-requirements.yaml`**
```yaml
name: define-requirements
agent: ba
outputs:
  - path: ".ai-sdd/outputs/{{task_id}}.md"
    contract: requirements_doc
```

**`design-architecture.yaml`**
```yaml
name: design-architecture
agent: architect
outputs:
  - path: ".ai-sdd/outputs/{{task_id}}.md"
    contract: architecture_l1
```

**`design-component.yaml`**
```yaml
name: design-component
agent: pe
outputs:
  - path: ".ai-sdd/outputs/{{task_id}}.md"
    contract: component_design_l2
```

**`plan-tasks.yaml`**
```yaml
name: plan-tasks
agent: le
outputs:
  - path: ".ai-sdd/outputs/{{task_id}}.md"
    contract: task_breakdown_l3
```

**`standard-review.yaml`**
```yaml
name: standard-review
agent: reviewer
overlays:
  hil:         { enabled: false }
  review:      { enabled: true }
  policy_gate: { risk_tier: T1 }
outputs:
  - path: ".ai-sdd/outputs/{{task_id}}.md"
    contract: review_report
```

**`standard-implement.yaml`**
```yaml
name: standard-implement
agent: dev
overlays:
  hil:         { enabled: false }
  policy_gate: { risk_tier: T1 }
max_rework_iterations: 3
outputs:
  - path: ".ai-sdd/outputs/{{task_id}}-notes.md"
```

### Override examples

Override outputs only (e.g. api-first produces two files):
```yaml
  design-api:
    use: design-architecture
    description: "Produce OpenAPI spec and API design document."
    depends_on: [define-requirements]
    outputs:                             # overrides template's single output
      - path: .ai-sdd/outputs/openapi.yaml
      - path: .ai-sdd/outputs/api-design.md
```

Override overlays only (e.g. regulated workflow needs T2 on architecture):
```yaml
  design-l1:
    use: design-architecture
    description: "..."
    depends_on: [define-requirements]
    overlays:
      hil:         { enabled: true }
      policy_gate: { risk_tier: T2 }    # template provides agent+contract; workflow sets policy
```

---

## What `defaults:` Can and Cannot Set

| Field | In `defaults:`? | Notes |
|---|---|---|
| `overlays.*` | Yes | Per-overlay-key merge |
| `max_rework_iterations` | Yes | Scalar override |
| `exit_conditions` | Yes | Prepended to task's list |
| `agent` | **No** | Must come via `use:` or per-task inline |
| `description` | **No** | May come from template (`use:`) or per-task inline; validated post-merge |
| `depends_on` | **No** | No meaningful global default |
| `outputs` | **No** | Too context-specific |

---

## Acceptance Criteria

```gherkin
Feature: Engine built-in defaults

  Scenario: Task with no overlays gets engine defaults
    Given a workflow task with no overlays section
    When the workflow is loaded
    Then the task's resolved hil.enabled is true
    And policy_gate.risk_tier is T1
    And max_rework_iterations is 3

Feature: Workflow-level defaults

  Scenario: Workflow default overrides engine default
    Given a workflow with defaults: hil.enabled = false
    And a task with no overlays section
    When the workflow is loaded
    Then the task's resolved hil.enabled is false

  Scenario: Task-level override wins over workflow default
    Given a workflow with defaults: policy_gate.risk_tier = T1
    And a task with overlays.policy_gate.risk_tier = T2
    When the workflow is loaded
    Then the task's resolved risk_tier is T2

  Scenario: Overlay merge is per-key, not whole-object
    Given a workflow with defaults: hil.enabled = false
    And a task with overlays.policy_gate.risk_tier = T2
    When the workflow is loaded
    Then hil.enabled is false AND policy_gate.risk_tier is T2

Feature: Task library

  Scenario: use: resolves agent and overlays from template
    Given data/task-library/standard-review.yaml exists
    And a workflow task with use: standard-review and depends_on: [implement]
    When the workflow is loaded
    Then the task's agent is "reviewer"
    And overlays.review.enabled is true
    And overlays.hil.enabled is false

  Scenario: Task inline field overrides library field
    Given a workflow task with use: standard-review
    And the task specifies overlays.policy_gate.risk_tier = T2
    When the workflow is loaded
    Then policy_gate.risk_tier is T2 (not the library's T1)

  Scenario: {{task_id}} substitution
    Given a library template with output ".ai-sdd/outputs/{{task_id}}.md"
    And a workflow task named "verify-fix" with use: standard-review
    When the workflow is loaded
    Then the resolved output path is ".ai-sdd/outputs/verify-fix.md"

  Scenario: Missing template raises error
    Given a workflow task with use: nonexistent-template
    When the workflow is loaded
    Then a ValidationError is raised: "Task library template 'nonexistent-template' not found"

Feature: description satisfied by template

  Scenario: Task with use: and no inline description uses template description
    Given a workflow task with only use: standard-review and depends_on
    When the workflow is loaded
    Then the task's resolved description is the template default

  Scenario: Task with use: and inline description uses inline description
    Given a workflow task with use: standard-review and an explicit description
    When the workflow is loaded
    Then the task's resolved description is the inline description

  Scenario: Task with no use: and no description fails validation
    Given a workflow task with agent: dev but no description and no use:
    When the workflow is loaded
    Then a ValidationError is raised: "description is required"
```

---

## Deliverables

- `src/types/index.ts` — add `WorkflowDefaults`, add `defaults?` to `WorkflowConfig`,
  add `use?` to `TaskDefinition`; add `ENGINE_TASK_DEFAULTS` constant
- `src/core/workflow-loader.ts` — add `defaults` + `use` to schemas; add
  `resolveTask()` merge logic; add `loadLibraryTemplate()` (loads from
  `data/task-library/`); apply engine defaults in `loadYAML()`
- `data/task-library/standard-review.yaml`
- `data/task-library/standard-implement.yaml`
- All 6 example workflows refactored: must load without errors and produce identical
  resolved `WorkflowGraph` tasks
- `tests/workflow-loader.test.ts` — new cases for defaults, use:, engine defaults,
  override precedence, {{task_id}} substitution, error cases

---

## Non-Goals

- No Jinja2 or templating beyond `{{task_id}}` substitution
- No chained `use:` (a library template cannot itself `use:` another)
- No library versioning (co-located with framework, versioned via schema_version)
- No workflow `extends:` (workflows compose via include, not inheritance — future task)
