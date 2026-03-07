# MCS-005b: Toolgate Template + Requirements Lock Example + init.ts Update

**Phase:** 1.3
**Status:** READY
**Priority:** P0
**Dependencies:** MCS-005a
**Effort:** 0.5d
**Ticket:** MCS-005b

## Context

Two new template files must be added and copied by `ai-sdd init`. This is the only code change in Phase 1.

## Scope

1. Create `data/integration/toolgate.yaml` — evidence-gated tool configuration with budget placeholders.
2. Create `data/integration/requirements.lock.example.yaml` — annotated example lock file.
3. Update `src/cli/commands/init.ts` to copy both files non-destructively during `ai-sdd init`.

## Toolgate Template Content

```yaml
# Evidence-gated tool configuration — customize per project.
tool_gates:
  build: "bun run typecheck"
  test: "bun test"
  lint: "bun run typecheck"
  lock_exists: "test -f .ai-sdd/requirements.lock.yaml"
  reproducibility: "echo 'configure: scripts/reproducibility-check.sh'"

budgets:
  scope:
    max_new_files_per_task: 5
    max_new_public_apis_per_task: 2
    max_loc_delta_per_task: 500
  change:
    max_complexity_delta_per_function: 3
```

## Requirements Lock Example

Annotated YAML showing the structure of a requirements.lock.yaml: requirement IDs, descriptions, acceptance criteria, and spec_hash fields.

## init.ts Change

Non-destructive copy: skip if file already exists at destination. Add both files to the copy manifest for the `claude_code` tool.

## Acceptance Criteria

- scenario: "init copies new templates"
  given: "a fresh project directory"
  when: "ai-sdd init --tool claude_code runs"
  then:
    - "toolgate.yaml is present in project .ai-sdd/"
    - "requirements.lock.example.yaml is present in project .ai-sdd/"
    - "Existing files are not overwritten (non-destructive)"

## Tests Required

- Init test: `ai-sdd init` copies `toolgate.yaml` and `requirements.lock.example.yaml`
- Non-destructive: running init twice does not overwrite existing files

## Dependency Section

**Blocked by:** MCS-005a
**Blocks:** MCS-005c, Phase 2 (MCS-006)
