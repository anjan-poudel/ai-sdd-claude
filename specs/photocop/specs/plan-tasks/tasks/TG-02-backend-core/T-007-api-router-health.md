# T-007: API router and health endpoint

## Metadata
- **Group:** [TG-02 — Backend Core](index.md)
- **Component:** FastAPI Backend — `router.py`
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** [T-005](T-005-error-handlers.md), [T-006](T-006-image-ingestion-service.md)
- **Blocks:** [T-008](../TG-03-analysis-engine/T-008-analysis-engine-orchestrator.md), [T-020](../TG-06-quality-integration/T-020-full-pipeline-integration-test.md)
- **Requirements:** [FR-005](../../../define-requirements/FR/FR-005-json-results-export.md), [NFR-003](../../../define-requirements/NFR/NFR-003-performance.md)

## Description
Implement `backend/app/router.py` with the `POST /api/v1/analyse` endpoint skeleton (calling `ingest()`, wrapping the pipeline in `asyncio.wait_for`, and delegating to the analysis, heatmap, EXIF, and assembler modules) and the `GET /health` endpoint. The analyse endpoint's stub must return a `ProblemDetail` 501 until the pipeline is fully wired (T-008 and downstream tasks). The health endpoint must return HTTP 200 with `{"status": "ok"}`.

## Acceptance criteria

```gherkin
Feature: API router and health endpoint

  Scenario: Health endpoint returns 200 with status ok
    Given the PhotoCop backend service is running
    When a client sends GET /health
    Then the HTTP response status is 200
    And the response body is {"status": "ok"}

  Scenario: Analyse endpoint is reachable at /api/v1/analyse
    Given the backend service is running
    When a POST /api/v1/analyse is sent with a valid image fixture
    Then the server responds with a status code (not 404 or 405)

  Scenario: Analyse endpoint is not reachable at an undocumented path
    Given the backend service is running
    When a client sends POST /analyse (without the /api/v1/ prefix)
    Then the HTTP response status is 404
```

## Implementation notes
- The `/health` endpoint must be on a separate `APIRouter` with no prefix so it resolves at the root path.
- The `POST /api/v1/analyse` endpoint uses `asyncio.wait_for(run_pipeline(...), timeout=settings.analysis_timeout_seconds)`.
- Until the analysis engine (T-008) is wired, return a 501 Not Implemented ProblemDetail from the analyse endpoint stub.
- Declare all error response models in the `responses={}` dict on `@router.post` for OpenAPI documentation.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Integration test using `fastapi.testclient.TestClient` for both endpoints
- [ ] GET /health responds within 200 ms in the CI environment (asserted by test timing)
