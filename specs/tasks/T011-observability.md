# T011: Observability — Structured Event Emission and Logging

**Phase:** 1 (Core Engine)
**Status:** PENDING
**Dependencies:** T004 (core engine)
**Changes from synthesized-claude:** Added `run_id` + `task_run_id` correlation IDs; added cost/token metrics (`tokens_used`, `estimated_cost_usd`); added `context.assembled` and `security.*` event types; added `cost_tracker.py`; updated config schema.

---

## Context

Observability is baked in from Phase 1 — not retrofitted. Every event carries a `run_id` (UUID for the whole workflow run) and a `task_run_id` (UUID per task execution), enabling cross-event correlation for debugging and cost attribution.

Phase 1 delivers structured JSON event emission, cost/token tracking, and secret redaction.
Phase 4 (Production Hardening) extends with OpenTelemetry traces, Prometheus metrics, and SLO alerts.

**Critical constraints:**
- Secrets must never appear in logs, state files, or observability events.
- Observability failures must never stop workflow execution.

---

## Acceptance Criteria

```gherkin
Feature: Structured event emission

  Scenario: Every event has a run_id and task_run_id
    Given a running workflow with run_id="abc-123"
    When any event is emitted during task "design-l1"
    Then the event contains run_id="abc-123"
    And a stable task_run_id for this execution of "design-l1"

  Scenario: Task lifecycle events are logged with cost metrics
    Given a running workflow
    When a task transitions to COMPLETED
    Then a structured event is emitted with:
      task_id, status, duration_ms, tokens_used, estimated_cost_usd, retry_count, loop_count

  Scenario: Cost budget threshold emits warning
    Given engine.cost_budget_per_run_usd=10.00
    When cumulative cost across all tasks reaches 8.00 (80%)
    Then a "cost.budget_warning" event is emitted with: current_cost, budget, pct_used

  Scenario: Context assembly event emitted
    Given a task dispatched after context assembly
    Then a "context.assembled" event is emitted with: task_id, token_count

  Scenario: Context warning emitted as agent approaches limit
    Given engine.context_warning_threshold_pct=80 and adapter.max_context_tokens=100000
    When a task context is assembled with token_count=83000 (83%)
    Then a "context.warning" event is emitted with:
      task_id, token_count, max_context_tokens, pct_used, largest_artifact_paths
    And the task continues executing (warning is non-blocking)

  Scenario: Context HIL escalation in direct mode
    Given engine.context_hil_threshold_pct=95 and adapter.max_context_tokens=100000
    And adapter.dispatch_mode=direct
    When context assembly produces token_count=96000 (96%)
    Then execution is paused and a HIL item is created
    And the HIL context includes the largest_artifact_paths to guide pruning
    And the operator can re-run with a smaller artifact scope

  Scenario: Constitution resolution is traced
    Given a task resolving constitutions from 3 levels
    When the resolver runs
    Then a "constitution.resolved" event is emitted with the ordered list of files merged

  Scenario: HIL events are logged
    When a HIL queue item is created, resolved, or rejected
    Then a structured event is emitted with: run_id, hil_item_id, task_id, trigger, status

  Scenario: Security events are logged
    When a prompt injection pattern is detected
    Then a "security.injection_detected" event is emitted with: task_id, source_file, pattern, action
    When a secret is redacted from an output
    Then a "security.secret_redacted" event is emitted with: task_id, secret_type, location

  Scenario: Secrets are never logged
    Given an agent configured with api_key: "sk-abc123"
    When any event is emitted
    Then "sk-abc123" does not appear anywhere in the log file
    And state files do not contain the API key

  Scenario: Log level filtering
    Given log_level=INFO in ai-sdd.yaml
    When DEBUG events are emitted
    Then they are not written to the log output

  Scenario: Observability failure does not stop execution
    Given the log file write fails (disk full)
    When the emitter attempts to write
    Then it logs to stderr only
    And the workflow continues executing
```

---

## Event Schema

Every event:

```json
{
  "version": "1",
  "run_id": "uuid-v4",
  "task_run_id": "uuid-v4",
  "timestamp": "2026-02-27T10:30:00.000Z",
  "level": "INFO | WARN | ERROR | DEBUG",
  "event_type": "...",
  "workflow": "default-sdd",
  "task_id": "design-l1",
  "agent": "architect",
  "details": { /* event-specific; never contains secrets */ }
}
```

---

## Event Types (Phase 1)

| Event Type | Trigger | Key `details` Fields |
|---|---|---|
| `engine.started` | Engine begins run | workflow, project, run_id |
| `engine.completed` | Workflow finishes | total_duration_ms, tasks_completed, total_cost_usd |
| `task.started` | Task begins | task_id, agent, iteration |
| `task.completed` | Task finishes | duration_ms, **tokens_used**, **estimated_cost_usd**, retry_count, loop_count |
| `task.failed` | Task fails | error_type, error_message |
| `task.retrying` | Adapter retry | attempt_number, error_type, wait_seconds |
| `overlay.iteration` | Overlay loop iterates | overlay_type, iteration, decision |
| `hil.created` | HIL item created | hil_item_id, trigger |
| `hil.resolved` | HIL item resolved | hil_item_id, resolved_by |
| `hil.rejected` | HIL item rejected | hil_item_id, reason |
| `constitution.resolved` | Constitution merged | files_merged (ordered list) |
| `context.assembled` | Context built for agent | token_count, max_context_tokens |
| `context.warning` | Context nears token limit | token_count, max_context_tokens, pct_used, largest_artifact_paths |
| `cost.budget_warning` | Cost nears budget | current_cost_usd, budget_usd, pct_used |
| `cost.budget_exceeded` | Cost hits budget | current_cost_usd, budget_usd — action per `cost_enforcement` |
| `security.injection_detected` | Injection pattern found | source_file, pattern_matched, score, action |
| `security.secret_redacted` | Secret found in output | secret_type, location |

---

## Observability Config

```yaml
# ai-sdd.yaml
observability:
  log_level: INFO                      # DEBUG | INFO | WARN | ERROR
  log_file: ".ai-sdd/logs/ai-sdd.log"
  # Secret patterns live under security.secret_patterns — not here.
  cost_tracking:
    enabled: true
    model_pricing:                     # USD per 1M tokens (input/output)
      claude-sonnet-4-6: { input: 3.00, output: 15.00 }
      claude-opus-4-6:   { input: 15.00, output: 75.00 }
      gpt-4o:            { input: 2.50, output: 10.00 }
```

---

## Secret Sanitization

Runs on all log writes (delegates to `security/output_sanitizer.py`):
- Strip fields matching known patterns (API keys, tokens, passwords, JWTs).
- Replace with `[REDACTED:<TYPE>]`.
- Configurable additional patterns via `security.secret_patterns` (canonical namespace — see CONTRACTS.md §10).

---

## Implementation Notes

- Emitter is a singleton initialized at engine startup with the `run_id` UUID.
- `task_run_id` is a new UUID generated at each task dispatch (stable within retries; forms part of `operation_id`).
- Cost estimation: `tokens_used` comes from adapter `TaskResult.tokens_used`; `estimated_cost_usd` computed by `cost_tracker.py` using `model_pricing` config.
- Log output: structured JSON to file + optionally stdout (`--verbose` flag).
- Phase 4 extension: OpenTelemetry span wrapping each task; Prometheus counter/histogram.

---

## Files to Create

- `observability/emitter.py`
- `observability/sanitizer.py` (delegates to `security/output_sanitizer.py`)
- `observability/events.py` (event schema dataclasses with `run_id`, `task_run_id`)
- `observability/cost_tracker.py`
- `tests/test_emitter.py`
- `tests/test_cost_tracker.py`

---

## Test Strategy

- Unit tests: every event type emits correct schema fields including `run_id` and `task_run_id`.
- Unit tests: cost estimation per model from pricing config.
- Unit tests: secret sanitization removes API keys, JWTs, bearer tokens.
- Unit tests: log level filtering.
- Integration test: full workflow run produces event log; `run_id` consistent across all events.
- Integration test: cost budget warning at 80%; HIL triggered at 100%.

## Rollback/Fallback

- Log file write failure: emit to stderr only; workflow continues.
- Cost tracker failure: log warning; cost field set to `null`; workflow continues.
- Observability is best-effort — no failure mode should stop task execution.
