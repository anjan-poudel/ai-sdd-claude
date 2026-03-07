# RCS-002: Add ai-sdd Integration Section to README.md

**Phase:** 2
**Status:** PENDING
**Size:** XS (0.5 days)
**Depends on:** RCS-001
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

Add a new "Integration with ai-sdd" section to the coding-standards `README.md`
explaining the architecture split and how the two projects work together.

## Changes

Add a section after the existing intro that covers:

1. **Architecture split** — coding-standards provides read-only analysis tools;
   ai-sdd provides enforcement and orchestration
2. **How to use together** — coding-standards MCP server is called by ai-sdd
   agents during workflow execution for gap analysis, validation, and coverage
   reports
3. **What moved to ai-sdd** — brief list of features that were merged:
   - State machine and event routing
   - Phase-based dispatch orchestration
   - Iteration limit enforcement
   - Policy gates and evidence gates
4. **Where to find migrated features** — pointer to ai-sdd's
   `specs/merge-coding-standards/MERGE-PLAN-v2.md`

## Acceptance Criteria

```gherkin
Scenario: README explains the architecture split
  Given the coding-standards README.md
  When a new user reads it
  Then they understand coding-standards is for analysis (not enforcement)
  And they know to use ai-sdd for task orchestration

Scenario: README lists what moved
  Given the README.md integration section
  Then it mentions state machine, event routing, phase dispatch, iteration limits
  And each has a pointer to the ai-sdd equivalent
```

## Notes

- Do not remove existing README content — this is additive
- Keep the section concise (aim for ~30 lines of markdown)
- Include the architecture split diagram from REFACTOR-PLAN.md if space permits
