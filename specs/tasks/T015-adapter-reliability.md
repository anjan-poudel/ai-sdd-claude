# T015: Adapter Reliability Contract

**Phase:** 2 (Overlay Suite)
**Status:** PENDING
**Dependencies:** T010 (CLI and runtime adapter)
**Size:** S (4 days)
**Source:** Synthesized-Codex (GAP-L2-004)

---

## Context

Each AI coding tool adapter (Claude Code, Codex, Gemini) has a different error surface: rate limits, context window limits, content policy violations, network timeouts, and quota exhaustion. Without a unified contract, the engine's behavior on adapter failure is inconsistent and can corrupt resume semantics (retrying a task that was partially completed).

The adapter reliability contract standardizes error taxonomy, retry/backoff defaults, idempotency keys, and error→state mapping across all adapters.

---

## Acceptance Criteria

```gherkin
Feature: Adapter reliability contract

  Scenario: Network error triggers retry with backoff
    Given a ClaudeCodeAdapter with max_retries=3 and initial_backoff=2s
    When a transient network error occurs on dispatch
    Then the adapter retries up to 3 times
    And waits 2s, 4s, 8s between retries (exponential backoff)
    And emits a "task.retrying" observability event for each attempt

  Scenario: Rate limit triggers retry after wait
    Given a rate limit error (HTTP 429) with Retry-After: 30s
    When the adapter receives the error
    Then it waits the Retry-After duration before retrying
    And emits a "adapter.rate_limited" event with wait_duration

  Scenario: Context limit error is NOT retried
    Given a context limit error (input too long)
    When the adapter receives the error
    Then it does NOT retry
    And returns error_type=context_limit to the engine
    And the engine marks the task FAILED with reason "context_limit exceeded"

  Scenario: Content policy violation is NOT retried
    Given a content policy error
    When the adapter receives it
    Then it does NOT retry
    And escalates to HIL with error context (for operator review)

  Scenario: Max retries exhausted → task FAILED
    Given max_retries=3 and all 3 attempts fail with network error
    When retries are exhausted
    Then the task is marked FAILED
    And the state file is updated atomically
    And all retry attempts are logged in observability

  Scenario: operation_id is stable across retries — enables provider dedup
    Given a task dispatched with operation_id="workflow-xyz:task-design-l1:run-uuid"
    When the adapter crashes after dispatch and the engine retries
    Then the same operation_id is reused on retry
    And the provider deduplicates the call if it supports idempotency headers
    And no duplicate LLM execution occurs

  Scenario: attempt_id changes per retry — enables attempt-level tracing
    Given a task being retried for the 2nd time
    Then attempt_id = operation_id + ":attempt_2"
    And both operation_id and attempt_id are logged in observability
    And only operation_id is sent to the provider as the idempotency header

  Scenario: Mock and real adapter conform to same contract
    Given the MockRuntimeAdapter and ClaudeCodeAdapter
    When both are run against the adapter contract test suite
    Then both pass all contract tests
    And the mock produces the same error taxonomy as the real adapter
```

---

## Error Taxonomy

| Error Type | Retry? | Engine Action | Notes |
|---|---|---|---|
| `network` | Yes | Retry with backoff | Transient (DNS, TCP, SSL) |
| `rate_limit` | Yes | Wait Retry-After, then retry | HTTP 429 |
| `timeout` | Yes | Retry with longer timeout | Configurable per-adapter |
| `context_limit` | **No** | FAILED (context_limit) | Input too long; agent should read fewer artifacts via constitution manifest |
| `content_policy` | **No** | FAILED + HIL escalation | Needs human review |
| `quota_exhausted` | **No** | PAUSED + HIL escalation | Budget exceeded |
| `tool_error` | Yes | Retry with backoff | Tool call failure inside delegation mode (e.g. Read timeout, MCP error) |
| `unknown` | Yes (1x) | Retry once, then FAILED | Catch-all |

---

## Adapter Contract Interface

```python
@dataclass
class AdapterError:
    error_type: Literal["network", "rate_limit", "timeout", "context_limit",
                        "content_policy", "quota_exhausted", "tool_error", "unknown"]
    message: str
    retry_after_seconds: Optional[int] = None  # for rate_limit
    raw_error: Optional[str] = None

class RuntimeAdapter(ABC):
    max_retries: int = 3
    initial_backoff_seconds: float = 2.0
    max_backoff_seconds: float = 60.0

    @abstractmethod
    def dispatch(self, task: Task, context: AgentContext,
                 operation_id: str, attempt_id: str) -> TaskResult:
        """
        Dispatch task to underlying LLM.
        operation_id: stable across retries; sent to provider as idempotency key.
        attempt_id: changes per retry; used for observability only, never sent to provider.
        Must raise AdapterError with correct error_type on failure.
        Must not raise raw provider exceptions.
        """
        ...

    def operation_id(self, workflow_id: str, task_id: str,
                     task_run_id: str) -> str:
        """Stable across retries and resume. Sent to provider as idempotency key."""
        return f"{workflow_id}:{task_id}:{task_run_id}"

    def attempt_id(self, workflow_id: str, task_id: str,
                   task_run_id: str, attempt: int) -> str:
        """Changes per retry. Used for attempt-level observability only."""
        return f"{workflow_id}:{task_id}:{task_run_id}:attempt_{attempt}"
```

---

## Retry/Backoff Defaults

```yaml
# config/defaults.yaml
adapter:
  max_retries: 3
  initial_backoff_seconds: 2.0
  backoff_multiplier: 2.0
  max_backoff_seconds: 60.0
  retry_on: [network, rate_limit, timeout, tool_error]
  no_retry_on: [context_limit, content_policy, quota_exhausted]
  circuit_breaker_failures: 5       # disable adapter after N consecutive failures
  circuit_breaker_reset_seconds: 60 # re-enable after this cool-off period
```

---

## Contract Test Suite

The adapter contract test suite validates any adapter implementation:

```python
class AdapterContractTests:
    """
    Abstract contract tests. Subclass for each adapter (mock, claude, codex, gemini).
    Each adapter must pass all tests.
    """
    def test_network_error_triggers_retry(self): ...
    def test_rate_limit_waits_retry_after(self): ...
    def test_context_limit_not_retried(self): ...
    def test_content_policy_escalates_to_hil(self): ...
    def test_operation_id_and_attempt_id_format(self): ...
    def test_error_taxonomy_completeness(self): ...
```

---

## Files to Create

- `adapters/base_adapter.py` (contract + retry logic base class)
- `adapters/errors.py` (AdapterError dataclass + taxonomy)
- `tests/adapters/contract_tests.py` (abstract contract test suite)
- `tests/adapters/test_mock_adapter.py` (mock conforms to contract)
- `tests/adapters/test_claude_adapter.py` (Claude adapter conforms)
- Updated `config/defaults.yaml` (retry defaults)

---

## Test Strategy

- Contract test suite run against every adapter implementation.
- Unit tests: each error type correctly classified and handled.
- Integration test: end-to-end run with simulated rate limit (mock adapter returns 429 on attempt 1, succeeds on attempt 2).
- Integration test: context_limit error → task FAILED with correct reason.

## Rollback/Fallback

- If adapter does not conform to contract (missing error_type), treat as `unknown` error.
- If idempotency key conflicts (duplicate call detected), return cached result if available, else proceed with new call.
