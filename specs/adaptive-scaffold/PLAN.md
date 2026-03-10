# Plan: Adaptive sdd-scaffold + Feature Constitutions

## Context

The `/sdd-scaffold` skill asks 7 static questions regardless of whether it's a new project or adding a feature to an existing one. This is brittle — greenfield projects need different information than brownfield features. Additionally, there's no concept of feature-level constitutions: scaffolding a feature in an existing project either overwrites the root constitution.md or requires manual workarounds.

**Goal**: Make scaffold context-aware (greenfield vs brownfield) with tailored questions, and support feature-level constitutions that are additive to the project's root constitution.md.

## Approach: Branching Prompts + Feature Constitution Directory

**No dynamic questionnaire engine.** The skill and agent are markdown prompt files — "adaptive" means structured branching in the SKILL.md instructions. TypeScript changes are minimal (~20 lines + tests).

### Two independent tracks:

| Track | What | Files | Risk |
|-------|------|-------|------|
| A (prompt) | Rewrite SKILL.md + agent .md with context probe and branching paths | 2 .md files | Zero regression (markdown only) |
| B (code) | Feature constitution directory support in resolver + init | 3 .ts files | Low (additive, existing tests verify no regression) |

---

## Track A: Adaptive Skill (SKILL.md + Agent)

### Step 0: Context Probe (new, before any questions)

Run silent Bash probe commands:
```bash
test -f constitution.md && grep -c '^\S' constitution.md  # real content?
ls src/ lib/ app/ 2>/dev/null | head -3                   # source dirs?
git log --oneline -3 2>/dev/null                           # git history?
ls .ai-sdd/constitutions/*.md 2>/dev/null                  # existing features?
```

Determine mode: **greenfield** | **brownfield-feature** | **brownfield-quickfix**

### Q1 (all modes): Combined opener

> "What are you building — and is this a new project or a new feature in an existing one?"

Combines old Q1 with greenfield/brownfield detection. Probe results + Q1 answer finalize the mode. If conflict (probe says brownfield, user says greenfield), ask one disambiguation question.

Announce mode: *"I see this is [a new project / a new feature / a quick fix]. Tailoring questions accordingly."*

### Greenfield path (8 questions)

| # | Question | Notes |
|---|----------|-------|
| Q1 | What are you building — new project or feature? | Modified Q1 |
| Q2 | Target platform(s)? | Same |
| Q3 | Tech stack preferences? | Same |
| Q4 | Safety-critical features? | Same |
| Q5 | Privacy/compliance requirements? | Same |
| Q6 | Expected scale? | Same |
| Q7 | Fixed constraints? | Same |
| Q8 | **Who is the primary user and what does success look like?** | **New** — front-loads info that Phase 2 usually chases |

### Brownfield-feature path (6 questions)

| # | Question | Rationale |
|---|----------|-----------|
| Q1 | What are you building — new project or feature? | Same opener |
| Q2 | Feature name and scope? (what it does, what it does NOT do) | Platform/scale known from root constitution |
| Q3 | New safety/compliance concerns beyond project's current ones? | Delta only — collapsed Q4+Q5 |
| Q4 | What existing code/modules does this feature touch? | Replaces Q3 (stack known) — need integration surface |
| Q5 | Feature-specific constraints? | Scoped version of Q7 |
| Q6 | Primary user of this feature + success criteria? | Same as greenfield Q8 |

### Brownfield-quickfix path (4 questions)

| # | Question |
|---|----------|
| Q1 | What are you building — new project or feature? |
| Q2 | What is the bug/issue? (symptoms, location) |
| Q3 | Safety/compliance implications? |
| Q4 | Constraints? (timeframe, things not to break) |

### Agent mode branching

The agent receives `mode` in its brief and branches:

- **greenfield**: Same as today (constitution.md, ai-sdd.yaml, workflow, init-report). Q8 feeds Target Users + Success Criteria sections.
- **brownfield-feature**: Does NOT overwrite constitution.md or ai-sdd.yaml. Generates `.ai-sdd/constitutions/<feature-slug>.md` + `.ai-sdd/workflows/<feature-slug>.yaml` + `docs/<feature-slug>-init-report.md`
- **brownfield-quickfix**: No feature constitution. Generates `.ai-sdd/workflows/quickfix-<slug>.yaml` + `docs/quickfix-<slug>-report.md`

### Feature constitution template

```markdown
# Feature Constitution: <feature-name>

## Feature Scope
[What it does and does NOT do — from Q2]

## Affected Modules
[Existing code touched — from Q4]

## Additional Constraints
[Feature-specific — from Q5]

## Safety & Compliance Delta
[New concerns — from Q3]

## Success Criteria
[User-facing — from Q6]

## Open Decisions
[Assumptions documented here]
```

---

## Track B: TypeScript Changes

### 1. `src/constitution/resolver.ts` (~12 lines)

In `findConstitutionFiles()`, after the existing candidates loop (line ~48) and before the submodule scan (line ~53), add:

```typescript
// Feature constitutions
const constitutionsDir = join(projectPath, ".ai-sdd", "constitutions");
try {
  if (existsSync(constitutionsDir)) {
    const entries = readdirSync(constitutionsDir)
      .filter(f => f.endsWith(".md"))
      .sort(); // deterministic alphabetical merge order
    for (const entry of entries) {
      files.push(join(constitutionsDir, entry));
    }
  }
} catch { /* directory unreadable — skip */ }
```

Merge precedence (lowest to highest):
1. `constitution.md` (root)
2. `.ai-sdd/constitution.md` (engine manifest)
3. `CLAUDE.md`
4. **`.ai-sdd/constitutions/*.md` (feature constitutions, alphabetical)**
5. `submodule/*/constitution.md`

Existing `mergeConstitutions()` already concatenates with `<!-- source: path -->` headers — exactly right for additive feature constitutions. No other resolver changes needed.

### 2. `src/cli/commands/init.ts` (1 line + 1 file)

Add `"constitutions"` to the directory creation list at line 29:

```typescript
for (const dir of ["state", "state/hil", "outputs", "agents", "constitutions"]) {
```

Write a minimal README to satisfy the "no empty directories" invariant:

```typescript
const readmePath = join(aiSddDir, "constitutions", "README.md");
if (!existsSync(readmePath)) {
  writeFileSync(readmePath, "# Feature Constitutions\n\nGenerated by `/sdd-scaffold` for brownfield features.\n", "utf-8");
}
```

### 3. `tests/constitution.test.ts` (3 new tests)

```
"includes feature constitutions from .ai-sdd/constitutions/"
"feature constitutions are merged in alphabetical order"
"empty constitutions dir does not break resolve"
```

---

## Files to Modify

| File | Change |
|------|--------|
| `data/integration/claude-code/skills/sdd-scaffold/SKILL.md` | Full rewrite: context probe + 3 branching question paths |
| `data/integration/claude-code/agents/sdd-scaffold.md` | Add mode branching: greenfield / brownfield-feature / brownfield-quickfix |
| `src/constitution/resolver.ts` | Add `.ai-sdd/constitutions/` scan in `findConstitutionFiles()` |
| `src/cli/commands/init.ts` | Add `constitutions` dir creation + README |
| `tests/constitution.test.ts` | 3 new test cases for feature constitution merging |

## What This Does NOT Do

- No `--feature` CLI flag (Phase 2 optimization)
- No feature-scoped `resolveForTask()` filtering (Phase 2)
- No WorkflowConfig `feature:` schema field (file naming convention suffices)
- No dynamic questionnaire engine in TypeScript (branching prompt is enough)
- No feature constitution conflict detection (agent reads root and avoids contradictions)

## Verification

1. `bun test` — all existing 177 tests pass + 3 new tests pass
2. `bun run typecheck` — no TypeScript errors
3. Manual: run `/sdd-scaffold` in a greenfield repo → should detect greenfield, ask 8 questions, generate root constitution.md
4. Manual: run `/sdd-scaffold` in this repo (brownfield) → should detect brownfield, ask 6 feature questions, generate `.ai-sdd/constitutions/<feature>.md` without touching root constitution.md
