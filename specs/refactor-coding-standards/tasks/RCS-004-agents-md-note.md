# RCS-004: Add ai-sdd Note to AGENTS.md

**Phase:** 2
**Status:** PENDING
**Size:** XS (0.5 days)
**Depends on:** RCS-001
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

Add a brief note at the top of `AGENTS.md` clarifying that task orchestration
is now handled by ai-sdd and this project provides read-only analysis tools.

## Change

Prepend (immediately after the H1 heading):

```markdown
> **Note:** Task orchestration, state management, and governance enforcement
> are now handled by [ai-sdd](https://github.com/<org>/ai-sdd). The agent
> configurations in this project are reference definitions for read-only
> analysis workflows. For task execution and enforcement, see ai-sdd's
> agent system (`data/agents/defaults/`).
```

## Acceptance Criteria

```gherkin
Scenario: AGENTS.md has ai-sdd note
  Given the AGENTS.md file
  When opened
  Then the first block after the title is a note about ai-sdd
  And it mentions "read-only analysis" as this project's scope
```

## Notes

- Do not modify any other content in AGENTS.md
- Single blockquote addition — minimal change
