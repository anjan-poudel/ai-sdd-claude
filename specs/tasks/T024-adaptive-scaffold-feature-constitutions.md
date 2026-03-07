# T024: Adaptive Scaffold + Feature Constitutions

**Phase:** 3 (Native Integration)
**Status:** IMPLEMENTED
**Dependencies:** T023 (project scaffolding), T003 (constitution system)
**Size:** S (3 days)
**Deliverable:** P3-D8

---

## Problem

The `/sdd-scaffold` skill asked 7 static questions regardless of whether it was a new
project or adding a feature to an existing one. Greenfield projects need different
information than brownfield features. Additionally, there was no concept of feature-level
constitutions: scaffolding a feature in an existing project either overwrote the root
constitution.md or required manual workarounds.

---

## Solution

Two independent tracks:

### Track A: Adaptive Skill Prompts (markdown only)

Rewrote `SKILL.md` and `sdd-scaffold.md` agent with:

1. **Context probe** — silent bash commands detect greenfield vs brownfield before
   asking any questions
2. **Q1 combined opener** — "What are you building — new project, feature, or quick fix?"
   finalizes mode with probe results
3. **Three branching question paths:**
   - Greenfield: 8 questions (Q1-Q8, added Q8: user + success criteria)
   - Brownfield-feature: 6 questions (scoped to feature delta)
   - Brownfield-quickfix: 4 questions (minimal for bug fixes)
4. **Mode-scaled Phase 2 limits:** 5/3/2 max clarifying questions

### Track B: TypeScript Changes (~15 lines + 3 tests)

1. **`src/constitution/resolver.ts`** — Added `specs/*/constitution.md` scan in
   `findConstitutionFiles()` between the candidates loop and submodule scan.
   Alphabetical sort by directory name for deterministic merge order.

2. **`src/cli/commands/init.ts`** — No changes needed (`.ai-sdd/` stays framework-only;
   feature constitutions go in `specs/` which is user-managed).

3. **`tests/constitution.test.ts`** — 3 new tests:
   - Feature constitutions included from `specs/*/constitution.md`
   - Alphabetical merge order by directory name
   - Empty `specs/` directory doesn't break resolve

---

## Key Design Decision: `specs/` not `.ai-sdd/`

Feature constitutions live in `specs/<feature-slug>/constitution.md`, NOT inside
`.ai-sdd/constitutions/`. Rationale:

- `.ai-sdd/` is reserved for framework runtime files and must remain static across
  all projects
- Feature-specific artifacts (constitutions, init reports, design docs) are project
  content, not framework config
- `specs/` is the natural home for specification and planning documents
- Only workflow YAMLs go in `.ai-sdd/workflows/` because the engine looks there

---

## Constitution Resolution Order (updated)

Lowest to highest precedence:
1. `constitution.md` (project root)
2. `.ai-sdd/constitution.md` (engine manifest)
3. `CLAUDE.md` (Claude Code convention)
4. `specs/*/constitution.md` (feature constitutions, alphabetical by directory)
5. `<submodule>/constitution.md` (submodule constitutions, one level deep)

Feature constitutions are additive — they extend the project constitution with
feature-scoped constraints, they don't override it.

---

## Files Modified

| File | Change |
|------|--------|
| `data/integration/claude-code/skills/sdd-scaffold/SKILL.md` | Full rewrite: context probe + 3 branching question paths |
| `data/integration/claude-code/agents/sdd-scaffold.md` | Full rewrite: greenfield / brownfield-feature / brownfield-quickfix modes |
| `src/constitution/resolver.ts` | Added `specs/*/constitution.md` scan in `findConstitutionFiles()` |
| `tests/constitution.test.ts` | 3 new test cases for feature constitution merging |
| `specs/tasks/T003-constitution-system.md` | Updated resolution order + 3 new acceptance scenarios |
| `specs/tasks/T023-project-scaffolding.md` | Major update: modes, question paths, brownfield artifacts, acceptance criteria |
| `specs/PLAN.md` | Updated config hierarchy diagram + added P3-D8 |
| `specs/CONTRACTS.md` | Added constitution resolution order to config namespace |

---

## Acceptance Criteria

```gherkin
Feature: Adaptive scaffold mode detection

  Scenario: Greenfield detected and 8 questions asked
    Given a project with no constitution.md, no source dirs, no git history
    When /sdd-scaffold runs
    Then mode is greenfield
    And 8 questions are asked (Q1-Q8)
    And root constitution.md is generated

  Scenario: Brownfield-feature detected and 6 questions asked
    Given a project with constitution.md, source dirs, and git history
    When /sdd-scaffold runs and developer says "new feature"
    Then mode is brownfield-feature
    And 6 questions are asked (Q1-Q6)
    And specs/<feature>/constitution.md is generated
    And root constitution.md is NOT modified

  Scenario: Brownfield-quickfix detected and 4 questions asked
    Given a project with constitution.md and developer says "quick fix"
    When /sdd-scaffold runs
    Then mode is brownfield-quickfix
    And 4 questions are asked (Q1-Q4)
    And no feature constitution is generated

Feature: Feature constitution resolution

  Scenario: Feature constitutions included in resolve
    Given specs/auth/constitution.md exists
    When the constitution resolver runs
    Then the feature constitution is included in merged output
    And it appears after root constitution, before submodules

  Scenario: Alphabetical merge order
    Given specs/a-auth/ and specs/b-payments/ both have constitution.md
    When the resolver runs
    Then a-auth content appears before b-payments content

  Scenario: Empty specs dir is safe
    Given specs/ exists but contains no feature directories
    When the resolver runs
    Then resolution succeeds with only the root constitution
```

---

## What This Does NOT Do

- No `--feature` CLI flag (future optimization)
- No feature-scoped `resolveForTask()` filtering (future)
- No WorkflowConfig `feature:` schema field (file naming convention suffices)
- No dynamic questionnaire engine in TypeScript (branching prompt is sufficient)
- No feature constitution conflict detection (agent reads root and avoids contradictions)

---

## Test Strategy

- Unit: `tests/constitution.test.ts` — 3 new tests (feature inclusion, order, empty dir)
- All 251 existing tests pass (no regressions)
- Manual: `/sdd-scaffold` in greenfield repo → greenfield path
- Manual: `/sdd-scaffold` in brownfield repo → brownfield-feature path
