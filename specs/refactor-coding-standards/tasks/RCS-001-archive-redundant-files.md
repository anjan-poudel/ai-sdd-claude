# RCS-001: Archive Redundant Files

**Phase:** 1
**Status:** PENDING
**Size:** XS (0.5 days)
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

Move files whose enforcement/orchestration functionality has been merged into ai-sdd
to `archive/merged-to-ai-sdd/`. Preserve them as reference — do not delete.

## Files to Archive

| Source | Destination | ai-sdd Equivalent |
|--------|-------------|-------------------|
| `workflow/state-machine.yaml` | `archive/merged-to-ai-sdd/state-machine.yaml` | `src/types/index.ts` (VALID_TRANSITIONS) + `src/core/state-manager.ts` |
| `workflow/events-contract.md` | `archive/merged-to-ai-sdd/events-contract.md` | `src/observability/emitter.ts` + events schema |
| `scripts/run-phase.sh` | `archive/merged-to-ai-sdd/run-phase.sh` | `src/adapters/` + `src/core/engine.ts` |
| `scripts/check-iteration-limits.sh` | `archive/merged-to-ai-sdd/check-iteration-limits.sh` | `max_rework_iterations` in engine defaults |
| `docs/COMBINED-AGENTIC-LOOP.md` | `archive/merged-to-ai-sdd/COMBINED-AGENTIC-LOOP.md` | `src/core/engine.ts` orchestration |
| `docs/AGENT-LOOP-PATTERN.md` | `archive/merged-to-ai-sdd/AGENT-LOOP-PATTERN.md` | `src/core/engine.ts` + overlay chain |

## Steps

1. Create `archive/merged-to-ai-sdd/` directory
2. `git mv` each file to archive location
3. Prepend each file with archive header:
   ```markdown
   > **Archived:** This feature was merged into ai-sdd as part of the
   > coding-standards → ai-sdd integration (2026-03). See ai-sdd's
   > `specs/merge-coding-standards/MERGE-PLAN-v2.md` for details.
   ```
4. Create `archive/merged-to-ai-sdd/README.md` listing all archived files and
   their ai-sdd equivalents

## Acceptance Criteria

- All 6 files moved to `archive/merged-to-ai-sdd/`
- Each has an archive header with ai-sdd cross-reference
- `archive/merged-to-ai-sdd/README.md` exists with mapping table
- No dangling imports or references in remaining code (grep check)
- `git status` shows renames, not deletions
