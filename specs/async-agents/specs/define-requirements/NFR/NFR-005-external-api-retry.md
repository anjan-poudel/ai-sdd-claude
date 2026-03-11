# NFR-005: External API Retry and Error Handling

## Metadata
- **Category:** Reliability
- **Priority:** MUST

## Description
All external API calls to collaboration tools (Slack, Confluence, Jira, Bitbucket, GitHub) must implement retry logic with exponential backoff. The retry policy must be: maximum 3 retries, initial backoff of 1 second, backoff multiplier of 2 (yielding delays of 1s, 2s, 4s). Retries must only be attempted for transient errors: HTTP 429 (rate limit), 500, 502, 503, 504. Non-transient errors (4xx except 429) must fail immediately without retry. Each retry attempt must be logged with the attempt number, error code, and next retry delay. After all retries are exhausted, the error must be surfaced to the orchestrator with the full error chain. The system must handle API rate limits by respecting the Retry-After header when present, using its value instead of the calculated backoff.

## Acceptance criteria

```gherkin
Feature: External API retry and error handling

  Scenario: Transient error triggers retry with exponential backoff
    Given a Slack API call that returns HTTP 503 on the first 2 attempts
    And succeeds on the 3rd attempt
    When the adapter makes the API call
    Then 3 total attempts are made
    And the delays between attempts are approximately 1 second and 2 seconds
    And the final result is success

  Scenario: Non-transient error fails immediately
    Given a Confluence API call that returns HTTP 403 (Forbidden)
    When the adapter makes the API call
    Then no retry is attempted
    And the error is surfaced immediately to the orchestrator

  Scenario: All retries exhausted surfaces error with full chain
    Given a Jira API call that returns HTTP 500 on all 4 attempts (1 initial + 3 retries)
    When the adapter makes the API call
    Then the error surfaced to the orchestrator includes all 4 attempt errors
    And each retry attempt is logged with attempt number and delay

  Scenario: Rate limit respects Retry-After header
    Given a GitHub API call that returns HTTP 429 with Retry-After: 30
    When the adapter receives the response
    Then the next retry waits 30 seconds (not the calculated 1-second backoff)
```

## Related
- FR: FR-004, FR-006, FR-007, FR-008, FR-010, FR-011, FR-012
