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
   Type → or 'skip' at any time to stop. I'll ask for confirmation first."

   Review all 7 answers and any existing brief files for:
   a) Answers too vague to generate a useful artifact
   b) Conflicts between answers (e.g. "Firebase" in Q3 AND "no public cloud" in Q7)
   c) Missing critical information that cannot be reasonably defaulted

   Ask only the necessary clarifying questions. Maximum 5.

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
