# T001: Agent System — YAML Schema, Loader, and Default Agents

**Phase:** 1 (Core Engine)
**Status:** PENDING
**Dependencies:** none

---

## Context

The agent system replaces hardcoded role definitions (sdd-ba, sdd-pe, etc.) with externalized YAML files. Any client can swap out a default agent or introduce a new one without touching framework code.

A custom agent can `extend` a base agent and override specific fields (overlay inheritance model). Schema validation runs on load — invalid YAML fails fast with a clear error message.

---

## Acceptance Criteria

```gherkin
Feature: Agent YAML loader

  Scenario: Load a default agent
    Given a valid agent YAML file at agents/defaults/ba.yaml
    When the agent loader initializes
    Then the BA agent is available with its role, LLM config, and commands

  Scenario: Custom agent extends a default agent
    Given a custom agent YAML with `extends: ba`
    And the custom agent overrides `llm.model` to a different value
    When the agent loader resolves the custom agent
    Then the custom agent inherits all fields from ba.yaml
    And the overridden `llm.model` takes precedence
    And all non-overridden fields retain their base values

  Scenario: Invalid agent YAML fails fast
    Given an agent YAML file missing the required `role.description` field
    When the agent loader initializes
    Then a schema validation error is raised with a clear message
    And the process exits before any task runs

  Scenario: Agent LLM config is per-agent
    Given agent ba.yaml uses model claude-sonnet-4-6
    And agent architect.yaml uses model claude-opus-4-6
    When both agents are loaded
    Then each agent dispatches to its own configured model

  Scenario: Custom agent falls back on validation failure
    Given a custom agent YAML that fails schema validation
    When the agent loader processes it
    Then a validation error is raised
    And if `use_defaults: true` is set, the default agent is used with a warning
```

---

## Inputs

- Agent YAML files (project `.ai-sdd/agents/` or framework `agents/defaults/`)
- Agent base schema (`agents/base_agent.yaml`)

## Outputs

- `AgentRegistry`: in-memory registry of loaded and resolved agents
- Resolved agent definitions (with inherited fields applied)

---

## Agent YAML Schema (Draft)

```yaml
name: ba                          # required; unique identifier
display_name: "Business Analyst"  # required; human-readable
version: "1"                      # required
extends: null                     # optional; inherits from named agent

llm:                              # required
  provider: anthropic             # required
  model: claude-sonnet-4-6        # required
  hyperparameters:
    temperature: 0.3
    max_tokens: 8000

role:
  description: |                  # required
    ...
  expertise:                      # optional list
    - requirements elicitation
  responsibilities:               # optional list
    - produce requirements.md

commands:                         # optional map of command_name → prompt file path
  define-requirements: "commands/ba/define-requirements.md"
```

---

## Default Agents to Implement

| Agent | Role |
|---|---|
| `ba` | Business Analyst — requirements elicitation, Gherkin AC |
| `architect` | System Architect — L1 architecture, high-level design |
| `pe` | Principal Engineer — L2 component design |
| `le` | Lead Engineer — L3 implementation task planning |
| `dev` | Developer — code generation, BDD task execution |
| `reviewer` | Reviewer — design and code review, GO/NO_GO decisions |

---

## Implementation Notes

- Use `pydantic` for agent model definition and validation.
- Inheritance resolution: walk the `extends` chain, apply field-level deep merge.
- Schema validation on load; `jsonschema` or pydantic validators.
- Default agent directory is embedded in the framework package.
- Project agents directory (`.ai-sdd/agents/`) takes precedence over defaults.

---

## Files to Create

- `core/agent_loader.py`
- `agents/base_agent.yaml`
- `agents/schema.yaml`
- `agents/defaults/ba.yaml`
- `agents/defaults/architect.yaml`
- `agents/defaults/pe.yaml`
- `agents/defaults/le.yaml`
- `agents/defaults/dev.yaml`
- `agents/defaults/reviewer.yaml`
- `tests/test_agent_loader.py`

---

## Test Strategy

- Unit tests: schema validation (valid + invalid YAML), inheritance merge precedence.
- Unit tests: per-field override (LLM model, temperature, role description).
- Integration test: load all default agents; verify registry completeness.

## Rollback/Fallback

- On custom agent validation failure, fall back to default agent with a warning (if `use_defaults: true`).
- Framework exits with error if a required default agent file is missing.
