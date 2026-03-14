# T-005: Global error handlers and ProblemDetail model

## Metadata
- **Group:** [TG-02 — Backend Core](index.md)
- **Component:** FastAPI Backend — `errors.py`
- **Agent:** dev
- **Effort:** S
- **Risk:** MEDIUM
- **Depends on:** [T-004](T-004-app-factory-config.md)
- **Blocks:** [T-006](T-006-image-ingestion-service.md), [T-007](T-007-api-router-health.md)
- **Requirements:** [FR-005](../../../define-requirements/FR/FR-005-json-results-export.md), [NFR-005](../../../define-requirements/NFR/NFR-005-security.md)

## Description
Implement `backend/app/errors.py` containing the `ProblemDetail` Pydantic model conforming to RFC 7807, the `INGESTION_ERROR_MAP` mapping `IngestionError.code` values to HTTP status and title strings, and the three exception handlers: `ingestion_error_handler`, `timeout_error_handler`, and `generic_error_handler`. No handler may expose Python tracebacks or internal file paths in the response body.

## Acceptance criteria

```gherkin
Feature: Global error handlers

  Scenario: IngestionError with SIZE_EXCEEDED code produces HTTP 413 Problem Details
    Given the backend is running and ingestion_error_handler is registered
    When an IngestionError with code "SIZE_EXCEEDED" is raised during request handling
    Then the response status is 413
    And the Content-Type is "application/problem+json"
    And the response body JSON contains title "File Too Large" and status 413

  Scenario: asyncio.TimeoutError produces HTTP 504 Problem Details
    Given the backend is running and timeout_error_handler is registered
    When asyncio.TimeoutError is raised during analysis pipeline execution
    Then the response status is 504
    And the Content-Type is "application/problem+json"
    And the response body JSON contains title "Analysis Timeout" and status 504

  Scenario: Unhandled exception produces HTTP 500 without exposing traceback
    Given the backend is running and generic_error_handler is registered
    When an unhandled RuntimeError is raised inside a route handler
    Then the response status is 500
    And the Content-Type is "application/problem+json"
    And the response body does not contain the word "Traceback" or any internal file path
    And the exception is logged at ERROR level on the server side
```

## Implementation notes
- All handlers must return `JSONResponse` with `media_type="application/problem+json"`.
- The `generic_error_handler` must log the full traceback server-side using `logging.exception()` before sending the sanitised 500 response.
- The `detail` field of `ProblemDetail` must be a human-readable string; it must never contain a Python traceback, exception message, or internal file path (NFR-005).
- `INGESTION_ERROR_MAP` must cover all four `IngestionError.code` values: `SIZE_EXCEEDED`, `UNSUPPORTED_FORMAT`, `MAGIC_BYTE_MISMATCH`, `DECODE_FAILED`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Test asserts that `"Traceback"` does not appear in any 5xx response body
- [ ] Test asserts that all four INGESTION_ERROR_MAP codes produce the correct status and title
- [ ] No PII in logs
