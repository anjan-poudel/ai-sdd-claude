# MCS-003: GitHub Actions Template with Init Prerequisite Guard

**Phase:** 4.2
**Status:** READY
**Priority:** P1
**Dependencies:** MCS-002
**Effort:** 0.5d
**Ticket:** MCS-003

## Context

A GitHub Actions workflow template that `ai-sdd init` copies into `.github/workflows/`. Includes an explicit init prerequisite guard that fails with a human-readable error if `ai-sdd init` was not run.

## Scope

Create `data/integration/.github/workflows/ai-sdd-gates.yml`.

## Content

```yaml
name: ai-sdd Gates
on:
  pull_request:
    branches: [main, master]
jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - name: Check ai-sdd init was run
        run: |
          test -f .ai-sdd/scripts/reproducibility-check.sh || \
            (echo "ERROR: Run 'ai-sdd init' first." && exit 1)
      - run: bun run typecheck
      - run: bun test
      - run: .ai-sdd/scripts/reproducibility-check.sh
      - run: BASE_REF=origin/main .ai-sdd/scripts/semantic-drift-check.sh
```

## init.ts Update

Add `.github/workflows/ai-sdd-gates.yml` to the copy manifest (non-destructive: skip if already exists).

## Acceptance Criteria

- scenario: "CI template copied by init"
  given: "ai-sdd init --tool claude_code run"
  when: "task completes"
  then:
    - ".github/workflows/ai-sdd-gates.yml exists in project"

- scenario: "Init guard fails with readable error"
  given: "CI running on project where ai-sdd init was not run"
  when: "Check ai-sdd init was run step executes"
  then:
    - "Exit code 1"
    - "Message: 'ERROR: Run ai-sdd init first.'"

## Tests Required

- Init test: `ai-sdd init` copies `.github/workflows/ai-sdd-gates.yml`
- Template syntax: valid YAML (can be validated with js-yaml)

## Dependency Section

**Blocked by:** MCS-002
**Blocks:** None
