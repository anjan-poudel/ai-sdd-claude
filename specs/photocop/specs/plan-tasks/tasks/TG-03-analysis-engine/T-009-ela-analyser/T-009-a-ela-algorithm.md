# T-009-a: ELA algorithm implementation

## Metadata
- **Parent task:** [T-009](index.md)
- **Subtask ID:** T-009-a
- **Group:** [TG-03 — Analysis Engine](../index.md)
- **Component:** Analysis Engine — `backend/app/analysis/ela.py`
- **Agent:** dev
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** [T-008](../T-008-analysis-engine-orchestrator.md)
- **Blocks:** [T-009-b](T-009-b-ela-tests.md)
- **Requirements:** [FR-002](../../../../define-requirements/FR/FR-002-manipulation-detection.md), [NFR-001](../../../../define-requirements/NFR/NFR-001-in-memory-processing.md), [NFR-002](../../../../define-requirements/NFR/NFR-002-accuracy.md)

## Description
Implement the `run_ela(image: PIL.Image.Image, settings: Settings) -> AnalyserOutput` function in `backend/app/analysis/ela.py`. The function re-saves the image at `settings.ela_quality` JPEG quality into an in-memory `BytesIO` buffer, reloads it, computes the absolute per-channel pixel difference, amplifies the result, identifies connected high-anomaly regions above a configurable threshold, and returns the corresponding `RegionResult` objects and a normalised sub-score.

## Acceptance criteria

```gherkin
Feature: ELA algorithm

  Scenario: ELA produces an AnalyserOutput with the correct technique label
    Given a PIL Image in RGB mode
    When run_ela(image, settings) is called
    Then the returned AnalyserOutput.technique equals "ELA"
    And AnalyserOutput.sub_score is a float in [0.0, 1.0]

  Scenario: ELA re-save uses in-memory BytesIO, not a disk file
    Given a PIL Image
    When run_ela(image, settings) is called
    Then no file is opened in write mode on the filesystem
    And no path under /tmp is created

  Scenario: ELA with ELA_QUALITY=95 produces lower anomaly scores than ELA_QUALITY=30
    Given the same authentic JPEG image
    When run_ela is called once with ELA_QUALITY=95 and once with ELA_QUALITY=30
    Then the sub_score for ELA_QUALITY=95 is lower than for ELA_QUALITY=30

  Scenario: ELA raises no exception on a single-pixel image
    Given a 1x1 RGB PIL Image
    When run_ela(image, settings) is called
    Then an AnalyserOutput is returned without raising an exception
    And the regions list is empty
```

## Implementation notes
- Re-save pattern: `buf = io.BytesIO(); image.save(buf, "JPEG", quality=settings.ela_quality); buf.seek(0); ela_image = PIL.Image.open(buf).convert("RGB")`.
- Do not call `buf.getvalue()` and write it to disk; keep the buffer in memory only.
- Pixel difference: `np.abs(np.array(image, dtype=np.int16) - np.array(ela_image, dtype=np.int16))`.
- Amplification scale factor: configurable via `ELA_AMPLIFY` (default 10), read from `Settings`.
- Region detection: use `skimage.measure.label` on a binary threshold mask; compute bounding boxes with `skimage.measure.regionprops`.
- Sub-score normalisation: `mean(diff_array) / 255.0` clamped to `[0.0, 1.0]`.
- The function must be synchronous (called via `run_in_executor` from the engine orchestrator).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Type hints throughout; no `Any` types
- [ ] PEP 8 compliant (ruff/flake8 clean)
- [ ] No disk writes verified by mocking `open()` in tests
