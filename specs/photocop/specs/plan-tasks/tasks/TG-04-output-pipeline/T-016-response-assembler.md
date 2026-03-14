# T-016: Response Assembler and router wiring

## Metadata
- **Group:** [TG-04 — Output Pipeline](index.md)
- **Component:** Response Assembler — `backend/app/assembler.py`; router wiring — `backend/app/router.py`
- **Agent:** dev
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** [T-014](T-014-heatmap-renderer.md), [T-015](T-015-exif-extractor.md)
- **Blocks:** [T-020](../TG-06-quality-integration/T-020-full-pipeline-integration-test.md)
- **Requirements:** [FR-005](../../../define-requirements/FR/FR-005-json-results-export.md), [NFR-003](../../../define-requirements/NFR/NFR-003-performance.md)

## Description
Implement `assemble(pipeline_result, heatmap_url, exif_data) -> AnalysisResponse` in `backend/app/assembler.py` and complete the `POST /api/v1/analyse` router endpoint in `backend/app/router.py` by wiring all pipeline stages end-to-end. The assembler must clamp an out-of-range score and log a WARNING before serialisation. The router endpoint must apply `asyncio.wait_for` around the pipeline invocation.

## Acceptance criteria

```gherkin
Feature: Response Assembler and router wiring

  Scenario: assemble() constructs a valid AnalysisResponse from pipeline outputs
    Given PipelineResult(score=0.6, verdict="suspicious", regions=[])
    And heatmap_url="data:image/png;base64,abc"
    And exif_data={"Make": "Canon"}
    When assemble(pipeline_result, heatmap_url, exif_data) is called
    Then the returned AnalysisResponse has score=0.6, verdict="suspicious"
    And AnalysisResponse.exif equals {"Make": "Canon"}
    And AnalysisResponse.heatmap_url equals "data:image/png;base64,abc"

  Scenario: assemble() clamps an out-of-range score and logs a WARNING
    Given a PipelineResult with score=1.05 (out of range)
    When assemble() is called
    Then a WARNING is logged indicating the score was clamped
    And the returned AnalysisResponse.score equals 1.0

  Scenario: Full POST /api/v1/analyse request with a valid JPEG returns 200 with all five fields
    Given the full backend pipeline is wired (ingestion, analysis, heatmap, EXIF, assembler)
    When a POST /api/v1/analyse request is sent with a valid JPEG fixture
    Then the HTTP response status is 200
    And the response Content-Type is "application/json"
    And the response body contains "score", "verdict", "heatmap_url", "exif", "regions"

  Scenario: POST /api/v1/analyse returns 504 when the pipeline exceeds ANALYSIS_TIMEOUT_SECONDS
    Given ANALYSIS_TIMEOUT_SECONDS=0.001
    And the analysis pipeline is mocked to sleep for 1 second
    When a POST /api/v1/analyse request is sent
    Then the HTTP response status is 504
    And the response body contains title "Analysis Timeout"
```

## Implementation notes
- Score clamping in `assemble()`: `score = max(0.0, min(1.0, pipeline_result.score))`.
- Log the WARNING as: `f"Score {pipeline_result.score} out of range; clamped to {score}"`. No image data in this message.
- The router endpoint must wrap the entire pipeline (ingestion, analysis, heatmap, EXIF, assemble) inside a single `asyncio.wait_for(..., timeout=settings.analysis_timeout_seconds)` block so a slow analyser triggers the 504 path.
- After the response is returned, all local variables holding image data (`raw_bytes`, `buffer`, `pipeline_result` intermediates) go out of scope; no explicit deletion required in Python, but no module-level caching of these values is permitted.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Integration test (`TestClient`) for the full happy path with a real JPEG fixture
- [ ] Integration test for the 504 timeout path (mock `run_pipeline` to sleep)
- [ ] Test for score clamping (mock aggregator to return score > 1.0)
- [ ] No PII in logs
