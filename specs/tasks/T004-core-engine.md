# T004: Core Engine — Orchestrator, State Manager, and Context Assembler

**Phase:** 1 (Core Engine)
**Status:** PENDING
**Dependencies:** T001 (agent system), T002 (workflow system), T003 (constitution system)
**Changes from synthesized-claude:** RuntimeAdapter signature uses `operation_id`/`attempt_id` (not `idempotency_key`); post-task hook registers manifest writer; concurrency budget config added; context assembly note updated (pull model).

---

## Context

The core engine ties together the agent system, workflow DAG, and constitution system. It is responsible for:

1. Loading the workflow and resolving the execution plan.
2. Persisting task state to disk (so workflows can be resumed after interruption).
3. Dispatching each ready task to its configured agent via a `RuntimeAdapter`.
4. Assembling agent context (merged constitution including artifact manifest + handover state).
5. Exposing hooks for overlays and integrations (pre-task, post-task, on-failure, on-loop-exit).

The engine is runtime-agnostic — it dispatches through an adapter interface. No business logic lives in the engine. Context management uses the **pull model**: the constitution manifest tells agents what exists; agents fetch what they need via their native tools.

---

## Acceptance Criteria

```gherkin
Feature: Core engine execution

  Scenario: Full pipeline execution
    Given a valid workflow with tasks A → B → C
    When `engine.run()` is called
    Then tasks execute in dependency order
    And each task receives its inputs and produces its outputs
    And all tasks reach COMPLETED status

  Scenario: State persistence between runs
    Given a workflow where task A is COMPLETED and task B is PENDING
    When the engine is started fresh (simulating a crash/restart)
    Then the engine loads state from disk
    And skips task A (already COMPLETED)
    And continues from task B

  Scenario: Failed task halts downstream
    Given task A fails during execution
    When the engine detects the failure
    Then task A's status is set to FAILED
    And all tasks that depend on A are NOT executed
    And the engine emits an on-failure event

  Scenario: Parallel task execution within concurrency budget
    Given tasks B and C both depend on A but not on each other
    And engine.max_concurrent_tasks=3
    When task A completes
    Then the engine dispatches B and C concurrently (asyncio semaphore)
    And no more than max_concurrent_tasks tasks run simultaneously

  Scenario: Post-task hook fires manifest writer
    Given a post-task hook registered by the manifest writer
    When any task completes
    Then the manifest writer updates the constitution.md artifact manifest
    Before the next task is dispatched

  Scenario: Context assembly uses artifact manifest
    Given task "design-l1" with constitution containing the artifact manifest
    When the engine assembles context for "design-l1"
    Then the assembled context includes: merged constitution (with manifest), handover state
    And does NOT pre-load all prior task output file contents

  Scenario: Runtime adapter decoupling
    Given the engine is initialized with a MockRuntimeAdapter
    When any task is dispatched
    Then the mock adapter records the call with operation_id and attempt_id
    And no real LLM calls are made

  Scenario: Gap audit gate runs before completion
    Given task output is available after agent execution
    When the engine processes post-dispatch completion
    Then `gap_audit` runs before setting task status to COMPLETED
    And a gap audit report is written to `.ai-sdd/outputs/gap-audit-<task-id>.json`
    And if remediable gaps are found task status becomes NEEDS_REWORK
    And if hard gaps are found task status becomes FAILED
```

---

## Inputs

- `WorkflowGraph` (from T002)
- `AgentRegistry` (from T001)
- `ConstitutionResolver` (from T003)
- Persisted state file (if resuming)

## Outputs

- Task execution results written to `.ai-sdd/state/`
- Updated state file after each task completes or fails
- Updated constitution.md artifact manifest after each task (via manifest writer hook)
- Gap audit report per attempted completion at `.ai-sdd/outputs/gap-audit-<task-id>.json`

---

## Task State Machine

```
PENDING ──► RUNNING ──► COMPLETED
                │
                ├──► NEEDS_REWORK ──► RUNNING  (rework loop)
                │         └──────────► FAILED  (max rework iterations)
                │
                ├──► HIL_PENDING ──► RUNNING   (HIL resolved)
                │         └──────────► FAILED  (HIL rejected)
                │
                └──► FAILED
```

- `NEEDS_REWORK`: set by evidence gate failure or reviewer NO_GO. Never `RUNNING` after gate fail.
- `HIL_PENDING`: set when requires_human, loop exhaustion, or T2 gate awaiting sign-off.
- Allowed transitions are enforced by `state_manager.py`; invalid transitions raise `StateError`.

## State File Schema

```json
{
  "schema_version": "1",
  "workflow": "default-sdd",
  "project": "/path/to/project",
  "started_at": "2026-02-27T10:00:00Z",
  "tasks": {
    "define-requirements": {
      "status": "COMPLETED",
      "started_at": "2026-02-27T10:01:00Z",
      "completed_at": "2026-02-27T10:05:00Z",
      "outputs": [
        { "path": "requirements.md", "contract": "requirements_doc@1" }
      ],
      "iterations": 1
    },
    "design-l1": {
      "status": "PENDING",
      "started_at": null,
      "completed_at": null,
      "outputs": [],
      "iterations": 0
    }
  }
}
```

---

## RuntimeAdapter Interface

Adapters operate in one of two modes, declared in `ai-sdd.yaml`. The mode determines
who assembles the agent's prompt and context:

| Mode | Who assembles context | Used by |
|---|---|---|
| **`direct`** | Engine assembles full prompt (constitution + persona + task) → sends to LLM API | `OpenAIAdapter`, `ClaudeCodeAdapter` (headless) |
| **`delegation`** | Engine passes a lightweight task brief → the tool manages its own context, persona, and constitution reading via its native mechanisms (CLAUDE.md, .roomodes, MCP) | Claude Code interactive (skills/subagents), Roo Code (MCP modes) |

In `delegation` mode the engine is a **context provider** (supplies task_id, output_path,
handover_state) not a **context wrapper** (does not construct system prompts). This avoids
collisions between the engine's prompt and the tool's own CLAUDE.md / .roomodes system prompt.

**Delegation mode tool failures:** If a native tool call inside the delegated session fails
(e.g. `Read` timeout, MCP server unavailable), this surfaces to the engine as a
`TaskResult` with `status=FAILED` and `error_type=tool_error`. The adapter retry policy
applies normally — `tool_error` is retryable (see T015 §Error Taxonomy). The engine
never has visibility into individual tool calls within a delegation session.

```python
class RuntimeAdapter(ABC):
    dispatch_mode: Literal["direct", "delegation"] = "direct"

    @abstractmethod
    def dispatch(self, task: Task, context: AgentContext,
                 operation_id: str, attempt_id: str) -> TaskResult:
        """
        operation_id: stable across retries; sent to provider as idempotency key.
        attempt_id:   changes per retry; logged for observability only, never sent to provider.
        direct mode:    Engine-assembled full context sent to LLM API.
        delegation mode: Lightweight task brief sent; tool handles persona + context.
        Returns TaskResult with: status, outputs, handover_state, error, tokens_used.
        """
        ...
```

Context bundle passed to each agent:
```python
AgentContext(
    constitution=<merged constitution string including artifact manifest>,
    handover_state=<dict from previous tasks>,
    task_definition=<task YAML definition>,
    dispatch_mode=<"direct" | "delegation">
    # direct mode:     engine injects full constitution + persona into prompt
    # delegation mode: engine passes task_id + output_path only;
    #                  tool reads constitution via its own tools (Read, MCP)
)
```

---

## Hook Points

```python
engine.on_pre_task(task_id, callback)
engine.on_post_task(task_id, callback)    # "*" matches all tasks
engine.on_failure(task_id, callback)
engine.on_loop_exit(task_id, callback)
```

Default post-task hooks registered by the engine:
- `manifest_writer.write_artifact_manifest` — updates constitution.md after every task

---

## Concurrency Budget Config

```yaml
# ai-sdd.yaml
engine:
  max_concurrent_tasks: 3           # asyncio semaphore on dispatch
  rate_limit_requests_per_minute: 20
  cost_budget_per_run_usd: 10.00    # pause → HIL when exceeded
```

---

## Implementation Notes

- `asyncio` for parallel dispatch; semaphore enforces `max_concurrent_tasks`.
- State file at `.ai-sdd/state/workflow-state.json`; atomic writes (temp + rename).
- Hook dispatch: run all registered hooks in registration order.
- Handover state: completed tasks write a `handover` dict; next tasks receive it.
- On unrecoverable failure: persist state, emit on-failure, stop gracefully.
- Context assembly: pass merged constitution (includes manifest) + handover state. Do NOT pre-load artifact file contents — agents pull via native tools.
- Completion gate: run `gap_audit` (allowlist + security + artifact contract) before any `COMPLETED` transition.

---

## Files to Create

- `core/engine.py`
- `core/gap_audit.py`
- `core/state_manager.py`
- `core/context_manager.py`
- `core/hooks.py`
- `core/runtime_adapter.py` (interface)
- `adapters/mock_adapter.py`
- `adapters/claude_code_adapter.py`
- `tests/test_engine.py`
- `tests/test_state_manager.py`
- `tests/test_gap_audit.py`

---

## Test Strategy

- Unit tests: state transitions (PENDING → RUNNING → COMPLETED/FAILED).
- Unit tests: gap audit failure paths (`NEEDS_REWORK`, `FAILED`) before completion.
- Unit tests: dependency resolution, topological dispatch order.
- Unit tests: concurrency budget — no more than N tasks dispatch simultaneously.
- Unit tests: context assembly — constitution included; file contents NOT pre-loaded.
- Integration tests: full workflow run (A → B → C); interruption + resume; parallel dispatch.
- Integration test: failed task halts downstream; on-failure hook fires.
- Integration test: manifest writer post-task hook fires after every task.

## Phase 4: Persistent Session Mode (deferred)

When consecutive tasks share the same agent persona (e.g. design-l1 → review-l1-pe
both use `pe`), spawning a new adapter process per task adds 15–30s overhead.

A future `session` dispatch mode allows the adapter to keep a live process/session
across consecutive same-agent tasks and hand off context between them:
```yaml
adapter:
  session_mode: enabled          # Phase 4 only; default: disabled
  session_reuse_same_agent: true # reuse session when next task uses same agent
```
This is a Phase 4 optimization — not a Phase 1 requirement. Phase 1 always spawns
a fresh adapter dispatch per task.

## Rollback/Fallback

- On unrecoverable task failure: persist FAILED state; stop engine safely.
- On adapter dispatch error: retry per adapter contract (T015), then mark FAILED.
- State file write failure: emit critical error; do not proceed to next task.
