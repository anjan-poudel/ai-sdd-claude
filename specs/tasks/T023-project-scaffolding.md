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

This creates friction at the most critical moment — project setup — and leads to
under-specified constitutions and mis-tuned configurations.

---

## Solution

A three-part scaffolding system:

1. **`/sdd-scaffold` skill** — developer types this once in Claude Code; the skill
   asks clarifying questions and drives everything else
2. **`sdd-scaffold` subagent** — receives the collected answers and generates all
   three output artifacts
3. **`ai-sdd scaffold` CLI command** — headless/CI entry point; reads a description
   file and dispatches to the configured adapter

---

## Integration Model

```
Developer types: /sdd-scaffold
    │
    ▼
sdd-scaffold skill:
  1. Runs `ai-sdd init --tool claude_code` if not already done
  2. Asks 7 clarifying questions inline (HIL in the conversation)
  3. Spawns Task(sdd-scaffold) with collected answers
      │
      ▼
  sdd-scaffold subagent (own context window):
    → Read: any existing requirements.md / project brief files
    → Write: constitution.md          (populated from answers + analysis)
    → Write: .ai-sdd/ai-sdd.yaml      (tuned to the project)
    → Write: .ai-sdd/workflows/default-sdd.yaml  (with appropriate overrides)
    → Write: docs/init-report.md      (actionable setup guide)
    → Run: `ai-sdd validate-config` via Bash to confirm config is valid
    → Returns: summary of what was generated and what the developer should do next
  4. Skill presents the summary and next steps inline

Headless / CI:
  ai-sdd scaffold --description-file brief.md [--tool claude_code]
    → dispatches sdd-scaffold agent via configured adapter
```

---

## Clarifying Questions (the HIL conversation)

The conversation has two phases:

**Phase 1 — Structured intake (Q1–Q7).** The skill asks all 7 questions in sequence.
Each question is presented with `(type ? for help)`. Any response other than `?` is
recorded and the skill moves on.

**Phase 2 — Targeted clarification.** After all 7 answers are collected, the skill
reviews them for ambiguity, vagueness, and conflicts. It asks only the clarifying
questions that are necessary — not a comprehensive interrogation.

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

---

**Q1 — What are you building?**
> Describe the core problem you're solving and for whom. One or two sentences.
> Don't worry about technical specifics yet — focus on purpose and user.

`? help` →
> Focus on the *why* and *who*, not the *how*. Examples:
> - "A mobile app that helps elderly users manage medications and stay connected with family."
> - "A REST API backend for a government job portal used by HR departments."
> - "A real-time dashboard for monitoring IoT sensors in a warehouse."

---

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

---

## Generated Artifacts

### `constitution.md`

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

### `docs/init-report.md`

Actionable setup guide. Sections:

1. **What was scaffolded** — list of files created/updated
2. **Open decisions** — decisions the developer must make before running (mirrors the
   `constitution.md` Open Decisions section, with more context)
3. **Steps to start** — ordered: resolve open decisions → review constitution → `/sdd-run`
4. **Configuration rationale** — why each non-default setting was chosen
5. **What each agent will produce** — table of agent → output → key decisions it makes
6. **Estimated cost** — rough estimate based on workflow + cost_budget_per_run_usd

---

## Acceptance Criteria

```gherkin
Feature: /sdd-scaffold skill — interactive path

  Scenario: Skill runs init if project not yet initialised
    Given a project directory with no .ai-sdd/ directory
    When the developer types /sdd-scaffold
    Then the skill runs `ai-sdd init --tool claude_code` before asking any questions
    And the standard agent and skill files are created in .claude/

  Scenario: Skill asks exactly 7 questions with ? help available
    Given a project directory initialised with ai-sdd
    When the developer types /sdd-scaffold
    Then the skill presents questions 1–7 in sequence
    And each question includes a "(type ? for help)" prompt
    And the skill waits for developer input before proceeding to the next question

  Scenario: Developer types ? to get help on a question
    Given the skill has asked Q2 (target platform)
    When the developer responds with "?"
    Then the skill shows the detailed help text for Q2
    And re-asks Q2
    And does not advance to Q3 until a non-? answer is given

  Scenario: Developer types "help" or "?help" to get help
    Given the skill has asked any question
    When the developer responds with "help" or "?help" or "more info"
    Then the skill treats it the same as "?"
    And shows the help text and re-asks the question

  Scenario: Skill announces skip option at start of Phase 2
    Given all 7 answers have been collected
    When the skill begins Phase 2
    Then it displays a message containing "→ or 'skip'" before asking any question
    And the message explains the developer can proceed with available information

  Scenario: Skip request triggers confirmation before stopping
    Given Phase 2 has begun and one clarifying question has been asked
    When the developer responds with "→"
    Then the skill asks for confirmation before stopping
    And the confirmation message explains gaps will be filled with defaults
    And the skill does NOT yet spawn Task(sdd-scaffold)

  Scenario: Developer confirms skip
    Given the skill has asked for skip confirmation
    When the developer responds with "yes" or "y" or "ok" or "sure"
    Then the skill stops asking clarifying questions
    And proceeds to spawn Task(sdd-scaffold) with answers collected so far

  Scenario: Developer declines skip confirmation
    Given the skill has asked for skip confirmation
    When the developer responds with "no" or "n" or "keep going"
    Then the skill resumes from the next unanswered clarifying question
    And does not treat it as a skip

  Scenario: Developer skips with any recognised phrase — same confirmation flow
    Given Phase 2 is in progress
    When the developer responds with "skip" or "proceed" or "go ahead" or "enough"
      or "continue" or "s"
    Then the skill asks for confirmation identically to the "→" case

  Scenario: Conflict between Q3 and Q7 triggers clarifying question
    Given Q3 = "Firebase" and Q7 = "no public cloud"
    When Phase 2 begins
    Then the skill asks which takes precedence before proceeding
    And does not generate artifacts until answered or developer skips

  Scenario: Vague Q1 triggers clarifying question
    Given Q1 = "a mobile app"
    When Phase 2 begins
    Then the skill asks "What does it do and for whom?"
    And records the answer before moving to the next clarifying question

  Scenario: Developer skips — subagent fills gaps with documented assumptions
    Given the developer skipped Phase 2 leaving Q2 platform unspecified
    When the sdd-scaffold subagent generates constitution.md
    Then constitution.md ## Open Decisions contains an assumption about the platform
    And the assumption is clearly marked as needing developer confirmation

  Scenario: Maximum 5 clarifying questions enforced
    Given 7 issues were found in Phase 2 review
    When the skill runs Phase 2
    Then it asks at most 5 clarifying questions
    And documents the remaining 2 issues in the subagent brief for Open Decisions

  Scenario: Fixed constraints appear in constitution.md Architecture Constraints
    Given answer 7 = "Must use PostgreSQL. Deploy to on-premise only. API < 200ms p99."
    When the sdd-scaffold subagent runs
    Then constitution.md ## Architecture Constraints contains all three constraints verbatim
    And the subagent does NOT move them to Open Decisions (they are given, not unresolved)

  Scenario: Subagent generates constitution.md with Open Decisions
    Given answers to all 7 questions have been collected
    When the sdd-scaffold subagent runs
    Then constitution.md contains a populated Project Purpose section
    And constitution.md contains an Open Decisions section listing unresolved choices
    And constitution.md does NOT contain blank placeholder sections

  Scenario: Safety-critical project gets T2 gates
    Given answer 4 = "yes — health monitoring and emergency services"
    When the sdd-scaffold subagent generates .ai-sdd/ai-sdd.yaml
    Then the workflow overrides include policy_gate: { risk_tier: T2 } on define-requirements
    And policy_gate: { risk_tier: T2 } on design-l1

  Scenario: Quickfix project gets minimal config
    Given answer 6 = "quickfix"
    When the sdd-scaffold subagent generates .ai-sdd/ai-sdd.yaml
    Then cost_budget_per_run_usd is 5.00 or less
    And overlays.hil.enabled is false

  Scenario: Config is valid after scaffolding
    Given the subagent has written all artifacts
    When the subagent runs `ai-sdd validate-config` via Bash
    Then validate-config exits with code 0

  Scenario: init-report.md is generated
    Given the subagent has written constitution.md and ai-sdd.yaml
    Then docs/init-report.md exists
    And it contains a "Steps to start" section
    And it contains a "What each agent will produce" table
    And it contains an "Open decisions" section matching constitution.md

  Scenario: Existing requirements.md is incorporated
    Given a requirements.md already exists in the project directory
    When the subagent runs
    Then it reads requirements.md before generating constitution.md
    And the constitution reflects content from requirements.md

Feature: ai-sdd scaffold — headless path

  Scenario: CLI command accepts description file
    Given a file project-brief.md containing a project description
    When `ai-sdd scaffold --description-file project-brief.md` is run
    Then the scaffold subagent is dispatched via the configured adapter
    And constitution.md, ai-sdd.yaml, and docs/init-report.md are written
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

**`data/integration/claude-code/skills/sdd-scaffold/SKILL.md`**
```yaml
---
name: sdd-scaffold
description: Scaffold a new ai-sdd project. Asks 7 clarifying questions then generates
             constitution.md, ai-sdd.yaml, workflow config, and docs/init-report.md.
             Run this once after init to set up a new project properly.
context: fork
allowed-tools: Bash, Task
---
Scaffold an ai-sdd project. Follow these steps:

1. Check if .ai-sdd/ exists. If not, run `ai-sdd init --tool claude_code` via Bash.

2. Ask the developer these 7 questions ONE AT A TIME. After each question, add
   "(type ? for help on this question)" on a new line. Wait for the developer's
   response before continuing.

   If the developer responds with "?" (or "help", "?help", "more info"):
   - Show the detailed help text for that question (see below)
   - Re-ask the same question
   - Wait for a real answer before moving to the next question

   Questions:
   Q1: What are you building?
       [? help]: Describe the core problem and for whom. One or two sentences focusing
       on purpose and user, not technical details. Example: "A mobile app that helps
       elderly users manage medications and stay connected with family."

   Q2: Target platform(s)?
       Options: mobile iOS · mobile Android · web frontend · backend API · desktop ·
       embedded/IoT · other (list all that apply)
       [? help]: Where does the software run?
       - Mobile iOS: iPhone/iPad; access to HealthKit, CoreML, on-device LLM
       - Mobile Android: Android phones; Health Connect, TensorFlow Lite
       - Web frontend: runs in a browser; React, Vue, Angular
       - Backend API: server-side REST or GraphQL service
       - Desktop: Windows/macOS/Linux; Electron, Tauri
       - Embedded/IoT: hardware with constrained resources
       List all that apply. Describe the device the end user touches if unsure.

   Q3: Tech stack preferences — or "none, let the architect decide"?
       [? help]: Only list things already decided or constrained (existing team skills,
       systems to extend). Leave the rest open. Examples: "TypeScript + Bun + PostgreSQL",
       "Must use Python — team has no other skills", "none — let the architect decide".

   Q4: Does this project involve safety-critical features? (yes/no + brief description)
       [? help]: Safety-critical = a failure could directly harm a person, cause
       significant financial loss, or create serious legal liability. Examples: health
       monitoring, emergency alerts, financial transactions, systems used by vulnerable
       users, autonomous decisions with real-world impact. If yes: T2 gates + paired
       review are applied automatically.

   Q5: Privacy or compliance requirements?
       Options: GDPR · HIPAA · SOC2 · PCI-DSS · APRA CPS 234 · Children's data ·
       none/unknown
       [? help]: Regulations that impose design constraints.
       - GDPR: EU data protection (any EU users' data)
       - HIPAA: US healthcare patient records
       - SOC2: security certification for B2B SaaS
       - PCI-DSS: payment card processing or storage
       - APRA CPS 234: Australian financial sector cybersecurity
       - Children's data: COPPA (US), UK Children's Code

   Q6: Expected scale?
       Options: quickfix · feature · greenfield product · regulated enterprise
       [? help]:
       - Quickfix: known bug, hours to a day; workflow: implement → review; cost ~$5
       - Feature: new capability in existing system, one sprint; cost ~$15
       - Greenfield product: new system from scratch, all 6 agents, weeks/months; cost ~$25
       - Regulated enterprise: formal audit trail + T2 gates throughout, months; cost ~$50

   Q7: What are your fixed constraints?
       List anything that is given and cannot be changed — or answer "none".
       [? help]: Fixed constraints are boundaries the architect must work within, not decide.
       Examples by category:
       - Existing systems: "Must integrate with our SAP ERP"
       - Technology mandates: "All backend must be Python"
       - Performance SLAs: "API responses < 200ms at p99"
       - Budget: "Hosting budget $200/month maximum"
       - Team: "One developer, 10h/week"
       - Deployment: "On-premise servers only — no public cloud"
       - Data residency: "All user data must remain in Australia"
       - Integrations: "Must use our existing Azure AD for SSO"
       Anything you're hoping for but not requiring belongs in Q3 as a preference.

3. Check for any existing requirements.md, brief.md, or similar files in the project root
   via Bash and note their paths.

4. PHASE 2 — Review answers and ask targeted clarifying questions.

   Before asking anything, say:
   "Thanks — just a few follow-up questions to fill in any gaps.
   Type → or 'skip' at any time to stop and proceed with what we have."

   Review all 7 answers and any existing brief files for:
   a) Answers too vague to generate a useful artifact
   b) Conflicts between answers (e.g. "Firebase" in Q3 AND "no public cloud" in Q7)
   c) Missing critical information that cannot be reasonably defaulted

   Ask only the clarifying questions that are necessary. Maximum 5.
   After each clarifying question, check if the developer's response is a skip signal
   (→, skip, proceed, go ahead, enough, continue, s).
   If so, ask for confirmation:
     "Proceed with what we have? I'll fill any remaining gaps with defaults and document
      assumptions in Open Decisions. [yes / no, keep going]"
   - On yes (y, yes, ok, sure, confirm): stop asking and proceed to step 5
   - On no (n, no, keep going): resume from the next unanswered clarifying question

   Do NOT ask about:
   - Minor vagueness where a reasonable default exists
   - Tech preferences (the architect decides those)
   - Future features or nice-to-haves

5. Spawn Task(sdd-scaffold) with a brief containing:
   - All 7 answers
   - All clarifying answers collected in Phase 2 (or note "developer skipped")
   - Paths of any existing brief/requirements files found in step 3
   - The project directory path

6. When the subagent returns:
   - Show the developer: which files were created
   - Show the Open Decisions list from the subagent's summary
   - Say: "Review constitution.md, resolve the open decisions, then type /sdd-run to start."
```

**`data/integration/claude-code/agents/sdd-scaffold.md`**
```yaml
---
name: sdd-scaffold
description: Generates constitution.md, ai-sdd.yaml, workflow config, and docs/init-report.md
             from a project brief and 6 structured answers. Run via /sdd-scaffold skill only.
tools: Read, Write, Bash, Glob
---
You are the ai-sdd scaffolding agent. You receive a structured project brief and generate
the configuration and documentation needed to start an ai-sdd workflow.

Your inputs (passed in your task brief):
- Answer 1: what is being built
- Answer 2: target platform(s)
- Answer 3: tech stack preferences
- Answer 4: safety-critical features (yes/no + description)
- Answer 5: compliance requirements
- Answer 6: project scale
- Answer 7: fixed constraints (non-negotiable rules, existing systems, SLAs, etc.)
- Clarifying answers from Phase 2 (may be empty if developer skipped)
- Paths of any existing requirements/brief files in the project

When the developer skipped Phase 2 or answers are still incomplete after clarification:
- Apply reasonable defaults for anything not specified
- Document every assumption in constitution.md ## Open Decisions with the assumption
  you made and a note that the developer should confirm it
- Do NOT block or fail — generate the best possible artifacts from available information

Your job:
1. Read any existing brief files listed in your task inputs.
2. Write constitution.md using the template below. Fill every section from the brief.
   Do NOT leave placeholder text. Where you cannot determine something, put it in the
   "Open Decisions" section with a clear question the developer must answer.
3. Write .ai-sdd/ai-sdd.yaml with settings tuned to the project (see tuning rules below).
4. Write .ai-sdd/workflows/default-sdd.yaml using the most appropriate base workflow
   with overrides for safety-critical or compliance requirements.
5. Run `ai-sdd validate-config` via Bash. If it fails, fix the config and retry.
6. Write docs/init-report.md (see template below).
7. Return a summary: files created, open decisions list, recommended first step.

--- CONSTITUTION TEMPLATE ---
# Constitution

## Project Purpose
[Clear problem statement: what this system does and for whom]

## Target Users
[Who uses the system directly; who is affected by it]

## Platform & Tech Stack
[Platforms, languages, frameworks, databases, hosting]

## Architecture Constraints
[Non-negotiable constraints: offline requirements, data residency, latency budgets,
 safety requirements, compliance boundaries]

## Standards
[Accessibility, privacy, security baselines that all agents must follow]

## Open Decisions
[List decisions that could not be determined from the brief.
 Each item must be a specific question the developer can answer.
 Example: "Which local LLM model? (Phi-3-mini | Llama 3.2 | Gemma 2B)"]

## Artifact Manifest
<!-- AUTO-GENERATED by ai-sdd engine after each task — do not edit this section -->

--- TUNING RULES ---
Safety-critical (answer 4 = yes):
  → policy_gate T2 on define-requirements and design-l1
  → paired: { enabled: true } on implement
  → confidence: { enabled: true, threshold: 0.85 } on implement

Compliance (answer 5 != none):
  → security.injection_detection_level: quarantine
  → policy_gate T2 on define-requirements

Scale → quickfix:
  → cost_budget_per_run_usd: 5.00; hil: { enabled: false }; base: 01-quickfix
Scale → feature:
  → cost_budget_per_run_usd: 15.00; base: 02-agile-feature
Scale → greenfield:
  → cost_budget_per_run_usd: 25.00; base: 05-greenfield-product
Scale → regulated enterprise:
  → cost_budget_per_run_usd: 50.00; max_rework_iterations: 5; base: 06-regulated-enterprise

Fixed constraints (answer 7):
  → write verbatim into constitution.md ## Architecture Constraints section
  → if technology mandates: note in constitution.md ## Platform & Tech Stack
  → if data residency: note in constitution.md ## Architecture Constraints AND
    add to compliance section in ai-sdd.yaml security config

--- INIT REPORT TEMPLATE ---
# Project Setup Report

## What was scaffolded
[List each file created or updated]

## Open decisions
[Repeat the Open Decisions from constitution.md with brief context for each]

## Steps to start
1. Resolve all open decisions in constitution.md
2. Review and adjust .ai-sdd/ai-sdd.yaml if needed
3. Open project in Claude Code and type /sdd-run

## Configuration rationale
[Explain each non-default setting and why it was chosen based on the project answers]

## What each agent will produce
| Agent | Output | Key decisions it will make |
|---|---|---|
[Fill based on the selected workflow]

## Estimated cost
[Rough estimate based on workflow complexity and cost_budget_per_run_usd]
```

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
    sdd-scaffold.md        ← NEW: scaffolding agent
  skills/
    sdd-run/SKILL.md
    sdd-status/SKILL.md
    sdd-scaffold/SKILL.md  ← NEW: scaffolding skill
```

No changes needed to `installClaudeCode` — it already copies all files from
`data/integration/claude-code/agents/` and `data/integration/claude-code/skills/`.

---

## Test Strategy

- Unit: CLI scaffold command registers and parses all flags correctly
- Unit: scaffold command calls `ai-sdd init` unless `--skip-init` is passed
- Unit: `sdd-scaffold` agent file exists in `data/integration/claude-code/agents/`
- Unit: `sdd-scaffold` skill file exists in `data/integration/claude-code/skills/sdd-scaffold/`
- Integration: `ai-sdd init --tool claude_code` copies sdd-scaffold agent and skill
- Manual: Run `/sdd-scaffold` in Claude Code on the elderly-ai-assistant example;
  verify constitution.md is populated, validate-config passes, init-report.md created

## Rollback / Fallback

- If `sdd-scaffold` subagent cannot determine a value, it puts it in `Open Decisions`
  rather than guessing — the developer resolves before running `/sdd-run`
- If `ai-sdd validate-config` fails after generation, the subagent retries once with
  corrected config; if it still fails, it writes the error to init-report.md and exits
- Existing `constitution.md` with content is extended (new sections appended), not overwritten
