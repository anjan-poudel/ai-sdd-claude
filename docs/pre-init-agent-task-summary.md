T023 spec created at specs/tasks/T023-project-scaffolding.md. Here's the architecture it defines:

---

## Three parts, one flow

```
/sdd-scaffold skill → sdd-scaffold subagent → 4 artifacts
```

---

## `/sdd-scaffold` skill — two-phase conversation

### Phase 1 — Structured intake (Q1–Q7)

Asks 7 questions in sequence. Each includes `(type ? for help)`.
Type `?`, `help`, or `?help` to see a detailed explanation with examples — the skill
re-asks the question before moving on.

1. **What are you building?**
2. **Target platform(s)?** — mobile iOS · Android · web · backend API · desktop · embedded
3. **Tech stack preferences?** — or "none, let the architect decide"
4. **Safety-critical features?** — health, emergency, financial, vulnerable users — yes/no + description
5. **Privacy or compliance requirements?** — GDPR · HIPAA · SOC2 · PCI-DSS · none/unknown
6. **Expected scale?** — quickfix · feature · greenfield product · regulated enterprise
7. **Fixed constraints?** — existing systems, technology mandates, performance SLAs, budget,
   deployment restrictions, team size, data residency. Answer "none" if there are none.

### Phase 2 — Targeted clarification

After all 7 answers are collected, the skill reviews them and asks targeted follow-up
questions where answers are unclear, too vague, or conflict with each other.

**At the start of Phase 2 the skill says:**
> "Thanks — just a few follow-up questions to fill in any gaps.
> Type `→` or `skip` at any time to stop and proceed with what we have."

**Skip triggers** (recognised at any point in Phase 2):
`→` · `skip` · `proceed` · `go ahead` · `enough` · `continue` · `s`

When a skip is requested, the skill **asks for confirmation** before stopping:
> "Proceed with what we have? I'll fill any remaining gaps with defaults and document
> assumptions in Open Decisions. [yes / no, keep going]"

- **yes** (`y`, `yes`, `ok`, `sure`, `confirm`) → stop Phase 2, spawn subagent
- **no** (`n`, `no`, `keep going`) → resume from the next unanswered question

When confirmed (or when Phase 2 is complete), the skill spawns `sdd-scaffold` subagent.

**Clarifying questions are asked only for:**
- Answers too vague to generate a useful artifact (e.g. Q1 = "a mobile app" — asks: "What does it do and for whom?")
- Conflicts between answers (e.g. Q3 = "Firebase" AND Q7 = "no public cloud" — asks which takes precedence)
- Missing critical info that can't be reasonably defaulted (e.g. Q4 = yes, safety-critical, but no description)

**Maximum 5 clarifying questions.** Any unresolved issues beyond 5 go into `Open Decisions`.

**If the developer skips:** the subagent fills gaps with reasonable defaults and documents
every assumption in `constitution.md ## Open Decisions` for the developer to confirm.

---

## `sdd-scaffold` subagent

Reads any existing brief/requirements files in the project, then generates:

- **`constitution.md`** — fully populated from answers + clarifications. Anything
  unresolved goes into `## Open Decisions` with the assumption made and a note to confirm.
  Fixed constraints from Q7 go verbatim into `## Architecture Constraints`.
- **`.ai-sdd/ai-sdd.yaml`** — tuned to the project:
  - Safety-critical (Q4=yes) → T2 gates on requirements + architecture; paired review on implement
  - Compliance (Q5≠none) → injection detection quarantine; T2 on requirements
  - Scale → cost budget: quickfix $5 / feature $15 / greenfield $25 / regulated $50
  - Fixed constraints (Q7) → technology mandates + data residency reflected in config
- **`.ai-sdd/workflows/default-sdd.yaml`** — selects the right base workflow:
  quickfix → agile-feature → greenfield-product → regulated-enterprise
- **`docs/init-report.md`** — actionable setup guide: files created, open decisions,
  steps to start, configuration rationale, what each agent will produce, estimated cost

Runs `ai-sdd validate-config` at the end to confirm the generated config is valid.

---

## `ai-sdd scaffold` CLI

Headless/CI path: takes `--description-file brief.md`, dispatches the same subagent
via the configured adapter. Flags: `--description-file`, `--tool`, `--project`, `--skip-init`.

---

## Zero changes to `init.ts`

The new `sdd-scaffold` agent and skill files are placed in `data/integration/claude-code/`
and automatically copied by the existing directory-scanning loop in `installClaudeCode`.
