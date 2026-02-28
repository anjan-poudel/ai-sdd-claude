# T018: Claude Code Native Integration

**Phase:** 3 (Native Integration)
**Status:** PENDING
**Dependencies:** T010 (CLI + config), Phase 1 complete
**Size:** S (4 days)

---

## Context

After `ai-sdd init --tool claude_code`, the developer never runs any `ai-sdd` CLI
commands directly. The framework works entirely under the hood through two mechanisms:

1. **One subagent per SDD role** (`.claude/agents/`) — each subagent knows its role,
   reads what it needs from the artifact manifest, produces its output, and advances
   the workflow via Bash tool internally.

2. **One orchestrating skill** (`.claude/skills/sdd-run/`) — `/sdd-run` checks workflow
   state, spawns the correct subagent for the active task, handles HIL inline in the
   conversation, and loops. Developer never needs to know which subagent to call or
   when to run `ai-sdd hil resolve`.

**Integration model:**
```
Developer types: /sdd-run
    │
    ▼
sdd-run skill (context: fork — isolated subagent context):
  1. Bash: ai-sdd status --json         → identifies next READY task + agent role
  2. Spawns matching subagent           → e.g. Task(sdd-architect)
      │
      ▼
  sdd-architect subagent (own context window):
    → Read: constitution.md             (manifest + project rules)
    → Read: artifact paths from manifest
    → Produces and writes the artifact
    → Bash: ai-sdd run --task design-l1  ← invisible to developer
    → Returns summary to sdd-run skill
      │
      ▼
  3. Bash: ai-sdd hil list --json       → checks for pending approvals
     If HIL pending:
       Presents item to developer inline: "Architecture ready — approve? [yes/no]"
       On "yes": Bash: ai-sdd hil resolve <id>   ← invisible
  4. Shows status table
  5. Asks: "Continue to next task?"

Headless / CI:
  ai-sdd engine → ClaudeCodeAdapter → subprocess `claude --print --prompt-file`
```

---

## Acceptance Criteria

```gherkin
Feature: Claude Code native integration

  Scenario: /sdd-run orchestrates the full workflow without developer CLI input
    Given a project initialised with ai-sdd
    When the developer types /sdd-run
    Then the skill identifies the next READY task automatically
    And spawns the correct role subagent (e.g. sdd-ba for define-requirements)
    And the subagent executes the task and advances the workflow internally
    And HIL approvals surface inline in the conversation
    And the developer never types any ai-sdd CLI commands

  Scenario: Subagent advances workflow internally
    Given the sdd-architect subagent is running
    When it completes design/l1.md
    Then it runs `ai-sdd run --task design-l1` via its own Bash tool
    And the workflow state is updated
    And it returns a summary to the /sdd-run skill

  Scenario: HIL handled inline without /sdd-hil command
    Given a HIL gate is pending after task completion
    When the sdd-run skill checks for HIL
    Then it presents the approval request inline in the conversation
    And on developer approval runs `ai-sdd hil resolve <id>` automatically
    And continues to the next task without developer typing any CLI command

  Scenario: Role restrictions enforced by subagent definition
    Given the sdd-architect subagent is active
    When it is asked to write implementation code
    Then its subagent definition (tools: Read Write Bash Glob Grep) and role instructions
         prevent it from straying outside architecture scope

  Scenario: Headless adapter for CI
    Given ai-sdd running in CI with adapter: claude_code
    When a task is dispatched
    Then ClaudeCodeAdapter calls `claude --print --prompt-file <path>` as a subprocess
    And captures the output as the task result
```

---

## Deliverables

### 1. SDD Role Subagents (`.claude/agents/`)

One file per agent role. Each subagent knows to advance the workflow when done.

**`.claude/agents/sdd-ba.md`**
```yaml
---
name: sdd-ba
description: Business Analyst — produces requirements.md from project brief
tools: Read, Write, Bash, Glob, Grep
---
You are the Business Analyst in an ai-sdd Specification-Driven Development workflow.

Your job:
1. Read constitution.md to understand the project context.
2. Ask the developer clarifying questions about requirements.
3. Write .ai-sdd/outputs/requirements.md with functional requirements,
   NFRs, and Gherkin acceptance criteria for each feature.

When your output is written:
- Run `ai-sdd run --task define-requirements` via Bash to advance the workflow.
- Return a summary: how many requirements captured, key decisions made.

Do NOT write code. Do NOT design architecture. Stay within BA scope.
```

**`.claude/agents/sdd-architect.md`**
```yaml
---
name: sdd-architect
description: System Architect — produces design/l1.md from requirements
tools: Read, Write, Bash, Glob, Grep
---
You are the System Architect in an ai-sdd workflow.

Your job:
1. Read constitution.md — note the artifact manifest for available inputs.
2. Read .ai-sdd/outputs/requirements.md.
3. Write .ai-sdd/outputs/design/l1.md covering:
   - Module boundaries and responsibilities
   - REST API surface with OpenAPI paths
   - Data model outline (schema/entities)
   - Infrastructure topology (Docker services)
   - Auth strategy

When your output is written:
- Run `ai-sdd run --task design-l1` via Bash.
- Return a summary of key architectural decisions.

Do NOT write implementation code or database migrations.
```

*(sdd-pe, sdd-le, sdd-dev, sdd-reviewer follow the same pattern — role-specific
instructions + `ai-sdd run --task <id>` at the end.)*

**`.claude/agents/sdd-reviewer.md`**
```yaml
---
name: sdd-reviewer
description: Reviewer — issues GO/NO_GO on task outputs against constitution Standards
tools: Read, Bash, Glob, Grep
---
You are the Reviewer in an ai-sdd workflow.

Your job:
1. Read constitution.md → Standards section defines your review criteria.
2. Read the artifact being reviewed (path from constitution manifest).
3. Issue a structured decision:
   GO:    "All criteria met. [brief summary]"
   NO_GO: "Rework required: [specific feedback]"

When your decision is made:
- Run `ai-sdd run --task review-code` via Bash.
- Return your full review decision.

Do NOT modify artifacts. Read-only review only.
```

### 2. Orchestrating Skill (`.claude/skills/sdd-run/SKILL.md`)

```yaml
---
name: sdd-run
description: Run the ai-sdd SDD workflow. Spawns the correct agent for the active task,
             handles HIL approvals inline, and loops. Use this to drive the full workflow.
disable-model-invocation: false
context: fork
allowed-tools: Bash, Task
---
Run the ai-sdd SDD workflow. Follow these steps:

1. Run `ai-sdd status --json` via Bash to find the next READY task and its agent role.

2. Spawn the matching subagent using the Task tool based on the task's agent field
   returned by `ai-sdd status --json`. The agent field is the source of truth —
   do not hardcode task-name → agent mappings. Examples from the default workflow:
   - define-requirements → agent: ba       → Task(sdd-ba)
   - design-l1           → agent: architect → Task(sdd-architect)
   - review-l1-ba        → agent: ba       → Task(sdd-ba)   ┐ parallel:
   - review-l1-pe        → agent: pe       → Task(sdd-pe)   ┤ all three READY
   - review-l1-le        → agent: le       → Task(sdd-le)   ┘ after design-l1
   - design-l2           → agent: pe       → Task(sdd-pe)
   - design-l3           → agent: le       → Task(sdd-le)
   - implement           → agent: dev      → Task(sdd-dev)
   - review-code         → agent: reviewer → Task(sdd-reviewer)

   If multiple tasks are READY simultaneously (e.g. the parallel review tasks),
   spawn them sequentially one at a time and collect all results before continuing.

3. After the subagent returns, run `ai-sdd hil list --json` via Bash.
   If any PENDING HIL items:
   - Show the item context to the developer.
   - Ask: "Approve to continue? [yes/no]"
   - On yes: run `ai-sdd hil resolve <id>` via Bash.
   - On no:  run `ai-sdd hil reject <id> --reason "<reason>"` via Bash.

4. Run `ai-sdd status --json` again and show the updated workflow table.

5. Ask the developer: "Continue to next task? [yes/no/done]"
   - yes  → repeat from step 1
   - no   → stop and show final status
   - done → workflow complete
```

### 3. Supporting Skills

**`.claude/skills/sdd-status/SKILL.md`**
```yaml
---
name: sdd-status
description: Show the current ai-sdd workflow progress and cost summary
allowed-tools: Bash
---
Run `ai-sdd status --metrics` and display the results as a formatted table.
Highlight any FAILED or HIL_PENDING tasks in the output.
```

### 4. CLAUDE.md Template

```markdown
# CLAUDE.md

## Project: ai-sdd Specification-Driven Development

This project uses ai-sdd. The framework runs under the hood — you do not need to
run any ai-sdd commands manually.

## How to use
- Type `/sdd-run` to execute the next workflow task.
- Answer clarifying questions and approve HIL gates as they appear.
- Type `/sdd-status` to check progress at any time.

## Project context
See `constitution.md` for project purpose, rules, standards, and the artifact manifest.
```

### 5. ClaudeCodeAdapter (headless/CI only)

```python
class ClaudeCodeAdapter(RuntimeAdapter):
    """Headless/CI use only. Interactive sessions use /sdd-run skill + subagents."""
    def dispatch(self, task: Task, context: AgentContext,
                 operation_id: str, attempt_id: str) -> TaskResult:
        prompt_path = self._write_prompt_file(task, context)
        result = subprocess.run(
            ["claude", "--print", "--prompt-file", str(prompt_path)],
            capture_output=True, text=True, timeout=self.timeout_seconds
        )
        return self._parse_result(result, task)
```

---

## What `ai-sdd init --tool claude_code` Creates

```
.claude/
  agents/
    sdd-ba.md            ← BA subagent
    sdd-architect.md     ← Architect subagent
    sdd-pe.md            ← PE subagent
    sdd-le.md            ← LE subagent
    sdd-dev.md           ← Dev subagent
    sdd-reviewer.md      ← Reviewer subagent (read-only tools)
  skills/
    sdd-run/
      SKILL.md           ← orchestrator (spawns subagents, handles HIL)
    sdd-status/
      SKILL.md           ← progress table
CLAUDE.md                ← lightweight orientation (appended if exists)
constitution.md          ← blank template (developer fills in)
.ai-sdd/
  ai-sdd.yaml
  workflows/default-sdd.yaml
```

---

## Files to Create

- `integration/claude_code/agents/sdd-ba.md`
- `integration/claude_code/agents/sdd-architect.md`
- `integration/claude_code/agents/sdd-pe.md`
- `integration/claude_code/agents/sdd-le.md`
- `integration/claude_code/agents/sdd-dev.md`
- `integration/claude_code/agents/sdd-reviewer.md`
- `integration/claude_code/skills/sdd-run/SKILL.md`
- `integration/claude_code/skills/sdd-status/SKILL.md`
- `integration/claude_code/CLAUDE.md.template`
- `integration/claude_code/README.md`
- `adapters/claude_code_adapter.py` (headless path only)
- `tests/integration/test_claude_code_adapter.py`

---

## Test Strategy

- Unit tests: `ClaudeCodeAdapter` writes correct prompt file format.
- Unit tests: `ai-sdd init --tool claude_code` copies all agent + skill files.
- Integration test: `/sdd-run` skill spawns correct subagent per task type.
- Integration test: HIL item surfaced inline; resolved without manual CLI command.
- Manual validation: Run full BA → Architect workflow in Claude Code — zero manual `ai-sdd` commands typed.

## Rollback/Fallback

- If `claude` binary not in PATH: `ClaudeCodeAdapter` raises clear error; falls back to MockAdapter in tests.
- If agent or skill files already exist: `ai-sdd init` prompts before overwriting.
