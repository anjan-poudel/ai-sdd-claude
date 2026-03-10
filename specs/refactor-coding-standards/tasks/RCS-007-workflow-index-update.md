# RCS-007: Update workflow/index.md After Archival

**Phase:** 2
**Status:** PENDING
**Size:** XS (0.5 days)
**Depends on:** RCS-001
**Target repo:** /Users/anjan/workspace/projects/coding-standards

---

## What

After RCS-001 archives `workflow/state-machine.yaml` and
`workflow/events-contract.md`, update `workflow/index.md` to remove references
to these files and add pointers to their new locations.

## Changes

1. Remove or update any links to `state-machine.yaml` and `events-contract.md`
2. Add a note explaining these were archived:
   ```markdown
   ### Archived Files

   The following files were moved to `archive/merged-to-ai-sdd/` as their
   functionality is now part of ai-sdd:

   - `state-machine.yaml` → ai-sdd `src/types/index.ts` (VALID_TRANSITIONS) +
     `src/core/state-manager.ts`
   - `events-contract.md` → ai-sdd `src/observability/emitter.ts`

   See `archive/merged-to-ai-sdd/README.md` for the full mapping.
   ```
3. Update any remaining links to ensure they point to valid files

## Acceptance Criteria

```gherkin
Scenario: workflow/index.md has no broken links
  Given workflow/index.md after RCS-001 archival
  When all links in the file are checked
  Then none point to files that no longer exist in workflow/

Scenario: workflow/index.md explains archived files
  Given workflow/index.md
  When read
  Then it has an "Archived Files" section
  And it explains where state-machine.yaml and events-contract.md went
```
