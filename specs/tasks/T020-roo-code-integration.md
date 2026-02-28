# T020: Roo Code Native Integration

**Phase:** 3 (Native Integration)
**Status:** PENDING
**Dependencies:** T010 (CLI + config), Phase 1 complete
**Size:** M (5 days)

---

## Context

Roo Code supports **custom modes** — configurable agent personas with their own system
prompts and tool access. This maps directly to ai-sdd agent roles.

The integration has two parts:

1. **Static `.roomodes` file** — defines all SDD agent modes as Roo Code personas. Shipped
   as a static template with the framework; constitution handles project-specific context.
   No `generate_modes.py` code generator — static templates work because the agent roles
   are stable; the constitution provides all project-specific context dynamically.

2. **Shared MCP server** — exposes `ai-sdd` engine operations as MCP tools. Used by
   both Roo Code (native MCP support) and Claude Code (via MCP client). Lives in
   `integration/mcp_server/` — not scoped to Roo Code only.

**No `generate_modes.py`**. Roo mode files are static templates shipped with the framework.
**No `install.sh`**. `ai-sdd init --tool roo_code` handles setup.

---

## Acceptance Criteria

```gherkin
Feature: Roo Code native integration

  Scenario: SDD agent modes available in Roo Code
    Given ai-sdd installed with Roo Code integration
    When the user opens the mode switcher in Roo Code
    Then modes sdd-ba, sdd-architect, sdd-pe, sdd-le, sdd-dev, sdd-reviewer are available
    And each mode has the correct persona and tool restrictions

  Scenario: Mode auto-starts workflow loop on activation
    Given Roo Code with the sdd-ba mode and MCP server running
    When the developer switches to "SDD: Business Analyst" mode
    Then the mode immediately calls get_next_task() without waiting for a prompt
    And calls get_constitution() to load context
    And begins the requirements task automatically

  Scenario: Task completed and workflow advanced automatically
    Given the sdd-ba mode has produced requirements.md
    When the mode calls complete_task("define-requirements", path, content)
    Then ai-sdd marks the task COMPLETED in the state file
    And the constitution manifest is updated
    And the mode then calls get_hil_queue() automatically

  Scenario: HIL surfaced and resolved inline without CLI
    Given a PENDING HIL item after task completion
    When the mode calls get_hil_queue() as part of its automatic sequence
    Then the item context is shown to the developer inline in Roo Code
    And the developer approves in the conversation
    And the mode calls resolve_hil_item(id) automatically
    And reports which mode to switch to next

  Scenario: Mode restrictions enforced
    Given Roo Code in "sdd-ba" mode
    When the user requests code generation
    Then the BA mode's system prompt instructs Roo Code to decline
    And it suggests switching to "sdd-dev" mode

  Scenario: MCP server also usable from Claude Code
    Given the shared MCP server running
    When Claude Code connects to it via its MCP client
    Then all the same tools (get_workflow_status, complete_task, etc.) are available
    And behavior is identical to Roo Code's use of the same server
```

---

## Deliverables

### 1. Static `.roomodes` File

Roo Code reads agent mode definitions from a `.roomodes` file in the project root.
This is a JSON file with mode definitions — shipped as a static template.

```json
// .roomodes (static template — shipped with framework)
{
  "customModes": [
    {
      "slug": "sdd-ba",
      "name": "SDD: Business Analyst",
      "roleDefinition": "You are the Business Analyst in an ai-sdd Specification-Driven Development workflow. Translate business needs into formal requirements with Gherkin acceptance criteria. Do NOT write TypeScript code.",
      "groups": ["read", "edit", "browser", "command", "mcp"],
      "customInstructions": "On activation, immediately run this sequence automatically — do not wait for further instructions:\n1. Call MCP get_next_task() — store the returned task_id and output_path.\n2. Call MCP get_constitution() to read project context and the artifact manifest.\n3. Ask the developer any clarifying questions needed for requirements.\n4. Produce requirements.md with functional requirements, NFRs, and Gherkin ACs.\n5. Call MCP complete_task(task_id, output_path, content) using the task_id from step 1.\n6. Call MCP get_hil_queue() to check for pending approvals.\n   If pending: show the item to the developer inline and ask for approval.\n   On approval: call MCP resolve_hil_item(id).\n7. Report: 'Task complete. Switch to SDD: Architect for the next task.'"
    },
    {
      "slug": "sdd-architect",
      "name": "SDD: Architect",
      "roleDefinition": "You are the System Architect in an ai-sdd workflow. Design high-level architecture from requirements. Produce design/l1.md. Do NOT write implementation code or DB migrations.",
      "groups": ["read", "edit", "browser", "command", "mcp"],
      "customInstructions": "On activation, immediately run this sequence automatically:\n1. Call MCP get_next_task() — store the returned task_id and output_path.\n2. Call MCP get_constitution() — note the artifact manifest for input paths.\n3. Read the requirements artifact listed in the manifest.\n4. Produce design/l1.md: module boundaries, REST API surface, schema outline, Docker topology.\n   Justify every major decision with first-principles reasoning.\n5. Call MCP complete_task(task_id, output_path, content) using values from step 1.\n6. Call MCP get_hil_queue() and handle any HIL inline.\n7. Report: 'Architecture complete. Switch to SDD: Principal Engineer.'"
    },
    {
      "slug": "sdd-pe",
      "name": "SDD: Principal Engineer",
      "roleDefinition": "You are the Principal Engineer. Produce detailed component specifications (design/l2.md) from the L1 architecture. Do NOT write implementation code.",
      "groups": ["read", "edit", "command", "mcp"],
      "customInstructions": "On activation, immediately:\n1. Call MCP get_next_task() and get_constitution().\n2. Read design/l1.md from the manifest.\n3. Produce design/l2.md: full Prisma/TypeORM schema, service interfaces, DTOs, DI contracts.\n4. Call MCP complete_task(task_id, output_path, content) using values from get_next_task().\n5. Handle HIL via get_hil_queue() inline.\n6. Report: 'Component design complete. Switch to SDD: Lead Engineer.'"
    },
    {
      "slug": "sdd-le",
      "name": "SDD: Lead Engineer",
      "roleDefinition": "You are the Lead Engineer. Break down the component design into discrete, testable implementation tasks with Gherkin acceptance criteria.",
      "groups": ["read", "edit", "command", "mcp"],
      "customInstructions": "On activation, immediately:\n1. Call MCP get_next_task() and get_constitution().\n2. Read design/l2.md from the manifest.\n3. Produce implementation/tasks/task-001.md through task-N.md.\n   Each task: description + Gherkin ACs + target files.\n4. Call MCP complete_task(task_id, output_path, content) for the task group using values from get_next_task().\n5. Handle HIL inline.\n6. Report: 'Task breakdown complete. Switch to SDD: Developer.'"
    },
    {
      "slug": "sdd-dev",
      "name": "SDD: Developer",
      "roleDefinition": "You are the Developer. Implement TypeScript code to satisfy implementation task specs. Write Jest tests first (BDD). Use Prisma Client — no raw SQL.",
      "groups": ["read", "edit", "command", "mcp"],
      "customInstructions": "On activation, immediately:\n1. Call MCP get_next_task() and get_constitution().\n2. Read the current implementation task from the manifest.\n3. Write tests first, then implementation. TypeScript strict mode.\n4. Run `pnpm test -- --coverage` and `pnpm lint` in the terminal.\n   If tests fail or lint fails: fix before marking complete.\n5. Call MCP complete_task(task_id, output_path, content) using values from get_next_task().\n6. Handle HIL inline.\n7. Report: 'Implementation complete. Switch to SDD: Reviewer.'"
    },
    {
      "slug": "sdd-reviewer",
      "name": "SDD: Reviewer",
      "roleDefinition": "You are the Reviewer. Evaluate artifacts against the constitution Standards. Issue GO or NO_GO with specific rework feedback. Do NOT modify any artifacts.",
      "groups": ["read", "command", "mcp"],
      "customInstructions": "On activation, immediately:\n1. Call MCP get_next_task() — store the returned task_id and output_path.\n2. Call MCP get_constitution() — read Standards section (your review criteria).\n3. Read the artifact under review from the output_path in the manifest.\n4. Issue your decision as JSON: { \"decision\": \"GO\" | \"NO_GO\", \"feedback\": \"...\" }\n   NO_GO must include specific, actionable rework instructions.\n   Note: parallel review tasks (review-l1-ba, review-l1-pe, review-l1-le) each have a\n   separate task_id — always use the task_id returned by get_next_task().\n5. Call MCP complete_task(task_id, output_path, decision_json) using values from step 1.\n6. If GO: report 'Review passed.'\n   If NO_GO: report 'Rework required. Switch to SDD: Developer with the feedback above.'"
    }
  ]
}
```

### 2. Shared MCP Server (`integration/mcp_server/`)

Wraps existing `ai-sdd` CLI operations as MCP tools. Used by both Roo Code and Claude Code.

```python
# integration/mcp_server/server.py
# ~100 lines. No reimplementation — all tools delegate to ai-sdd CLI via subprocess.

@mcp.tool()
def get_workflow_status() -> dict:
    """Return current workflow state (all task statuses)."""
    return _run_cli(["ai-sdd", "status", "--json"])

@mcp.tool()
def get_next_task() -> dict:
    """Return the next READY task."""
    return _run_cli(["ai-sdd", "status", "--next", "--json"])

@mcp.tool()
def complete_task(task_id: str, output_path: str, output_content: str) -> dict:
    """
    Atomically complete a task: validate path, sanitize, check artifact contract,
    write output, advance workflow state, and update manifest — in one transaction.
    Never writes the file directly; delegates to `ai-sdd complete-task` which owns
    the transaction boundary (path allowlist, sanitization, contract, state mutation).
    """
    import tempfile, os
    with tempfile.NamedTemporaryFile(mode="w", suffix=".tmp", delete=False) as f:
        f.write(output_content)
        tmp_path = f.name
    try:
        return _run_cli([
            "ai-sdd", "complete-task",
            "--task", task_id,
            "--output-path", output_path,   # validated against allowlist by engine
            "--content-file", tmp_path,
        ])
    finally:
        os.unlink(tmp_path)

@mcp.tool()
def get_hil_queue() -> list[dict]:
    """Return all PENDING HIL queue items."""
    return _run_cli(["ai-sdd", "hil", "list", "--json"])

@mcp.tool()
def resolve_hil_item(item_id: str, notes: str = "") -> dict:
    return _run_cli(["ai-sdd", "hil", "resolve", item_id, "--notes", notes])

@mcp.tool()
def reject_hil_item(item_id: str, reason: str) -> dict:
    return _run_cli(["ai-sdd", "hil", "reject", item_id, "--reason", reason])

@mcp.tool()
def get_constitution(task_id: str = "") -> str:
    """Return the merged constitution as markdown text (includes artifact manifest)."""
    return _run_cli_text(["ai-sdd", "constitution", "--task", task_id] if task_id
                         else ["ai-sdd", "constitution"])

def _run_cli(args: list[str]) -> Any:
    """Run CLI command and parse JSON output. Used by all tools except get_constitution."""
    result = subprocess.run(args, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)

def _run_cli_text(args: list[str]) -> str:
    """Run CLI command and return raw text output. Used by get_constitution."""
    result = subprocess.run(args, capture_output=True, text=True, check=True)
    return result.stdout
```

Started via:
```bash
ai-sdd serve --mcp --port 3000
```

### 3. MCP Server Config for Roo Code

```json
// .roo/mcp.json
{
  "mcpServers": {
    "ai-sdd": {
      "command": "ai-sdd",
      "args": ["serve", "--mcp"],
      "env": {}
    }
  }
}
```

### 4. Install via CLI (no install.sh)

```bash
# Add Roo Code integration to a project
ai-sdd init --tool roo_code --project /path/to/project

# Copies:
#   .roomodes          (static agent mode definitions)
#   .roo/mcp.json      (MCP server config)
#   .ai-sdd/           (framework config, if not present)
```

---

## File Structure

```
integration/
├── mcp_server/                       # Shared — used by Roo Code + Claude Code
│   ├── server.py
│   ├── README.md
│   └── tests/
│       └── test_mcp_server.py
└── roo_code/
    ├── README.md
    ├── .roomodes.template             # Static agent mode definitions
    └── mcp_config.json.template       # .roo/mcp.json template
```

---

## Files to Create

- `integration/mcp_server/server.py`
- `integration/mcp_server/README.md`
- `integration/roo_code/README.md`
- `integration/roo_code/.roomodes.template`
- `integration/roo_code/mcp_config.json.template`
- `tests/integration/test_mcp_server.py`
- `tests/integration/test_roo_code_integration.py`

---

## Test Strategy

- Unit tests: each MCP tool delegates correctly to `ai-sdd` CLI; output parsed correctly.
- Unit tests: `_run_cli` raises AdapterError on non-zero exit.
- Integration test: `complete_task` writes file and advances workflow state.
- Integration test: `get_hil_queue` returns correct items; `resolve_hil_item` unblocks.
- Manual validation: Run sdd-ba → sdd-architect workflow inside Roo Code with MCP active.

## Rollback/Fallback

- If MCP server fails to start: `ai-sdd run` still works via CLI; MCP is additive.
- If `.roomodes` already exists: `ai-sdd init` prompts before overwriting.
