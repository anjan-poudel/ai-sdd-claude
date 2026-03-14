# T-008: Analysis Engine orchestrator and shared types

## Metadata
- **Group:** [TG-03 — Analysis Engine](index.md)
- **Component:** Analysis Engine — `backend/app/analysis/engine.py`, `backend/app/analysis/types.py`
- **Agent:** dev
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** [T-006](../TG-02-backend-core/T-006-image-ingestion-service.md), [T-007](../TG-02-backend-core/T-007-api-router-health.md)
- **Blocks:** [T-009](T-009-ela-analyser/), [T-010](T-010-noise-analyser.md), [T-011](T-011-clone-detector.md)
- **Requirements:** [FR-002](../../../define-requirements/FR/FR-002-manipulation-detection.md), [NFR-001](../../../define-requirements/NFR/NFR-001-in-memory-processing.md), [NFR-003](../../../define-requirements/NFR/NFR-003-performance.md)

## Description
Define the shared dataclasses (`RegionResult`, `BoundingBox`, `AnalyserOutput`, `PipelineResult`) in `backend/app/analysis/types.py`. Implement `backend/app/analysis/engine.py` with the `run_pipeline()` coroutine that fans out to the three analysers concurrently using `asyncio.gather` (or `ThreadPoolExecutor` for CPU-bound work), collects their `AnalyserOutput` objects, and passes them to the Score Aggregator. Each analyser receives a `PIL.Image.copy()` before dispatch to ensure read-only isolation.

## Acceptance criteria

```gherkin
Feature: Analysis Engine orchestrator

  Scenario: run_pipeline fans out to all three analysers concurrently
    Given a valid ImageBuffer
    And all three analyser modules are mocked to return empty AnalyserOutput objects
    When run_pipeline(buffer, settings) is awaited
    Then all three mocked analysers are called exactly once
    And each receives a distinct PIL Image copy (not the same object reference)

  Scenario: run_pipeline returns a PipelineResult with score in [0.0, 1.0]
    Given a valid ImageBuffer with a real JPEG fixture
    And real (non-mocked) analyser implementations are wired
    When run_pipeline(buffer, settings) is awaited
    Then the returned PipelineResult.score is a float between 0.0 and 1.0 inclusive
    And PipelineResult.verdict is one of "authentic", "suspicious", "likely manipulated"

  Scenario: Original ImageBuffer.image is not mutated after pipeline execution
    Given a valid ImageBuffer
    When run_pipeline(buffer, settings) is awaited
    Then the pixel data of buffer.image is identical before and after the call

  Scenario: run_pipeline raises asyncio.TimeoutError when the pipeline exceeds the timeout
    Given ANALYSIS_TIMEOUT_SECONDS=0.001
    And at least one analyser is mocked to sleep for 1 second
    When run_pipeline is wrapped in asyncio.wait_for with timeout=0.001
    Then asyncio.TimeoutError is raised
```

## Implementation notes
- CPU-bound analysers (ELA, clone detection) must be dispatched to a `ThreadPoolExecutor` via `asyncio.get_event_loop().run_in_executor()` to avoid blocking the event loop.
- The `Image.copy()` call must happen before the analyser is dispatched; the original `buffer.image` must not be passed directly to any analyser.
- `AnalyserOutput` and `RegionResult` must be `@dataclass(frozen=True)` to prevent accidental mutation.
- `BoundingBox.x`, `BoundingBox.y`, `BoundingBox.width`, `BoundingBox.height` are all non-negative integers; validate at construction time.
- No image data may be written to disk at any point (NFR-001).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Test verifies each analyser receives a distinct `id()` PIL Image object (copy, not reference)
- [ ] Test verifies timeout propagation from `asyncio.wait_for`
- [ ] No PII in logs
- [ ] No disk writes of image data
