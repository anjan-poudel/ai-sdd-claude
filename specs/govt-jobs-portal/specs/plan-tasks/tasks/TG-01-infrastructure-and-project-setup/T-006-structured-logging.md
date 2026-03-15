# T-006: Structured JSON logging and request trace ID propagation

## Metadata
- **Group:** [TG-01 — Infrastructure & Project Setup](index.md)
- **Component:** Shared observability module
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** [T-001](T-001-project-scaffold-and-infra.md)
- **Blocks:** —
- **Requirements:** [NFR-006](../../../../define-requirements.md#nfr-006-observability), [NFR-004](../../../../define-requirements.md#nfr-004-security-and-privacy)

## Description
Implement a shared `StructuredLogger` that emits JSON log entries with fields: `timestamp`, `service`, `level`, `trace_id`, `message`, and optional structured fields. Implement the `X-Trace-ID` middleware for the Web API that generates a UUID if the header is absent and propagates it into every log entry for the request lifecycle. Ensure no PII fields (email, JWT token values) appear in log output.

## Acceptance criteria

```gherkin
Feature: Structured logging

  Scenario: Log entry contains required fields
    Given the api service is running
    When any log.info() call is made with a message
    Then the emitted JSON log entry must contain: timestamp (ISO 8601), service, level, trace_id, and message
    And the entry must be valid JSON parseable by standard tooling

  Scenario: No email address appears in API request logs
    Given the web API handles a POST /api/auth/login request containing an email address
    When the request is processed and log entries are written
    Then the email address must not appear in plain text in any log entry
    And the Authorization header value must not appear in any log entry

  Scenario: X-Trace-ID is generated when absent and propagated
    Given an incoming request has no X-Trace-ID header
    When the request passes through the trace ID middleware
    Then a UUID must be assigned as the trace_id for all log entries during that request
    And the X-Trace-ID header must be present in the response
```

## Implementation notes
- Use `pino` as the structured logging library (fast, JSON-native).
- The PII sanitiser in the Web API middleware (L2 §1.4, middleware step 6) should also run on log metadata.
- Log level is configurable via `LOG_LEVEL` environment variable.
- The `StructuredLogger` interface from L2 §5.1 must be the type exported for use in all services.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] PII redaction tested with email, JWT, and OAuth token fixtures
