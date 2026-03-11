# T-006: Retry Middleware (CollabHttpClient)

## Metadata
- **Group:** [TG-02 -- Adapter Framework](index.md)
- **Component:** RetryWithBackoff / CollabHttpClient
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-005](T-005-adapter-interfaces.md)
- **Blocks:** T-009, T-012, T-015, T-018, T-021, T-022
- **Requirements:** [NFR-005](../../../define-requirements/NFR/NFR-005-external-api-retry.md)

## Description
Implement the CollabHttpClient with automatic retry and exponential backoff. Wraps Bun's native `fetch` with configurable max retries (default 3), initial delay (1000ms), multiplier (2x), and retryable status codes (429, 500, 502, 503, 504). Respects Retry-After header. Emits observability events per retry attempt.

## Acceptance criteria

```gherkin
Feature: Retry middleware with exponential backoff

  Scenario: Successful request on first attempt
    Given the target API returns 200
    When CollabHttpClient.get is called
    Then the response is returned as Result with ok = true
    And no retry events are emitted

  Scenario: Retryable error triggers exponential backoff
    Given the target API returns 503 twice then 200
    When CollabHttpClient.get is called with maxRetries = 3
    Then the request is retried with exponential delays (1s, 2s)
    And the final 200 response is returned as Result with ok = true
    And 2 collab.api.retry events are emitted

  Scenario: Retry-After header overrides calculated backoff
    Given the target API returns 429 with Retry-After = 5
    When CollabHttpClient.get is called
    Then the retry waits 5 seconds instead of the calculated backoff
```

## Implementation notes
- File: `src/collaboration/infra/retry.ts`
- Uses Bun native `fetch` -- no external HTTP library
- Request timeout: 10s default, configurable per-call (3s for Slack per NFR-004)
- Must return `Result<T, AdapterError>` with appropriate error codes (RATE_LIMIT for 429, NETWORK for timeout)
- Each attempt emits `collab.api.request` event with method, url, status, duration_ms

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII or credentials in retry log events
