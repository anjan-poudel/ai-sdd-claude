# Example: Elderly AI Assistant

How to use ai-sdd to generate the code for the Elderly AI Assistant app and backend.
Source requirements: `examples/elderly-ai-assistant/requirements.md`

or
use @examples/elderly-ai-assistant/requirements.md to generate plans and create tasks under the same @examples/elderly-ai-assistant folder.
Configure it to require HIL before starting implementation phase (tasks implementation.

---

## Steps

**1. Init the project**
```bash
ai-sdd init --tool claude_code --project examples/elderly-ai-assistant
```

**2. Fill `constitution.md`** — the most critical upfront artifact (see below)

**3. Choose workflow** — use `greenfield-product`. Copy it:
```bash
cp data/workflows/examples/05-greenfield-product.yaml \
   examples/elderly-ai-assistant/.ai-sdd/workflows/default-sdd.yaml
```

**4. Tune `.ai-sdd/ai-sdd.yaml`** — bump risk tiers and HIL for safety-critical features (see config section below)

**5. Open project in Claude Code → `/sdd-run`**

---

## Upfront artifacts to create before running

### `constitution.md`

Must answer these before the BA starts:

```markdown
# Constitution

## Project Purpose
AI personal assistant for elderly non-English-speaking users. Runs 24/7 on iOS/Android.
Acts as a voice-first interface to phone functions, health monitoring, scheduling,
media, and emergency services. Configured remotely by family members.

## Target Users
- Primary: elderly (60+), non-English-speaking background, limited tech literacy
- Secondary: adult children who configure and monitor the app remotely

## Platform Decisions  ← decide these before running
- Mobile: [React Native | Flutter | Swift+Kotlin native]
- Local LLM: [Phi-3-mini | Llama 3.2 3B | Gemma 2B | MLX on iPhone]
- Backend: [Node/Bun | Python FastAPI | Firebase]
- Voice STT: [Whisper local | Azure Speech | Google Speech]
- Remote config: [Firebase Remote Config | custom API]

## Architecture Constraints
- Local LLM runs on-device; no cloud for private conversations
- Must work offline for core functions (reminders, calls, local schedule)
- Emergency pipeline must be < 3s from trigger to call initiation
- All health data stays on device; only telemetry metadata to backend

## Standards
- Accessibility: WCAG 2.1 AA minimum; large text, high contrast, simple UI
- Privacy: no voice recordings stored without explicit consent; GDPR/APPs Act compliant
- Safety: emergency feature requires double-confirmation to avoid false triggers
- Languages: must support [list target languages/dialects] from day one

## Security
- Voice biometric as primary auth; 4-digit PIN as fallback
- Remote config authenticated via family member account (OAuth)
- All backend comms TLS 1.3; health data encrypted at rest

## Integrations (scope these before architecture starts)
- [ ] Apple HealthKit / Google Health Connect
- [ ] Google Calendar
- [ ] WhatsApp (via Business API or deep link)
- [ ] YouTube (deep link or embed)
- [ ] Emergency services (SOS call + SMS)
- [ ] Push notifications for remote config updates
```

### Key decisions to make before the BA task runs

| Decision | Why it matters |
|---|---|
| Mobile platform (RN / Flutter / native) | Determines local LLM integration path; HealthKit only on Swift |
| Local LLM model | Affects memory, latency, accent fine-tuning approach |
| Which languages/dialects to support at launch | Scopes the voice training requirement entirely |
| Backend hosting (Firebase vs custom) | Affects remote config and telemetry architecture |
| WhatsApp integration approach | Business API requires approval; deep link is simpler but limited |
| Emergency trigger mechanism | False-positive policy — who can override? |

---

## Configuration / tuning params

### `.ai-sdd/ai-sdd.yaml`

```yaml
version: "1"

adapter:
  type: claude_code
  dispatch_mode: delegation

engine:
  max_concurrent_tasks: 2          # keep low — tasks are complex and interdependent
  cost_budget_per_run_usd: 25.00   # large greenfield project
  cost_enforcement: pause          # pause and ask before exceeding

overlays:
  hil:
    enabled: true
    notify:
      on_t2_gate:
        - "echo 'Sign-off needed: $TASK_ID'"  # replace with your notification method

security:
  injection_detection_level: warn

observability:
  log_level: INFO
```

### `.ai-sdd/workflows/default-sdd.yaml` overrides

```yaml
# Bump requirements and architecture to T2 — safety-critical system
  define-requirements:
    use: define-requirements
    overlays:
      policy_gate: { risk_tier: T2 }   # emergency features need formal sign-off

  design-l1:
    use: design-architecture
    overlays:
      policy_gate: { risk_tier: T2 }   # on-device LLM + health API architecture needs review

# Paired review on implementation — novel AI integration
  implement:
    use: standard-implement
    depends_on: [plan-tasks]
    overlays:
      paired: { enabled: false }
      confidence: { enabled: true, threshold: 0.80 }
    max_rework_iterations: 5
```

---

## What each agent will produce

| Agent | Output | Key decisions it will make |
|---|---|---|
| BA | `requirements.md` | Full feature list, Gherkin ACs per feature, NFRs, accessibility requirements, out-of-scope items |
| Architect | `architecture-l1.md` | On-device vs cloud LLM split, health API integration pattern, emergency pipeline design, remote config architecture |
| PE | `component-design-l2.md` | Voice pipeline components, LLM inference module, reminder engine, health monitor, config sync service |
| LE | `task-breakdown-l3.md` | Sprint-ordered implementation tasks with acceptance criteria |
| Dev | Code + `implementation-notes.md` | Working app per spec |
| Reviewer | `review-*.md` | GO/NO_GO at each gate |

The HIL gates at requirements and architecture (T2) are where you approve before the
system proceeds — the right moments to course-correct on platform choice, scope, or
safety policy before any code is written.
