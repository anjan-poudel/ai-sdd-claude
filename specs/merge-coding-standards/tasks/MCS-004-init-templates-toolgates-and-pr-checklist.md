# MCS-004: Init Templates for Toolgates and PR Checklist

**Phase:** A (Quality Gate Foundation)  
**Status:** DRAFT  
**Dependencies:** None  
**Size:** S (1-2 days)

## Context

Newly initialized projects should receive governance starter artifacts automatically.

## Scope

1. Add template assets:
   - `toolgate.yaml`
   - PR checklist markdown
2. Wire `ai-sdd init` to copy these artifacts into project output.
3. Keep templates editable by downstream projects.

## Acceptance Criteria

1. Running `ai-sdd init` creates governance template files in initialized project.
2. Re-running `init` does not destructively overwrite user-modified files.
3. Templates include example gate commands and budget placeholders.

## Deliverables

1. Template files under `data/integration/` (or equivalent init source path).
2. `src/cli/commands/init.ts` copy logic updates.
3. Tests for file creation and idempotent behavior.

