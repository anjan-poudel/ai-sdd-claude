# T-020: Web API Express app and middleware stack

## Metadata
- **Group:** [TG-04 — Search & Discovery](index.md)
- **Component:** api ECS service
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-009](../TG-02-auth-and-user-accounts/T-009-login-jwt-and-refresh-tokens.md), [T-011](../TG-02-auth-and-user-accounts/T-011-user-profile-and-rbac.md)
- **Blocks:** T-021, T-022, T-023, T-024, T-028, T-029, T-030
- **Requirements:** [FR-007](../../../../define-requirements.md#fr-007-user-accounts), [NFR-001](../../../../define-requirements.md#nfr-001-performance), [NFR-004](../../../../define-requirements.md#nfr-004-security-and-privacy)

## Description
Implement the Express web API application with the full 11-step middleware stack from L2 §1.4: X-Trace-ID propagation, request logger, TLS redirect, rate limiter, body size limiter, PII input sanitiser, JWT auth, RBAC, route handler, response logger, and error handler. Implement the typed error → HTTP status mapping. Configure TLS redirect (HTTP 301 to HTTPS). Request timeout: `API_REQUEST_TIMEOUT_MS` (5000ms).

## Acceptance criteria

```gherkin
Feature: Web API middleware stack

  Scenario: HTTP redirects to HTTPS
    Given the portal is deployed with TLS configured
    When a client sends an HTTP (non-TLS) request
    Then the server must respond with HTTP 301 redirecting to the HTTPS URL

  Scenario: Rate limiter returns 429 after threshold
    Given a client has sent API_RATE_LIMIT_REQUESTS (300) requests within API_RATE_LIMIT_WINDOW_MS (60s)
    When the client sends the 301st request
    Then HTTP 429 must be returned with code RATE_LIMITED and retryAfterSeconds

  Scenario: PII field in request body is rejected
    Given a registration request includes a "phone_number" field
    When the request passes through the PII sanitiser middleware
    Then the phone_number field must be stripped before reaching the route handler
    And no phone number must be stored or logged

  Scenario: Error handler strips stack traces in production
    Given NODE_ENV is "production"
    And a route handler throws an unexpected error
    When the error handler processes the error
    Then HTTP 500 must be returned with code INTERNAL_ERROR and traceId
    And no stack trace must appear in the response body

  Scenario: Degraded mode when ES is unavailable
    Given ElasticSearch is unreachable
    When a user submits a search query
    Then HTTP 503 must be returned with code SEARCH_UNAVAILABLE
    And the response body must contain "Search is temporarily unavailable. Please try again shortly."
```

## Implementation notes
- Rate limiter: use `express-rate-limit` with Redis store (`rate-limit-redis`).
- PII sanitiser: strip `phone`, `nationalId`, `dateOfBirth`, `address` from req.body (configurable list).
- TLS redirect: check `req.headers['x-forwarded-proto'] !== 'https'` (behind ALB).
- Error handler must call `next(err)` or be registered as the last middleware.
- Request timeout: `req.setTimeout(API_REQUEST_TIMEOUT_MS)`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] All 11 middleware steps verified by integration test
- [ ] Stack trace suppression tested in production mode
