# T-010: Noise Analyser

## Metadata
- **Group:** [TG-03 — Analysis Engine](index.md)
- **Component:** Analysis Engine — `backend/app/analysis/noise.py`
- **Agent:** dev
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** [T-008](T-008-analysis-engine-orchestrator.md)
- **Blocks:** [T-012](T-012-score-aggregator.md)
- **Requirements:** [FR-002](../../../define-requirements/FR/FR-002-manipulation-detection.md), [NFR-001](../../../define-requirements/NFR/NFR-001-in-memory-processing.md), [NFR-002](../../../define-requirements/NFR/NFR-002-accuracy.md)

## Description
Implement `backend/app/analysis/noise.py` with `run_noise(image: PIL.Image.Image, settings: Settings) -> AnalyserOutput`. The function estimates the local noise residual by subtracting a denoised version of the image (Gaussian or bilateral filter) from the original, identifies regions with statistically anomalous noise variance, and returns `RegionResult` objects for those regions alongside a sub-score.

## Acceptance criteria

```gherkin
Feature: Noise Analyser

  Scenario: Noise Analyser returns an AnalyserOutput with technique "noise_analysis"
    Given a PIL Image in RGB mode
    When run_noise(image, settings) is called
    Then the returned AnalyserOutput.technique equals "noise_analysis"
    And AnalyserOutput.sub_score is a float in [0.0, 1.0]

  Scenario: Uniform synthetic image (constant colour) produces a near-zero noise score
    Given a 100x100 PIL Image filled with a single constant colour (no texture)
    When run_noise(image, settings) is called
    Then AnalyserOutput.sub_score is less than 0.1
    And AnalyserOutput.regions is an empty list

  Scenario: Image with a spliced region of different noise character scores higher than authentic
    Given an authentic JPEG fixture and a version with a region pasted from a different image
    When run_noise is called on both
    Then sub_score(manipulated) >= sub_score(authentic)

  Scenario: Noise Analyser does not write to disk
    Given filesystem write calls are monitored
    When run_noise(image, settings) is called
    Then no new file is created under /tmp or the working directory

  Scenario: Noise Analyser handles a greyscale image without error
    Given a PIL Image in mode "L" (greyscale)
    When run_noise(image, settings) is called
    Then an AnalyserOutput is returned without raising an exception
```

## Implementation notes
- Convert image to NumPy array (`np.array`) before filtering; work with float32 to prevent overflow.
- Denoising: use `cv2.GaussianBlur` with configurable kernel size `NOISE_KERNEL_SIZE` (default `(5, 5)`), read from `Settings`.
- Noise residual: `residual = original_float - denoised_float`.
- Anomaly detection: compute variance per block (e.g. 16x16 px); blocks with variance > `NOISE_VARIANCE_THRESHOLD` (default 3.0 std deviations above the image mean) are flagged.
- Sub-score: proportion of pixels in high-variance blocks, clamped to `[0.0, 1.0]`.
- The function must be synchronous (called via `run_in_executor` from the engine orchestrator).
- No disk writes at any step (NFR-001).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Unit test for uniform-colour image produces score < 0.1
- [ ] Unit test asserts greyscale input does not raise
- [ ] Type hints throughout; PEP 8 compliant
- [ ] No disk writes of image data
