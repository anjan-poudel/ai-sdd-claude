# T019: OpenAI / Codex Integration

**Phase:** 3 (Native Integration)
**Status:** PENDING
**Dependencies:** T010 (CLI + config), Phase 1 complete
**Size:** M (4 days) *(Jinja2 and install.sh removed)*

---

## Context

This task covers two complementary integration paths for OpenAI-based tools:

1. **`codex` CLI** (OpenAI's open-source agentic CLI tool) — same pattern as Claude Code:
   instructions via a config file, agent executes tasks by calling `ai-sdd` CLI via shell tools.

2. **OpenAI API direct** (`CodexAdapter`) — for programmatic/CI use: calls OpenAI chat
   completions with agent persona as system message and task context as user message.
   Uses OpenAI function calling for structured task outputs.

**No Jinja2**. System prompts are assembled with plain Python string formatting using the
same `AgentContext` object the engine already produces.

---

## Acceptance Criteria

```gherkin
Feature: OpenAI / Codex integration

  Scenario: codex CLI executes a task natively
    Given a project with .ai-sdd/ and AGENTS.md configured
    When the codex CLI session starts
    Then it reads the active workflow task from constitution.md
    And executes the task using its native shell and file tools
    And advances the workflow with `ai-sdd run --task <id>`

  Scenario: CodexAdapter dispatches task via OpenAI API
    Given ai-sdd configured with adapter: openai
    When a task is dispatched
    Then CodexAdapter builds a chat completion request
    With system message = agent persona from agent YAML
    And user message = assembled task context (constitution + inputs)
    And tool definitions for structured output

  Scenario: Function calling captures structured task output
    Given a task with declared output contract
    When the OpenAI model calls the write_task_output function
    Then CodexAdapter captures the file_path and content
    And writes the output to the declared path
    And returns a TaskResult with the written artifact

  Scenario: Error taxonomy maps OpenAI errors correctly
    Given an HTTP 429 (rate limit) from the OpenAI API
    When CodexAdapter receives it
    Then it returns AdapterError(error_type="rate_limit", retry_after=<Retry-After>)

  Scenario: Token usage captured for cost tracking
    Given a successful OpenAI API response with usage.total_tokens
    When CodexAdapter processes the response
    Then token count and estimated cost are emitted in observability

  Scenario: Init command sets up project for codex CLI
    When the user runs `ai-sdd init --tool codex --project /path`
    Then the project receives: AGENTS.md and .ai-sdd/ config
    And no install.sh is involved
```

---

## Deliverables

### 1. AGENTS.md Template (for codex CLI)

The `codex` CLI reads `AGENTS.md` from the project root on startup — equivalent to
Claude Code's `CLAUDE.md`. The key difference from CLAUDE.md is that `AGENTS.md`
contains an **autonomous workflow loop** instruction. Once `codex` starts, it runs
the entire SDD workflow without the developer typing any further commands — only
answering questions and approving HIL gates.

```markdown
# AGENTS.md

## Project
This project uses ai-sdd for Specification-Driven Development.
Stack: TypeScript, NestJS, Prisma, PostgreSQL, Jest, Docker Compose.

## Autonomous Workflow Loop
When you start, immediately enter this loop and keep running until the workflow
is complete or the developer explicitly asks you to stop:

1. Run `ai-sdd status --json` to find the next READY task and its required agent role.
2. Read `constitution.md` to get the project context and artifact manifest.
3. The `ai-sdd status --json` output includes an `agent` field for each READY task.
   Use the `agent` field to determine your role — do not infer it from the task name.
   Role descriptions:
   - agent: ba       → Business Analyst: requirements.md with Gherkin ACs
   - agent: architect → Architect: design/l1.md (modules, REST API, schema outline)
   - agent: pe       → Principal Engineer: design/l2.md (component specs, DTOs)
   - agent: le       → Lead Engineer: implementation/tasks/*.md with Gherkin ACs
   - agent: dev      → Developer: TypeScript implementation + Jest tests
   - agent: reviewer → Reviewer: GO/NO_GO decision against constitution Standards

   Note: multiple tasks may be READY simultaneously (e.g. review-l1-ba, review-l1-pe,
   review-l1-le all become READY after design-l1). Execute them one at a time in the
   order returned by ai-sdd status.
4. Read the input artifacts listed in the manifest for your current task.
5. Execute the task: produce and write the required output artifact.
6. Run `ai-sdd run --task <task-id>` to advance the workflow.
7. Run `ai-sdd hil list --json` to check for pending approvals.
   If PENDING: present the item to the developer and wait for their decision.
   On approval: run `ai-sdd hil resolve <id>`.
   On rejection: run `ai-sdd hil reject <id> --reason "<reason>"`.
8. Return to step 1.

## Role Rules
- Business Analyst: do not write code.
- Architect: do not write implementation code or migrations.
- Reviewer: do not modify artifacts; issue GO/NO_GO only.
- Developer: write Jest tests before implementation. TypeScript strict mode.

## SDD Standards
- Gherkin acceptance criteria on all requirements.
- First-principles justification for architectural decisions.
- ESLint + Prettier enforced; Jest 80% minimum coverage.
```

### 2. CodexAdapter (OpenAI API direct)

```python
class OpenAIAdapter(RuntimeAdapter):
    """
    Dispatches tasks to OpenAI models via Chat Completions API.
    Uses function calling for structured task output capture.
    No Jinja2 — prompt assembly uses plain string formatting.
    """
    def dispatch(self, task: Task, context: AgentContext,
                 operation_id: str, attempt_id: str) -> TaskResult:
        response = self.client.chat.completions.create(
            model=task.agent.llm.model,
            messages=[
                {"role": "system", "content": self._system_prompt(task, context)},
                {"role": "user",   "content": self._user_prompt(task, context)},
            ],
            tools=WRITE_OUTPUT_TOOL_DEFINITION,
        )
        return self._parse(response, task)

    def _system_prompt(self, task: Task, context: AgentContext) -> str:
        agent = task.agent
        return (
            f"You are {agent.display_name} in an ai-sdd workflow.\n\n"
            f"## Role\n{agent.role.description}\n\n"
            f"## Expertise\n" + "\n".join(f"- {e}" for e in agent.role.expertise) + "\n\n"
            f"## Project Constitution\n{context.constitution}"
        )

    def _user_prompt(self, task: Task, context: AgentContext) -> str:
        inputs = "\n".join(f"- {p}: {c}" for p, c in context.task_inputs.items())
        return (
            f"Execute task: {task.id}\n"
            f"Description: {task.description}\n\n"
            f"## Inputs\n{inputs}\n\n"
            f"## Expected Output\n{task.outputs}"
        )
```

### 3. Tool Definition for Structured Output

```json
// integration/openai/write_output_tool.json
{
  "type": "function",
  "function": {
    "name": "write_task_output",
    "description": "Write the completed task artifact to a file path",
    "parameters": {
      "type": "object",
      "properties": {
        "file_path": {
          "type": "string",
          "description": "Relative path for the output file (e.g. design/l1.md)"
        },
        "content": {
          "type": "string",
          "description": "Full content of the artifact"
        }
      },
      "required": ["file_path", "content"]
    }
  }
}
```

Additional tools for workflow state operations (same ones used by Roo Code via MCP — see T020):

```json
// integration/openai/workflow_tools.json
[get_workflow_status, get_next_task, get_hil_queue, resolve_hil_item]
```

These are the same tool schemas as the MCP server (T020). Kept in a shared
`integration/shared/tool_schemas/` directory.

### 4. Install via CLI (no install.sh)

```bash
# Add OpenAI/Codex integration to a project
ai-sdd init --tool codex --project /path/to/project

# Copies:
#   AGENTS.md          (project root — codex CLI reads this)
#   .ai-sdd/           (framework config, if not present)
```

---

## File Structure

```
integration/
├── shared/
│   └── tool_schemas/
│       ├── write_output_tool.json       # Shared: OpenAI + MCP
│       ├── workflow_tools.json          # Shared: get_status, hil, etc.
│       └── README.md
└── openai/
    ├── README.md
    ├── AGENTS.md.template               # For codex CLI
    └── examples/
        ├── minimal_workflow.yaml
        └── high_assurance_workflow.yaml
```

---

## Files to Create

- `adapters/openai_adapter.py`
- `integration/shared/tool_schemas/write_output_tool.json`
- `integration/shared/tool_schemas/workflow_tools.json`
- `integration/openai/README.md`
- `integration/openai/AGENTS.md.template`
- `integration/openai/examples/minimal_workflow.yaml`
- `tests/integration/test_openai_adapter.py`

---

## Test Strategy

- Unit tests: `_system_prompt()` and `_user_prompt()` produce correct strings for all 6 agent types.
- Unit tests: `AdapterError` taxonomy — rate_limit, context_limit, content_policy.
- Unit tests: token count extracted from `usage.total_tokens`; cost estimated.
- Integration test (mock OpenAI): adapter sends correct request; function call captured.
- Manual validation: BA task dispatched to `gpt-4o`; requirements.md produced.

## Rollback/Fallback

- If `OPENAI_API_KEY` not set: clear error at init time.
- If model not available: error with model name; no silent fallback.
