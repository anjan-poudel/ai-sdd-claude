# T023: Project Scaffolding — `/sdd-scaffold` Skill, Subagent, and CLI Command

**Phase:** 3 (Native Integration)
**Status:** PENDING
**Dependencies:** T018 (Claude Code integration), T010 (CLI + config)
**Size:** M (5 days)

---

## Problem

`ai-sdd init` is mechanical — it copies template files and creates a blank
`constitution.md`. The developer still has to:

- Manually fill in `constitution.md` (the most important file, easy to get wrong)
- Decide which workflow pattern fits their project
- Tune `.ai-sdd/ai-sdd.yaml` (risk tiers, cost budget, HIL settings)
- Figure out what to do first and why

Additionally, the scaffold asks the same questions regardless of whether this is a new
project or an existing one. Greenfield projects need different information than brownfield
features. There is no concept of feature-level constitutions: scaffolding a feature either
overwrites the root constitution.md or requires manual workarounds.

This creates friction at the most critical moment — project setup — and leads to
under-specified constitutions and mis-tuned configurations.

---

## Solution

A three-part scaffolding system with **context-aware mode detection**:

1. **`/sdd-scaffold` skill** — developer types this once in Claude Code; the skill
   runs a context probe, detects the mode (greenfield / brownfield-feature / brownfield-quickfix),
   asks tailored questions, and drives everything else
2. **`sdd-scaffold` subagent** — receives the collected answers and mode, then generates
   the appropriate output artifacts (mode-dependent)
3. **`ai-sdd scaffold` CLI command** — headless/CI entry point; reads a description
   file and dispatches to the configured adapter

### Mode Detection

The skill runs silent bash probes before asking any questions:
- `test -f constitution.md && grep -c '^\S' constitution.md` — real content?
- `ls src/ lib/ app/ 2>/dev/null | head -3` — source dirs?
- `git log --oneline -3 2>/dev/null` — git history?
- `ls specs/*/constitution.md 2>/dev/null` — existing feature constitutions?

Combined with Q1 ("What are you building — new project, feature, or quick fix?"), the
skill determines: **greenfield** | **brownfield-feature** | **brownfield-quickfix**.

### Mode-specific question counts

| Mode | Questions | Clarification max |
|------|-----------|-------------------|
| greenfield | 8 (Q1-Q8) | 5 |
| brownfield-feature | 6 (Q1-Q6) | 3 |
| brownfield-quickfix | 4 (Q1-Q4) | 2 |

### Mode-specific output artifacts

| Mode | Artifacts |
|------|-----------|
| greenfield | `constitution.md`, `.ai-sdd/ai-sdd.yaml`, `.ai-sdd/workflows/default-sdd.yaml`, `docs/init-report.md` |
| brownfield-feature | `specs/<feature-slug>/constitution.md`, `.ai-sdd/workflows/<feature-slug>.yaml`, `specs/<feature-slug>/init-report.md` |
| brownfield-quickfix | `.ai-sdd/workflows/quickfix-<slug>.yaml`, `docs/quickfix-<slug>-report.md` |

### Key constraint: `.ai-sdd/` is framework-only

The `.ai-sdd/` directory houses framework runtime files and must remain static across
all projects. Feature-specific artifacts (constitutions, init reports) belong in
`specs/<feature-slug>/`. Only workflow YAML files go in `.ai-sdd/workflows/` because
the engine looks there for workflow definitions.

---

## Integration Model

```
Developer types: /sdd-scaffold
    │
    ▼
sdd-scaffold skill:
  1. Runs `ai-sdd init --tool claude_code` if not already done
  2. Context probe (silent bash): detect greenfield vs brownfield
  3. Asks Q1 (combined opener) → finalizes mode
  4. Asks mode-tailored questions (8/6/4 depending on mode)
  5. Phase 2: targeted clarification (max 5/3/2 depending on mode)
  6. Spawns Task(sdd-scaffold) with mode + collected answers
      │
      ▼
  sdd-scaffold subagent (own context window):
    MODE: greenfield
      → Read: any existing requirements.md / project brief files
      → Write: constitution.md          (populated from answers + analysis)
      → Write: .ai-sdd/ai-sdd.yaml      (tuned to the project)
      → Write: .ai-sdd/workflows/default-sdd.yaml  (with appropriate overrides)
      → Write: docs/init-report.md      (actionable setup guide)
      → Run: `ai-sdd validate-config`
    MODE: brownfield-feature
      → Read: existing constitution.md (project context)
      → Write: specs/<feature-slug>/constitution.md  (feature constitution)
      → Write: .ai-sdd/workflows/<feature-slug>.yaml (feature workflow)
      → Write: specs/<feature-slug>/init-report.md   (feature setup guide)
      → Run: `ai-sdd validate-config`
    MODE: brownfield-quickfix
      → Read: existing constitution.md (project context)
      → Write: .ai-sdd/workflows/quickfix-<slug>.yaml (quickfix workflow)
      → Write: docs/quickfix-<slug>-report.md          (quickfix report)
    → Returns: summary of what was generated and what the developer should do next
  7. Skill presents the summary and next steps inline

Headless / CI:
  ai-sdd scaffold --description-file brief.md [--tool claude_code]
    → dispatches sdd-scaffold agent via configured adapter
```

---

## Clarifying Questions (the HIL conversation)

The conversation has two phases, adapted by mode:

**Phase 1 — Context probe + structured intake.** The skill runs silent bash probes
to detect greenfield vs brownfield, then asks Q1 (combined opener: "What are you
building — new project, feature, or quick fix?"). Q1 + probe results finalize the mode.
The skill then asks the remaining mode-specific questions in sequence.

| Mode | Total questions | Details |
|------|----------------|---------|
| greenfield | Q1-Q8 | Q2: platform, Q3: stack, Q4: safety, Q5: compliance, Q6: scale, Q7: constraints, Q8: user + success criteria |
| brownfield-feature | Q1-Q6 | Q2: feature name/scope, Q3: new safety/compliance delta, Q4: affected modules, Q5: feature constraints, Q6: user + success criteria |
| brownfield-quickfix | Q1-Q4 | Q2: bug description, Q3: safety implications, Q4: constraints |

Each question is presented with `(type ? for help)`. Any response other than `?` is
recorded and the skill moves on.

**Phase 2 — Targeted clarification.** After all mode-specific answers are collected,
the skill reviews them for ambiguity, vagueness, and conflicts. It asks only the
clarifying questions that are necessary. Maximum: 5 (greenfield), 3 (brownfield-feature),
2 (brownfield-quickfix).

For brownfield modes, the skill also reads the existing constitution.md to understand
the project's current context and avoid asking about things already documented there.

**Escape hatch.** At the start of Phase 2 the skill shows:
> "I have a few follow-up questions. Type `→` or `skip` at any time to stop and proceed
> with what we have — I'll fill any gaps with reasonable defaults and document
> assumptions in `Open Decisions`."

The developer can request to skip at any point by typing: `→` · `skip` · `proceed` ·
`go ahead` · `enough` · `continue` · `s`.

When a skip is requested, the skill asks for confirmation before stopping:
> "Proceed with what we have? I'll fill any remaining gaps with defaults and document
> assumptions in Open Decisions. [yes / no, keep going]"

- **Yes** (or `y`, `yes`, `ok`, `sure`, `confirm`) → stop Phase 2, proceed to subagent
- **No** (or `n`, `no`, `keep going`, `continue`) → resume from the next unanswered question

If the developer provides a `requirements.md` or other brief in the project directory,
the subagent reads it to supplement the answers — reducing how much the developer
needs to type and reducing the number of clarifying questions needed.

---

### Phase 2 — Clarification rules

The skill asks a clarifying question only when:

1. **An answer is too vague to generate a useful artifact.** The subagent would have to
   guess, and guessing wrong is worse than asking.
   - *Vague*: Q1 answer = "a mobile app" — ask: "What does it do and for whom?"
   - *Vague*: Q6 = "medium sized" — ask: "Is this closer to a feature (days) or a
     greenfield product (weeks to months)?"

2. **An answer conflicts with another answer.**
   - Q3 = "Firebase hosting" AND Q7 = "no public cloud" → conflict: ask which takes precedence
   - Q4 = "no safety-critical features" AND Q1 mentions "emergency alerts" → ask for clarification
   - Q5 = "HIPAA" AND Q3 = "store all data in the browser" → conflict: ask how PHI is handled

3. **A critical piece of information is missing that cannot be reasonably defaulted.**
   - Q4 = yes (safety-critical) but no description given → ask: "Briefly describe the
     safety-critical feature so the architect can design the appropriate safeguards."
   - Q2 = "mobile" but iOS vs Android not specified and it matters (e.g. HealthKit mentioned
     elsewhere) → ask which platform(s)

**Maximum clarifying questions per session: 5.** If more than 5 issues exist, address
the most critical 5 and document the rest in `Open Decisions`.

**Do not ask clarifying questions for:**
- Minor vagueness where a reasonable default exists and the risk is low
- Preferences (Q3) — the architect handles those
- Future features or nice-to-haves — out of scope for scaffolding

### Questions and help text

#### All modes

---

**Q1 — What are you building — and is this a new project, a new feature, or a quick fix?**
> Describe the core problem you're solving and whether this is greenfield, a feature
> addition, or a bug fix.

`? help` →
> "New project" = greenfield, no existing codebase.
> "New feature" = adding capability to an existing codebase with an existing constitution.
> "Quick fix" = bug fix or small patch in an existing codebase.
> If unsure, describe what you're doing and I'll help classify it.
> Examples:
> - "A mobile app that helps elderly users manage medications — new project."
> - "Adding payment processing to our existing e-commerce backend — new feature."
> - "Login fails with plus-sign emails — quick fix."

---

#### Greenfield questions (Q2-Q8)

**Q2 — Target platform(s)?**
> Where will the software run? Select all that apply.
> Options: mobile iOS · mobile Android · web frontend · backend API · desktop · embedded/IoT · other

`? help` →
> This determines the available tooling, frameworks, and integration constraints.
> - **Mobile iOS** — iPhone/iPad; access to HealthKit, CoreML, on-device LLM via MLX
> - **Mobile Android** — Android phones; Health Connect, TensorFlow Lite
> - **Web frontend** — runs in a browser; React, Vue, Angular, plain HTML
> - **Backend API** — server-side service; REST or GraphQL; Node, Python, Go, etc.
> - **Desktop** — Windows/macOS/Linux native app; Electron, Tauri
> - **Embedded/IoT** — hardware with constrained resources
>
> List all that apply. "Mobile iOS + backend API" = two platforms.
> If unsure, describe the device the end user will interact with.

---

**Q3 — Tech stack preferences?**
> List any languages, frameworks, databases, or hosting you've already decided on —
> or say "none, let the architect decide".

`? help` →
> Only list things that are *already decided* or constrained (existing team skills,
> existing systems to extend). Leave the rest open — the architect will propose it.
> Examples:
> - "TypeScript + Bun + PostgreSQL on AWS"
> - "React Native + Firebase, everything else open"
> - "Must use Python — team has no other skills"
> - "none — let the architect decide"

---

**Q4 — Does this project involve safety-critical features?**
> A feature is safety-critical if a failure could directly harm a person, cause
> significant financial loss, or create serious legal liability. Yes/no + brief description.

`? help` →
> Examples of safety-critical features:
> - Health monitoring, vitals tracking, or emergency alert systems
> - Autonomous decisions affecting real people (medical dosing, vehicle control)
> - Financial transactions or payments where errors cause loss
> - Systems used by children or cognitively vulnerable users
> - Emergency dispatch or crisis intervention
>
> If yes, T2 gates and paired review are applied automatically — adding a mandatory
> human sign-off before implementation begins and a challenger agent on the code.

---

**Q5 — Privacy or compliance requirements?**
> Are there regulations or standards your system must comply with?
> Options: GDPR · HIPAA · SOC2 · PCI-DSS · APRA CPS 234 · Children's data laws · none/unknown

`? help` →
> - **GDPR** — EU data protection law; applies to any system handling EU residents' data
> - **HIPAA** — US healthcare data privacy; applies to systems handling patient health records
> - **SOC2** — security/availability certification; commonly required for B2B SaaS
> - **PCI-DSS** — payment card standard; required if you process or store card data
> - **APRA CPS 234** — Australian financial sector cybersecurity standard
> - **Children's data** — COPPA (US), UK Children's Code; extra restrictions on data collection
>
> Answer "none/unknown" if not applicable. This sets security sensitivity levels and
> adds compliance traceability requirements to the BA and architect tasks.

---

**Q6 — What is the expected scale of this project?**
> How complex is this work and what's the rough delivery timeframe?
> Options: quickfix · feature · greenfield product · regulated enterprise

`? help` →
> - **Quickfix** — a known bug or small isolated change; no design phase; hours to a day.
>   Workflow: implement → review. Cost budget: ~$5.
> - **Feature** — a bounded new capability within an existing system; one sprint.
>   Workflow: BA → implement → review. Cost budget: ~$15.
> - **Greenfield product** — a new system from scratch; all 6 agents run in full sequence.
>   Weeks to months. Cost budget: ~$25.
> - **Regulated enterprise** — a change in a regulated industry requiring audit trail,
>   formal sign-offs, and evidence of correctness at every phase. Months. Cost budget: ~$50.
>   T2 gates throughout; every output reviewed before proceeding.

---

**Q7 — What are your fixed constraints?**
> List rules, limitations, or requirements that are given and cannot be changed —
> regardless of how the system is designed. Answer "none" if there are none.

`? help` →
> Fixed constraints are things the architect must work *within*, not decide.
> They go directly into `constitution.md` as hard boundaries every agent must respect.
> Examples by category:
> - **Existing systems**: "Must integrate with our SAP ERP — cannot be replaced"
> - **Technology mandates**: "All backend code must be Python — no exceptions"
> - **Performance SLAs**: "API responses must be < 200ms at p99 under peak load"
> - **Budget**: "Hosting budget is $200/month maximum"
> - **Team**: "One developer, part-time, approximately 10 hours per week"
> - **Deployment**: "Must run on our on-premise servers — no public cloud"
> - **Data residency**: "All user data must remain in Australia"
> - **Integrations**: "Must support SSO via our existing Azure AD tenant"
>
> List as many as apply. The architect cannot propose solutions that violate these.
> Anything you're *hoping for* but not *requiring* belongs in Q3 as a preference.

---

**Q8 — Who is the primary user and what does success look like?** *(greenfield only)*
> Name the person (role, not name) who will use the system most, and describe the
> outcome that means the project worked.

`? help` →
> Examples:
> - "Primary user is a clinic nurse. Success = medication errors drop 50% in 6 months."
> - "Primary user is an HR manager. Success = job posting to hire time under 2 weeks."

---

#### Brownfield-feature questions (Q2-Q6)

**Q2 — Feature name and scope?**
> What does the feature do, and what does it NOT do?

`? help` →
> Be specific about boundaries. Example: "User notification preferences — lets users
> choose email vs push for each type. Does NOT change the delivery pipeline itself."

**Q3 — New safety or compliance concerns beyond what the project already handles?**
> The root constitution.md documents the project baseline. Only mention NEW concerns.

`? help` →
> Example: "This feature adds payment processing — need PCI-DSS (rest of app doesn't
> handle payments)." Answer "none" if the feature stays within the existing profile.

**Q4 — What existing code or modules does this feature touch?**
> List files, directories, services, or APIs this feature modifies or integrates with.

`? help` →
> Example: "src/notifications/, the user-settings API, and the email service adapter."

**Q5 — Feature-specific constraints?**
> Constraints beyond the project-level ones in constitution.md.

`? help` →
> Example: "Must ship by March 15", "Cannot change the database schema".

**Q6 — Primary user of this feature + success criteria?**
> Who benefits and what outcome means it worked?

`? help` →
> Example: "Ops team. Success = fewer than 5 false-positive alerts per day."

---

#### Brownfield-quickfix questions (Q2-Q4)

**Q2 — What is the bug or issue?**
> Symptoms, location, steps to reproduce if known.

`? help` →
> Example: "Login fails with 500 when email has a plus sign. In src/auth/login.ts."

**Q3 — Safety or compliance implications?**
> Could this bug cause data loss, security exposure, or compliance violations?

`? help` →
> Example: "Yes — exposes user emails in error responses (GDPR concern)."

**Q4 — Constraints?**
> Timeframe, things that must NOT break.

`? help` →
> Example: "Must fix today. Do not change auth middleware signature."

---

## Generated Artifacts

### Greenfield artifacts

#### `constitution.md`

Populated from answers, not a blank template. Structure:

```markdown
# Constitution

## Project Purpose
<from answer 1 — expanded by the subagent into a clear problem statement>

## Target Users
<inferred from answers 1 + 4 — who uses this and who is affected>

## Platform & Tech Stack
<from answers 2 + 3>

## Architecture Constraints
<inferred from answers 4 + 5 — safety constraints, offline requirements,
 data residency, compliance boundaries>

## Standards
<inferred from answers 4 + 5 — accessibility, privacy, security baselines>

## Open Decisions  ← developer must resolve these before running /sdd-run
<list of decisions the subagent couldn't make from the answers alone>

## Artifact Manifest
<!-- AUTO-GENERATED by ai-sdd engine after each task — do not edit this section -->
```

The `Open Decisions` section is critical — the subagent flags what it couldn't determine
and what needs a human decision before the workflow starts.

### `.ai-sdd/ai-sdd.yaml`

Tuned from the minimal init version based on answers:

| Answer | Config effect |
|---|---|
| Safety-critical = yes | `overlays.hil.enabled: true`; `policy_gate` T2 on define-requirements + design-l1 |
| Compliance = GDPR/HIPAA | `security.injection_detection_level: quarantine`; `policy_gate` T2 |
| Scale = regulated enterprise | `cost_budget_per_run_usd: 50.00`; `max_rework_iterations: 5` |
| Scale = quickfix | `cost_budget_per_run_usd: 5.00`; `overlays.hil.enabled: false` |
| Scale = feature/greenfield | `cost_budget_per_run_usd: 15.00` |

### `.ai-sdd/workflows/default-sdd.yaml`

Selects the most appropriate example workflow and adds project-specific overrides:

| Scale answer | Base workflow |
|---|---|
| quickfix | `01-quickfix` |
| feature | `02-agile-feature` |
| greenfield product | `05-greenfield-product` |
| regulated enterprise | `06-regulated-enterprise` |

Safety-critical or compliance requirements → add T2 gates and `paired: enabled: true` on implement.

#### `docs/init-report.md`

Actionable setup guide. Sections:

1. **What was scaffolded** — list of files created/updated
2. **Open decisions** — decisions the developer must make before running (mirrors the
   `constitution.md` Open Decisions section, with more context)
3. **Steps to start** — ordered: resolve open decisions → review constitution → `/sdd-run`
4. **Configuration rationale** — why each non-default setting was chosen
5. **What each agent will produce** — table of agent → output → key decisions it makes
6. **Estimated cost** — rough estimate based on workflow + cost_budget_per_run_usd

### Brownfield-feature artifacts

#### `specs/<feature-slug>/constitution.md`

Feature constitution — additive to the root constitution.md. Lives in the project's
`specs/` directory, NOT inside `.ai-sdd/`. The resolver picks it up automatically.

```markdown
# Feature Constitution: <feature-name>

## Feature Scope
[What it does and does NOT do — from Q2]

## Affected Modules
[Existing code touched — from Q4]

## Additional Constraints
[Feature-specific — from Q5]

## Safety & Compliance Delta
[New concerns beyond root constitution — from Q3. "None" if none]

## Success Criteria
[User-facing — from Q6]

## Open Decisions
[Assumptions documented here]
```

#### `.ai-sdd/workflows/<feature-slug>.yaml`

Feature-specific workflow. Base: `02-agile-feature.yaml`. If new safety/compliance
concerns: add T2 gates.

#### `specs/<feature-slug>/init-report.md`

Feature setup guide: overview, integration surface, open decisions, steps to start.

### Brownfield-quickfix artifacts

#### `.ai-sdd/workflows/quickfix-<slug>.yaml`

Minimal quickfix workflow. Base: `01-quickfix.yaml`. If safety implications: add T2 + HIL.

#### `docs/quickfix-<slug>-report.md`

Bug description, safety impact, constraints, steps to start.

---

## Acceptance Criteria

```gherkin
Feature: /sdd-scaffold skill — mode detection

  Scenario: Skill runs init if project not yet initialised
    Given a project directory with no .ai-sdd/ directory
    When the developer types /sdd-scaffold
    Then the skill runs `ai-sdd init --tool claude_code` before asking any questions
    And the standard agent and skill files are created in .claude/

  Scenario: Context probe detects greenfield project
    Given a project directory with no constitution.md, no source dirs, no git history
    When the skill runs the context probe
    Then the inferred mode is greenfield
    And Q1 confirms the mode

  Scenario: Context probe detects brownfield project
    Given a project with constitution.md containing real content, source dirs, and git history
    When the skill runs the context probe
    Then the inferred mode is brownfield
    And Q1 answer determines feature vs quickfix

  Scenario: Mode conflict triggers disambiguation
    Given the probe detects brownfield but the developer says "new project"
    When Q1 is answered
    Then the skill asks one disambiguation question citing the probe evidence
    And uses the developer's confirmed answer as the final mode

  Scenario: Skill announces detected mode
    Given Q1 has been answered and mode is finalized
    Then the skill displays: "Got it — this is [a new project / a new feature / a quick fix]."

Feature: /sdd-scaffold skill — greenfield path

  Scenario: Greenfield asks 8 questions with ? help available
    Given mode is greenfield
    When the skill asks questions
    Then it presents Q1-Q8 in sequence (platform, stack, safety, compliance, scale, constraints, user+success)
    And each question includes "(type ? for help)"

  Scenario: Developer types ? to get help on a question
    Given the skill has asked Q2 (target platform)
    When the developer responds with "?"
    Then the skill shows the detailed help text for Q2
    And re-asks Q2
    And does not advance to Q3 until a non-? answer is given

  Scenario: Greenfield Phase 2 allows max 5 clarifying questions
    Given mode is greenfield and 7 issues were found
    When the skill runs Phase 2
    Then it asks at most 5 clarifying questions
    And documents the remaining 2 in the subagent brief for Open Decisions

  Scenario: Conflict between Q3 and Q7 triggers clarifying question
    Given Q3 = "Firebase" and Q7 = "no public cloud"
    When Phase 2 begins
    Then the skill asks which takes precedence before proceeding

  Scenario: Fixed constraints appear in constitution.md Architecture Constraints
    Given answer 7 = "Must use PostgreSQL. Deploy to on-premise only. API < 200ms p99."
    When the sdd-scaffold subagent runs in greenfield mode
    Then constitution.md ## Architecture Constraints contains all three constraints verbatim

  Scenario: Q8 (user + success) populates Target Users and Success Criteria
    Given answer 8 = "Primary user is a clinic nurse. Success = medication errors drop 50%."
    When the sdd-scaffold subagent runs in greenfield mode
    Then constitution.md ## Target Users mentions clinic nurse
    And constitution.md ## Success Criteria mentions the 50% target

  Scenario: Safety-critical project gets T2 gates
    Given answer 4 = "yes — health monitoring and emergency services"
    When the sdd-scaffold subagent generates .ai-sdd/ai-sdd.yaml
    Then the workflow overrides include policy_gate: { risk_tier: T2 }

  Scenario: Quickfix scale gets minimal config
    Given answer 6 = "quickfix"
    When the sdd-scaffold subagent generates .ai-sdd/ai-sdd.yaml
    Then cost_budget_per_run_usd is 5.00 or less
    And overlays.hil.enabled is false

  Scenario: Config is valid after greenfield scaffolding
    Given the subagent has written all greenfield artifacts
    When the subagent runs `ai-sdd validate-config` via Bash
    Then validate-config exits with code 0

Feature: /sdd-scaffold skill — brownfield-feature path

  Scenario: Brownfield-feature asks 6 questions
    Given mode is brownfield-feature
    When the skill asks questions
    Then it presents Q1-Q6: opener, feature name/scope, safety delta, affected modules, constraints, user+success
    And does NOT ask about platform, tech stack, or project-level scale

  Scenario: Brownfield-feature Phase 2 allows max 3 clarifying questions
    Given mode is brownfield-feature
    When the skill runs Phase 2
    Then it asks at most 3 clarifying questions

  Scenario: Brownfield-feature reads existing constitution for context
    Given mode is brownfield-feature and constitution.md exists with content
    When Phase 2 begins
    Then the skill reads constitution.md to avoid asking about documented context

  Scenario: Feature constitution written to specs/ not .ai-sdd/
    Given mode is brownfield-feature and feature name = "user notifications"
    When the sdd-scaffold subagent runs
    Then specs/user-notifications/constitution.md is created
    And .ai-sdd/constitutions/ is NOT created or modified
    And root constitution.md is NOT modified

  Scenario: Feature workflow created in .ai-sdd/workflows/
    Given mode is brownfield-feature and feature slug = "user-notifications"
    When the sdd-scaffold subagent runs
    Then .ai-sdd/workflows/user-notifications.yaml is created

  Scenario: Feature init report written to specs/
    Given mode is brownfield-feature and feature slug = "user-notifications"
    When the sdd-scaffold subagent runs
    Then specs/user-notifications/init-report.md is created
    And it contains the integration surface from Q4

  Scenario: Feature constitution is picked up by resolver
    Given specs/user-notifications/constitution.md exists
    When the constitution resolver runs
    Then the feature constitution is included in the merged result
    And it appears after the root constitution

Feature: /sdd-scaffold skill — brownfield-quickfix path

  Scenario: Brownfield-quickfix asks 4 questions
    Given mode is brownfield-quickfix
    When the skill asks questions
    Then it presents Q1-Q4: opener, bug description, safety implications, constraints
    And does NOT ask about platform, stack, scale, user, or success criteria

  Scenario: Brownfield-quickfix Phase 2 allows max 2 clarifying questions
    Given mode is brownfield-quickfix
    When the skill runs Phase 2
    Then it asks at most 2 clarifying questions

  Scenario: Quickfix does not generate feature constitution
    Given mode is brownfield-quickfix
    When the sdd-scaffold subagent runs
    Then no file is created in specs/
    And no feature constitution is generated

  Scenario: Quickfix workflow and report are generated
    Given mode is brownfield-quickfix and slug = "login-plus-sign-fix"
    When the sdd-scaffold subagent runs
    Then .ai-sdd/workflows/quickfix-login-plus-sign-fix.yaml is created
    And docs/quickfix-login-plus-sign-fix-report.md is created

Feature: /sdd-scaffold skill — shared behaviors (all modes)

  Scenario: Skill announces skip option at start of Phase 2
    Given all mode-specific answers have been collected
    When the skill begins Phase 2
    Then it displays a message containing "→ or 'skip'" before asking any question

  Scenario: Skip request triggers confirmation before stopping
    Given Phase 2 has begun and one clarifying question has been asked
    When the developer responds with "→"
    Then the skill asks for confirmation before stopping
    And the skill does NOT yet spawn Task(sdd-scaffold)

  Scenario: Developer confirms skip
    Given the skill has asked for skip confirmation
    When the developer responds with "yes" or "y"
    Then the skill stops asking clarifying questions
    And proceeds to spawn Task(sdd-scaffold) with answers collected so far

  Scenario: Developer declines skip
    Given the skill has asked for skip confirmation
    When the developer responds with "no" or "keep going"
    Then the skill resumes from the next unanswered clarifying question

  Scenario: Subagent fills gaps with documented assumptions when developer skips
    Given the developer skipped Phase 2
    When the sdd-scaffold subagent generates artifacts
    Then Open Decisions contains documented assumptions
    And each is marked as needing developer confirmation

  Scenario: Existing requirements.md is incorporated
    Given a requirements.md exists in the project directory
    When the subagent runs (any mode)
    Then it reads requirements.md before generating artifacts

Feature: ai-sdd scaffold — headless path

  Scenario: CLI command accepts description file
    Given a file project-brief.md containing a project description
    When `ai-sdd scaffold --description-file project-brief.md` is run
    Then the scaffold subagent is dispatched via the configured adapter
    And the command exits 0

  Scenario: CLI --skip-init flag skips init when already done
    Given .ai-sdd/ already exists
    When `ai-sdd scaffold --description-file brief.md --skip-init` is run
    Then `ai-sdd init` is not re-run
    And existing agent/skill files are not overwritten
```

---

## Deliverables

### New integration files (copied by `ai-sdd init`)

**`data/integration/claude-code/skills/sdd-scaffold/SKILL.md`** — See the actual file
for the full implementation. Key structure:
- Context probe (silent bash: constitution.md, source dirs, git log, specs/*/constitution.md)
- Q1: combined opener ("What are you building — new project, feature, or quick fix?")
- Mode-dependent question paths: greenfield (Q2-Q8), brownfield-feature (Q2-Q6), brownfield-quickfix (Q2-Q4)
- Phase 2: mode-scaled clarification limits (5/3/2)
- Spawns Task(sdd-scaffold) with mode + answers

**`data/integration/claude-code/agents/sdd-scaffold.md`** — See the actual file
for the full implementation. Key structure:
- Three mode sections: greenfield, brownfield-feature, brownfield-quickfix
- Greenfield: generates constitution.md, ai-sdd.yaml, workflow, docs/init-report.md
- Brownfield-feature: generates specs/<feature-slug>/constitution.md, feature workflow, specs/<feature-slug>/init-report.md
- Brownfield-quickfix: generates quickfix workflow, docs/quickfix-<slug>-report.md
- `.ai-sdd/` is framework-only — feature artifacts go in `specs/<feature-slug>/`

### New CLI command

**`src/cli/commands/scaffold.ts`**

```typescript
// ai-sdd scaffold --description-file <path> [--tool <name>] [--project <path>] [--skip-init]
//
// Headless/CI path. Reads the description file, dispatches sdd-scaffold
// agent via the configured adapter, writes the three output artifacts.
```

Flags:
- `--description-file <path>` — file containing project description (required)
- `--tool <name>` — tool integration: `claude_code | codex | roo_code` (default: from config)
- `--project <path>` — project directory (default: cwd)
- `--skip-init` — skip `ai-sdd init` if already done

### Updated `src/cli/index.ts`

Register the `scaffold` command alongside `init`, `run`, etc.

---

## What `ai-sdd init --tool claude_code` creates (updated)

```
.claude/
  agents/
    sdd-ba.md
    sdd-architect.md
    sdd-pe.md
    sdd-le.md
    sdd-dev.md
    sdd-reviewer.md
    sdd-scaffold.md        ← scaffolding agent (excluded from init copy — pre-init only)
  skills/
    sdd-run/SKILL.md
    sdd-status/SKILL.md
    sdd-scaffold/SKILL.md  ← scaffolding skill
```

Note: `sdd-scaffold.md` agent is intentionally excluded from the init copy (see
`EXCLUDED_AGENTS` in `init.ts`) because it's a pre-init scaffolding agent used via
the `/sdd-scaffold` skill, not a workflow execution agent.

---

## Test Strategy

- Unit: CLI scaffold command registers and parses all flags correctly
- Unit: scaffold command calls `ai-sdd init` unless `--skip-init` is passed
- Unit: `sdd-scaffold` agent file exists in `data/integration/claude-code/agents/`
- Unit: `sdd-scaffold` skill file exists in `data/integration/claude-code/skills/sdd-scaffold/`
- Unit: Constitution resolver includes `specs/*/constitution.md` files
- Unit: Feature constitutions merge in alphabetical order by directory name
- Unit: Empty `specs/` directory does not break constitution resolution
- Integration: `ai-sdd init --tool claude_code` copies sdd-scaffold skill
- Manual: Run `/sdd-scaffold` in a greenfield repo → detects greenfield, asks 8 questions,
  generates root constitution.md
- Manual: Run `/sdd-scaffold` in this repo (brownfield) → detects brownfield, asks 6
  feature questions, generates `specs/<feature>/constitution.md` without touching root

## Rollback / Fallback

- If `sdd-scaffold` subagent cannot determine a value, it puts it in `Open Decisions`
  rather than guessing — the developer resolves before running `/sdd-run`
- If `ai-sdd validate-config` fails after generation, the subagent retries once with
  corrected config; if it still fails, it writes the error to init-report.md and exits
- Existing `constitution.md` with content is extended (new sections appended), not overwritten
- Brownfield-feature mode never touches root constitution.md — feature constitutions go to `specs/<feature-slug>/`
