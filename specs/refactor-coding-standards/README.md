# Refactor: coding-standards Post-Merge Cleanup

## Purpose

This folder contains the plan and task specs for refactoring the
[coding-standards](../../) repository **after** its enforcement features were
merged into ai-sdd.

The merge was a two-directional operation:

1. **coding-standards → ai-sdd** (DONE): Governance enforcement, gates, spec
   hash tracking, CANCELLED state, traceability CLI, and agent constitution
   were merged as native ai-sdd features. See
   `specs/merge-coding-standards/MERGE-PLAN-v2.md` for the 18 MCS tasks.

2. **Refactor coding-standards to remove merged features** (THIS FOLDER):
   Now that ai-sdd handles enforcement natively, coding-standards must be
   pruned to its core purpose — **read-only analysis and query tools** — to
   eliminate duplication and confusion about which project owns what.

## Architecture Split Principle

```
┌─────────────────────────────────────────────────────────┐
│  ai-sdd (enforcement + orchestration)                    │
│                                                         │
│  If it BLOCKS a task or TRANSITIONS state → lives here  │
│  - Policy gates, evidence gates, HIL                    │
│  - Task state machine (VALID_TRANSITIONS)               │
│  - Governance config (warn / enforce modes)             │
│  - Spec hash tracking + acknowledge flag                │
│  - Scope drift gate, budget gate                        │
│  - AC coverage gate in complete-task                    │
│  - Agent constitution, GO protocol                      │
│  - PlanningReviewOverlay                                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  coding-standards (read-only analysis + queries)         │
│                                                         │
│  If it READS and REPORTS without blocking → lives here  │
│  - MCP server (graph_init, graph_query, graph_validate) │
│  - QueryEngine (gaps, orphans, impact, coverage)        │
│  - ValidationEngine (9 lint rules, informational)       │
│  - Bash scripts (drift detection, spec hashing)         │
│  - Schemas (requirements-input, requirements-lock)      │
│  - Documentation (MANUAL, ARCHITECTURE, examples)       │
└─────────────────────────────────────────────────────────┘
```

## What This Refactor Does

- Identifies features in coding-standards that are now redundant with ai-sdd
- Creates task specs for removing, archiving, or adapting each one
- Updates coding-standards documentation to reference ai-sdd for enforcement
- Ensures the MCP server, query-engine, and validators remain functional
- Adds clear "this is now handled by ai-sdd" pointers where features were removed

## What This Refactor Does NOT Do

- Does not change ai-sdd code (that was the merge direction)
- Does not remove the MCP server, query-engine, or validators
- Does not remove documentation or schemas
- Does not break coding-standards' independent usability for non-ai-sdd projects

## Files

| File | Purpose |
|------|---------|
| `README.md` | This file |
| `REFACTOR-PLAN.md` | Full refactor plan with phases and task list |
| `tasks/RCS-*.md` | Individual task specs (one per refactor task) |

## Related

- `specs/merge-coding-standards/MERGE-PLAN-v2.md` — The merge plan (direction 1)
- `specs/merge-coding-standards/tasks/MCS-*.md` — Merge task specs
- coding-standards repo: `/Users/anjan/workspace/projects/coding-standards`
