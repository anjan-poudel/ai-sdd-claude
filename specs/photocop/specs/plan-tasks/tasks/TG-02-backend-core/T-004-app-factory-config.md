# T-004: App factory, config, and middleware

## Metadata
- **Group:** [TG-02 — Backend Core](index.md)
- **Component:** FastAPI Backend — `main.py`, `config.py`, `middleware.py`
- **Agent:** dev
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** [T-001](../TG-01-infrastructure-scaffold/T-001-monorepo-scaffold.md), [T-002](../TG-01-infrastructure-scaffold/T-002-backend-dependency-manifest.md)
- **Blocks:** [T-005](T-005-error-handlers.md), [T-006](T-006-image-ingestion-service.md), [T-007](T-007-api-router-health.md)
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-image-upload.md), [FR-005](../../../define-requirements/FR/FR-005-json-results-export.md), [NFR-003](../../../define-requirements/NFR/NFR-003-performance.md), [NFR-005](../../../define-requirements/NFR/NFR-005-security.md)

## Description
Implement `backend/app/config.py` (Pydantic `BaseSettings` singleton reading all environment variables), `backend/app/middleware.py` (`SizeLimitMiddleware` enforcing `MAX_UPLOAD_BYTES` at the HTTP boundary before body is buffered), and `backend/app/main.py` (`create_app()` factory wiring CORS, size-limit middleware, exception handlers, and routers). The settings validator must reject invalid weight combinations at startup.

## Acceptance criteria

```gherkin
Feature: App factory and config

  Scenario: Application starts successfully with valid environment variables
    Given ANALYSIS_TIMEOUT_SECONDS=9, MAX_UPLOAD_BYTES=10485760, ELA_WEIGHT=0.4, NOISE_WEIGHT=0.3, CLONE_WEIGHT=0.3 are set
    When create_app() is called
    Then the FastAPI application instance is returned without raising an exception
    And GET /health returns HTTP 200

  Scenario: Application fails to start when analysis weights do not sum to 1.0
    Given ELA_WEIGHT=0.5, NOISE_WEIGHT=0.3, CLONE_WEIGHT=0.3 are set (sum = 1.1)
    When get_settings() is called
    Then a ValueError is raised at startup
    And the process does not serve any requests

  Scenario: SizeLimitMiddleware rejects an oversized upload at the HTTP boundary
    Given MAX_UPLOAD_BYTES=10485760
    When a POST /api/v1/analyse request with Content-Length=20971520 (20 MB) arrives
    Then the middleware returns HTTP 413 before reading the full request body into memory
    And the response Content-Type is "application/problem+json"

  Scenario: CORS headers are present for the configured frontend origin
    Given CORS_ORIGINS=http://localhost:5173
    When a preflight OPTIONS request is sent from http://localhost:5173
    Then the response contains "Access-Control-Allow-Origin: http://localhost:5173"
```

## Implementation notes
- `SizeLimitMiddleware` must check the `Content-Length` header; if absent, stream-count bytes and reject once the count exceeds `max_upload_bytes`. This prevents memory-based DOS.
- The `Settings.validate_weights_sum` model validator must use `abs(total - 1.0) > 1e-6` to handle floating-point imprecision.
- `get_settings()` returns a cached singleton (use `@lru_cache(maxsize=1)` or Pydantic's singleton pattern).
- CORS must only allow `GET` and `POST` methods, and `Content-Type` header.
- No secrets in source code; all values come from environment variables per NFR-005.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Unit tests for `Settings.validate_weights_sum` with boundary values (1.0 ± 1e-5, 1.0 ± 1e-7)
- [ ] Unit tests for `SizeLimitMiddleware` with Content-Length header present and absent
- [ ] No PII in logs
