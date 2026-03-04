# T021: Human Documentation — README and User Guide

**Phase:** 3 (Native Integration)
**Status:** PENDING
**Dependencies:** T010 (CLI and config), T018/T019/T020 (tool integrations)
**Size:** S (3 days)
**Source:** Retrofit (human onboarding and operator usability)

---

## Context

The framework has technical specs and integration tasks, but it lacks a single human-first entrypoint for setup, daily use, and troubleshooting. This task adds two canonical docs:

1. `README.md` at repo root (quickstart + architecture + commands)
2. `docs/USER_GUIDE.md` (end-to-end operator workflow for humans)

These docs must be aligned with current CLI contracts and task state semantics.

---

## Acceptance Criteria

```gherkin
Feature: Human documentation

  Scenario: README provides fast onboarding
    Given a new user opens the repository
    When they read README.md
    Then they can install dependencies, initialize a project, and run a workflow
    And they can find links to deeper docs and task specs

  Scenario: User guide covers the full operator loop
    Given an operator using ai-sdd in a real project
    When they follow docs/USER_GUIDE.md
    Then they can run/resume workflows, inspect status, handle HIL, and complete tasks safely
    And they can interpret task states (PENDING, RUNNING, NEEDS_REWORK, HIL_PENDING, COMPLETED, FAILED)

  Scenario: User guide covers all native integrations
    Given operators using Claude Code, Codex CLI, and Roo Code
    When they read docs/USER_GUIDE.md
    Then each integration has setup steps using `ai-sdd init --tool <name>`
    And each integration has a concrete daily usage loop
    And the guide includes dedicated sections: "Using Claude Code", "Using Codex CLI", and "Using Roo Code"
    And Roo Code guidance includes MCP server startup and mode usage

  Scenario: Documentation includes troubleshooting
    Given common failure modes (config error, schema mismatch, HIL blocked, contract failure)
    When the operator reads the troubleshooting section
    Then each mode includes diagnosis and concrete recovery commands

  Scenario: Documentation remains contract-aligned
    Given CONTRACTS.md and CLI command definitions
    When docs are updated
    Then all command examples and state names match the canonical contracts exactly
```

---

## Required Sections

### `README.md`

- What `ai-sdd` is and when to use it
- Quickstart (`init`, `run`, `status`, `hil`)
- High-level architecture and workflow phases
- Links to `specs/`, `CONTRACTS.md`, and `docs/USER_GUIDE.md`

### `docs/USER_GUIDE.md`

- Prerequisites and project layout
- Day-1 setup and first run
- Integration setup and usage:
  - Claude Code
  - Codex CLI
  - Roo Code (including MCP server flow)
- Dedicated operator sections:
  - `## Using Claude Code`
  - `## Using Codex CLI`
  - `## Using Roo Code`
- Daily operation loop (run, inspect, resolve HIL, rerun)
- Safe completion flow (`ai-sdd complete-task` + gap audit behavior)
- Troubleshooting and recovery cookbook

---

## Files to Create

- `README.md`
- `docs/USER_GUIDE.md`
- `tests/docs/test_docs_links.py` (light check for required anchors/links)

---

## Test Strategy

- Lint/structure check: required headers exist in both docs.
- Link check: internal links resolve (`README.md` ↔ `docs/USER_GUIDE.md` ↔ `specs/`).
- Contract sync check: state names and CLI command examples match `CONTRACTS.md`.
- Integration coverage check: user guide includes setup + usage sections for Claude Code, Codex, and Roo Code.

## Rollback/Fallback

- If full guide cannot be completed in one pass, ship minimal `README.md` quickstart first.
- Missing advanced sections must be tracked as follow-up tasks before release.
