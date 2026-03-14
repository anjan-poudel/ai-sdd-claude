# T-011: Clone Detector

## Metadata
- **Group:** [TG-03 — Analysis Engine](index.md)
- **Component:** Analysis Engine — `backend/app/analysis/clone.py`
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** [T-008](T-008-analysis-engine-orchestrator.md)
- **Blocks:** [T-012](T-012-score-aggregator.md)
- **Requirements:** [FR-002](../../../define-requirements/FR/FR-002-manipulation-detection.md), [NFR-001](../../../define-requirements/NFR/NFR-001-in-memory-processing.md), [NFR-002](../../../define-requirements/NFR/NFR-002-accuracy.md), [NFR-003](../../../define-requirements/NFR/NFR-003-performance.md)

## Description
Implement `backend/app/analysis/clone.py` with `run_clone(image: PIL.Image.Image, settings: Settings) -> AnalyserOutput`. The detector computes dense keypoint descriptors (ORB preferred over SIFT for performance; SIFT available as a config option) and identifies clusters of matching descriptors that correspond to spatially separated image patches. Matched region pairs are returned as `RegionResult` objects with the lower-confidence bounding box of each pair.

## Acceptance criteria

```gherkin
Feature: Clone Detector

  Scenario: Clone Detector returns AnalyserOutput with technique "clone_detection"
    Given a PIL Image in RGB mode
    When run_clone(image, settings) is called
    Then the returned AnalyserOutput.technique equals "clone_detection"
    And AnalyserOutput.sub_score is a float in [0.0, 1.0]

  Scenario: Image with copy-moved region produces at least one RegionResult
    Given a JPEG image where a 50x50 region has been copied and pasted to a distinct location
    When run_clone(image, settings) is called
    Then AnalyserOutput.regions contains at least one RegionResult
    And that RegionResult's bounding_box overlaps the pasted region

  Scenario: Authentic image with no duplicated regions produces an empty regions list
    Given an unmodified authentic photograph fixture
    When run_clone(image, settings) is called
    Then AnalyserOutput.regions is empty or contains only low-confidence entries
    And AnalyserOutput.sub_score is less than 0.3

  Scenario: Clone Detector completes within the per-request timeout for a 10 MB image
    Given a valid 10 MB JPEG image
    When run_clone(image, settings) is called within asyncio.wait_for(timeout=9)
    Then it completes before the timeout expires
    And an AnalyserOutput is returned

  Scenario: Clone Detector does not write to disk
    Given filesystem write calls are monitored
    When run_clone(image, settings) is called
    Then no new file is created under /tmp or the working directory
```

## Implementation notes
- Use ORB descriptor by default (`cv2.ORB_create()`); configurable to SIFT via `CLONE_DESCRIPTOR` env var (default `"ORB"`).
- Downscale large images before descriptor computation to meet the performance target (NFR-003): if the image width or height exceeds `CLONE_MAX_DIM` (default `1024`), resize to fit within 1024 px on the longest side before descriptor extraction.
- BFMatcher with `crossCheck=True`; filter matches by distance ratio (< `CLONE_MATCH_RATIO`, default `0.75`) and minimum spatial separation (> `CLONE_MIN_SEPARATION_PX`, default `50`) to exclude adjacent-region false positives.
- Each matched pair contributes one `RegionResult` per matched keypoint cluster; confidence = `1.0 - (match.distance / max_distance)`.
- Sub-score: `min(1.0, len(filtered_matches) / CLONE_MATCH_SCORE_DIVISOR)` where `CLONE_MATCH_SCORE_DIVISOR` defaults to `10`.
- The function is synchronous (called via `run_in_executor`).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Performance test asserts that a 10 MB JPEG completes within 9 seconds on CI hardware
- [ ] Test verifies image is resized before descriptor extraction when width > CLONE_MAX_DIM
- [ ] No disk writes of image data (NFR-001)
- [ ] Type hints throughout; PEP 8 compliant
