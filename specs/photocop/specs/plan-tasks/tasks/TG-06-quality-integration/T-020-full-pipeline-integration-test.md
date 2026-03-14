# T-020: Full pipeline integration test and accuracy benchmark

## Metadata
- **Group:** [TG-06 — Quality & Integration](index.md)
- **Component:** Backend tests — `backend/tests/test_router.py`, benchmark script
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** [T-016](../TG-04-output-pipeline/T-016-response-assembler.md), [T-020-fe](../TG-05-frontend/T-020-fe-frontend-integration-test.md)
- **Blocks:** [T-021](T-021-qa-sign-off.md)
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-image-upload.md), [FR-002](../../../define-requirements/FR/FR-002-manipulation-detection.md), [FR-003](../../../define-requirements/FR/FR-003-heatmap-generation.md), [FR-004](../../../define-requirements/FR/FR-004-exif-extraction.md), [FR-005](../../../define-requirements/FR/FR-005-json-results-export.md), [NFR-001](../../../define-requirements/NFR/NFR-001-in-memory-processing.md), [NFR-002](../../../define-requirements/NFR/NFR-002-accuracy.md), [NFR-003](../../../define-requirements/NFR/NFR-003-performance.md), [NFR-004](../../../define-requirements/NFR/NFR-004-privacy.md), [NFR-005](../../../define-requirements/NFR/NFR-005-security.md)

## Description
Implement end-to-end backend integration tests using `fastapi.testclient.TestClient` covering all FR scenarios. Additionally, implement the NFR-002 accuracy benchmark script that submits 100 authentic and 100 manipulated images from the labelled benchmark dataset and asserts false-positive rate <= 15% and false-negative rate <= 15%. The benchmark must be runnable in CI as a separate test step.

## Acceptance criteria

```gherkin
Feature: Full pipeline integration test

  Scenario: POST /api/v1/analyse with a valid JPEG returns all five required fields
    Given the full backend stack is running (TestClient, no mocks)
    When a POST /api/v1/analyse request is sent with the authentic.jpg fixture
    Then HTTP 200 is returned
    And the response body contains "score", "verdict", "heatmap_url", "exif", "regions"
    And "score" is a float in [0.0, 1.0]
    And "heatmap_url" starts with "data:image/png;base64,"

  Scenario: POST /api/v1/analyse with a file exceeding 10 MB returns 413
    Given a request payload with Content-Length > 10 MB
    When it is submitted via TestClient
    Then HTTP 413 is returned with Content-Type "application/problem+json"
    And the response title is "File Too Large"

  Scenario: No image data is written to disk during a full analysis cycle
    Given the server filesystem is monitored
    When POST /api/v1/analyse completes successfully
    Then no new .jpg, .png, .webp, .tiff, .bmp, or .tmp files appear in the working directory or /tmp

  Scenario: False-positive rate does not exceed 15% on the 100-image authentic benchmark
    Given 100 labelled authentic images from the benchmark dataset
    When each is submitted to POST /api/v1/analyse
    Then at most 15 receive a verdict of "suspicious" or "likely manipulated"

  Scenario: False-negative rate does not exceed 15% on the 100-image manipulated benchmark
    Given 100 labelled manipulated images from the benchmark dataset
    When each is submitted to POST /api/v1/analyse
    Then at most 15 receive a verdict of "authentic"

  Scenario: 10 MB JPEG analysis completes within 10 seconds
    Given a JPEG image of exactly 10 MB
    When it is submitted to POST /api/v1/analyse
    Then the response is received within 10 seconds of the request being sent

  Scenario: POST /api/v1/analyse with an ELF binary returns 422 without executing it
    Given a file with ELF magic bytes and a .jpg extension
    When it is submitted via TestClient
    Then HTTP 422 is returned
    And no code execution occurs
```

## Implementation notes
- Benchmark dataset: 200 labelled images must be procured and stored outside the repository (e.g. a separate private S3 bucket or local path). The benchmark script reads the path from a `BENCHMARK_DATASET_PATH` environment variable; if absent, the benchmark step is skipped with a warning.
- The disk-write check can be implemented by listing files in `/tmp` and the working directory before and after each request.
- Performance test uses `time.perf_counter()` around the `TestClient.post()` call.
- The ELF binary test uses a 4-byte ELF magic header (`\x7fELF`) prepended to otherwise empty bytes.
- NFR-004 (privacy) test: assert that the pytest `caplog` fixture does not contain any known EXIF GPS value from a test fixture with known GPS data.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Benchmark step documented in CI config; skipped gracefully when BENCHMARK_DATASET_PATH is absent
- [ ] Performance test asserts response time < 10 s for 10 MB input
- [ ] Test asserts no disk writes of image data
- [ ] No PII in logs (verified by caplog assertions)
