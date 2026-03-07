# RCS-008: Add ai-sdd Integration Section to MANUAL.md

**Phase:** 2
**Status:** PENDING
**Size:** S (1 day)
**Depends on:** RCS-001
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

Add a section in `MANUAL.md` explaining the ai-sdd integration pattern and how
the two projects complement each other.

## Content to Add

### Section: "Using with ai-sdd"

Cover three integration patterns:

1. **MCP server integration** — coding-standards MCP server is called by ai-sdd
   agents during workflow execution. Agents use tools like `graph_query`,
   `graph_validate`, and the new high-level tools (RCS-009) for gap analysis,
   validation, and coverage reports.

2. **CI pipeline integration** — coding-standards CLI and bash scripts are
   called by CI pipelines independently of ai-sdd. Use cases:
   - `reproducibility-check.sh` for multi-gate validation
   - `semantic-drift-check.sh` for spec drift detection
   - Query engine CLI for coverage reports

3. **Architecture split** — clear statement of responsibilities:
   - coding-standards: reads and reports (MCP server, validators, scripts)
   - ai-sdd: blocks and transitions (policy gates, state machine, overlays)
   - Neither project depends on the other at build time
   - Integration is at runtime via MCP or CLI calls

### Diagram

```
┌──────────────────┐     MCP tools      ┌──────────────────┐
│     ai-sdd       │ ──────────────────► │ coding-standards │
│  (enforcement)   │     CLI calls       │   (analysis)     │
│                  │ ──────────────────► │                  │
└──────────────────┘                     └──────────────────┘
       │                                        │
       ▼                                        ▼
  Blocks tasks,                          Reports gaps,
  transitions state,                     validates schemas,
  enforces policies                      detects drift
```

## Acceptance Criteria

```gherkin
Scenario: MANUAL.md explains MCP server integration
  Given the MANUAL.md file
  When the "Using with ai-sdd" section is read
  Then it explains how ai-sdd agents call the MCP server

Scenario: MANUAL.md explains CI integration
  Given the MANUAL.md file
  Then it explains how coding-standards scripts are used in CI pipelines

Scenario: MANUAL.md clarifies the architecture split
  Given the MANUAL.md file
  Then it clearly states which project does enforcement vs analysis
```
