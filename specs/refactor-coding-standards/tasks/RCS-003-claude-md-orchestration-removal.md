# RCS-003: Remove Orchestration from CLAUDE.md

**Phase:** 2
**Status:** PENDING
**Size:** S (1 day)
**Depends on:** RCS-001
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

The coding-standards `CLAUDE.md` contains orchestration directives that are now
ai-sdd's responsibility. Remove or reduce these sections and add a pointer to
ai-sdd for enforcement features.

## Sections to Remove or Reduce

| Section | Action | Reason |
|---------|--------|--------|
| Requirements-first protocol | **Remove** | ai-sdd enforces this via overlays |
| Phase routing instructions | **Remove** | ai-sdd's engine handles phase dispatch |
| Pre-flight checklists | **Remove** | ai-sdd's policy gate overlay handles pre-flight |
| State transition rules | **Remove** | ai-sdd's VALID_TRANSITIONS enforces this |
| Iteration limit instructions | **Remove** | ai-sdd's engine enforces max_rework_iterations |

## Sections to Keep

| Section | Reason |
|---------|--------|
| MCP server usage | Core coding-standards functionality |
| Analysis tool instructions | Core coding-standards functionality |
| Validation commands | Core coding-standards functionality |
| Schema references | Core coding-standards functionality |
| Query engine usage | Core coding-standards functionality |

## Addition

Add a new section at the top:

```markdown
## Orchestration & Enforcement

Task orchestration, state management, policy gates, and governance enforcement
are handled by [ai-sdd](https://github.com/<org>/ai-sdd). This project provides
read-only analysis tools (MCP server, query engine, validators, scripts).

See ai-sdd's `specs/merge-coding-standards/MERGE-PLAN-v2.md` for details on
what was merged and where to find it.
```

## Acceptance Criteria

```gherkin
Scenario: CLAUDE.md no longer contains orchestration directives
  Given the updated CLAUDE.md
  When searched for "requirements-first", "phase routing", "pre-flight"
  Then no matches are found

Scenario: CLAUDE.md points to ai-sdd for enforcement
  Given the updated CLAUDE.md
  Then it contains a section pointing to ai-sdd
  And mentions that enforcement is handled by ai-sdd

Scenario: CLAUDE.md retains analysis tool instructions
  Given the updated CLAUDE.md
  When searched for "MCP", "query", "validate"
  Then analysis-related instructions are present
```
