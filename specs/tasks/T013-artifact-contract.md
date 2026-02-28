# T013: Artifact Contract and Task I/O Schema

**Phase:** 1 (Core Engine)
**Status:** PENDING
**Dependencies:** T002 (workflow system)
**Size:** S (4 days)
**Source:** Synthesized-Codex (GAP-L2-002)

---

## Context

Tasks currently declare `outputs: ["requirements.md"]` as raw file paths. Downstream tasks consume these outputs without any type or schema check. A malformed or missing output silently breaks all downstream consumers with cryptic errors.

Artifact contracts introduce versioned, typed output declarations so incompatibilities are caught **at load time** before any LLM call is made.

---

## Acceptance Criteria

```gherkin
Feature: Artifact contract validation

  Scenario: Compatible producer/consumer passes
    Given task A declares output: "requirements.md" with contract "requirements_doc@1"
    And task B declares input: "requirements.md" with contract "requirements_doc@1"
    When the workflow loads
    Then validation passes with no errors

  Scenario: Incompatible contracts fail at load time
    Given task A declares output contract "requirements_doc@1"
    And task B declares input contract "requirements_doc@2"
    When the workflow loads
    Then a validation error is raised: "artifact contract mismatch: requirements.md (producer: v1, consumer: v2)"
    And no tasks execute

  Scenario: Missing output at runtime fails with clear message
    Given task A is configured to produce "requirements.md" with contract "requirements_doc@1"
    When task A completes without writing "requirements.md"
    Then a post-task validation error is raised
    And the task is marked FAILED with reason "missing declared output: requirements.md"
    And downstream tasks are not executed

  Scenario: Artifact present but missing required section
    Given contract "requirements_doc@1" requires section "acceptance_criteria"
    When task A produces "requirements.md" without an "acceptance_criteria" section
    Then a post-task validation error is raised: "artifact requirements.md missing required section: acceptance_criteria"
    And gap_audit blocks COMPLETED status for the task

  Scenario: Unknown contract type used
    Given a task declaring output contract "unknown_type@1"
    When the workflow loads
    Then a validation error is raised: "unknown artifact type: unknown_type"

  Scenario: Inline contract — no registry entry required
    Given a task with an inline output contract
    When the workflow loads
    Then the inline schema is used for validation directly
    And no lookup against the artifact schema registry occurs
    And no deprecation warning is emitted

  Scenario: No contract declared (backward compat)
    Given a task with outputs declared as bare file paths (no contract)
    When the workflow loads
    Then no contract validation occurs
    And a deprecation warning is emitted
```

---

## Artifact Schema Registry

```yaml
# artifacts/schema.yaml
version: "1"

artifact_types:
  requirements_doc:
    version: "1"
    description: "Formal requirements document produced by BA agent"
    file_format: markdown
    required_sections:
      - functional_requirements
      - non_functional_requirements
      - acceptance_criteria

  design_l1:
    version: "1"
    description: "L1 architecture document produced by Architect agent"
    file_format: markdown
    required_sections:
      - architecture_overview
      - component_map
      - api_contracts
      - data_models

  design_l2:
    version: "1"
    file_format: markdown
    required_sections:
      - component_specifications
      - interface_contracts

  review_log:
    version: "1"
    file_format: json
    required_fields:
      - decision
      - feedback
      - iteration
      - timestamp

  implementation_tasks:
    version: "1"
    file_format: markdown
    required_sections:
      - task_list
      - acceptance_criteria
```

---

## Contract Declaration Options

Three levels, chosen based on project maturity:

```yaml
# Level 1: Bare path — no validation (backward compat, deprecation warning)
outputs:
  - path: requirements.md

# Level 2: Inline contract — no registry required (recommended for new/small projects)
outputs:
  - path: requirements.md
    contract:
      required_sections: [functional_requirements, acceptance_criteria]
      file_format: markdown

# Level 3: Registry reference — shared across teams, versioned (recommended for teams)
outputs:
  - path: requirements.md
    contract: requirements_doc@1
```

Inline contracts are anonymous and local to the workflow — they are not shared or versioned.
Use registry references (`type@version`) when the same contract is used across multiple
workflows or teams, or when schema evolution needs to be tracked.

## Workflow YAML with Contracts

```yaml
tasks:
  define-requirements:
    agent: ba
    inputs: []
    outputs:
      - path: requirements.md
        contract: requirements_doc@1      # registry reference

  design-l1:
    agent: architect
    inputs:
      - path: requirements.md
        contract: requirements_doc@1    # compatibility checked at load time
    outputs:
      - path: design/l1.md
        contract: design_l1@1

  review-l1:
    agent: reviewer
    inputs:
      - path: design/l1.md
        contract: design_l1@1
    outputs:
      - path: review/l1.json
        contract: review_log@1
```

---

## Validation Logic

**At load time** (workflow_loader.py):
1. For each task input with a contract, find the upstream task that produces the same path.
2. Check producer's declared contract version matches consumer's expected version.
3. Check artifact type exists in the registry.
4. Raise load-time validation error for any mismatch.

**At runtime** (post-task hook):
1. After task completes, check all declared outputs exist.
2. For markdown artifacts: check required sections are present (h2 headings).
3. For JSON artifacts: check required fields are present.
4. This validation runs inside `gap_audit` before completion commit.
5. On failure: mark task FAILED (hard) or NEEDS_REWORK (remediable) with specific reason.

---

## Version Compatibility

Semantic versioning for contracts:
- Major version change → incompatible (must explicitly declare).
- Minor version change → forward-compatible (consumer @1 can accept producer @1.1).

```python
def is_compatible(producer: str, consumer: str) -> bool:
    """True if producer version satisfies consumer requirement."""
    # "requirements_doc@1" == "requirements_doc@1.x" (minor compat)
    # "requirements_doc@2" != "requirements_doc@1" (major mismatch)
```

---

## Implementation Notes

- `artifacts/schema.yaml` is the single artifact type registry.
- Validation runs in `workflow_loader.py` at parse time (load-time) and in a post-task hook (runtime).
- Backward compatibility: bare file path outputs (no contract) are allowed but emit a deprecation warning.
- Compatibility errors include the artifact path, producer task, consumer task, and version mismatch details.

---

## Files to Create

- `artifacts/schema.yaml`
- `artifacts/validator.py`
- `artifacts/compatibility.py`
- `tests/test_artifact_validator.py`
- `tests/test_artifact_compatibility.py`

---

## Test Strategy

- Unit tests: compatible versions pass; major version mismatch fails.
- Unit tests: missing output at runtime → FAILED with clear reason.
- Unit tests: required section missing → FAILED with section name.
- Unit tests: unknown contract type → load error.
- Integration test: workflow with full contract declarations validates and runs end-to-end.

## Rollback/Fallback

- Contract validation failure at load time: emit error, do not execute.
- Runtime output validation failure: mark NEEDS_REWORK, persist state, do not advance.
- If artifact schema registry is missing **and any task declares a contract**: hard startup
  error — "artifact schema registry not found but contracts are declared. Cannot validate."
- If artifact schema registry is missing **and no tasks declare contracts**: warn once at
  startup and continue (pure backward-compat mode for untyped legacy workflows).
- To explicitly allow mixed typed/untyped: pass `--allow-legacy-untyped-artifacts` flag.
  This must never be the silent default for new projects.
