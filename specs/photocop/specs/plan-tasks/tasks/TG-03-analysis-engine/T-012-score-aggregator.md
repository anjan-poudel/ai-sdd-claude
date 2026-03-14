# T-012: Score Aggregator

## Metadata
- **Group:** [TG-03 — Analysis Engine](index.md)
- **Component:** Analysis Engine — `backend/app/analysis/aggregator.py`
- **Agent:** dev
- **Effort:** S
- **Risk:** MEDIUM
- **Depends on:** [T-009](T-009-ela-analyser/), [T-010](T-010-noise-analyser.md), [T-011](T-011-clone-detector.md)
- **Blocks:** [T-014](../TG-04-output-pipeline/T-014-heatmap-renderer.md), [T-015](../TG-04-output-pipeline/T-015-exif-extractor.md), [T-016](../TG-04-output-pipeline/T-016-response-assembler.md)
- **Requirements:** [FR-002](../../../define-requirements/FR/FR-002-manipulation-detection.md), [NFR-002](../../../define-requirements/NFR/NFR-002-accuracy.md)

## Description
Implement `backend/app/analysis/aggregator.py` with the `aggregate(ela_output, noise_output, clone_output, settings) -> PipelineResult` function. The function computes the final weighted score from the three sub-scores, derives the verdict string using configurable thresholds, merges and deduplicates all region lists, and returns a `PipelineResult`.

## Acceptance criteria

```gherkin
Feature: Score Aggregator

  Scenario: Weighted average is computed correctly from three sub-scores
    Given ELA sub-score=0.8, Noise sub-score=0.5, Clone sub-score=0.2
    And ELA_WEIGHT=0.4, NOISE_WEIGHT=0.3, CLONE_WEIGHT=0.3
    When aggregate() is called
    Then PipelineResult.score equals 0.8*0.4 + 0.5*0.3 + 0.2*0.3 (approximately 0.53)

  Scenario: Score of 0.2 produces verdict "authentic"
    Given three analysers all returning sub_score=0.0
    And VERDICT_THRESHOLD_AUTHENTIC=0.3
    When aggregate() is called
    Then PipelineResult.verdict equals "authentic"

  Scenario: Score of 0.5 produces verdict "suspicious"
    Given a weighted combination producing score=0.5
    And VERDICT_THRESHOLD_AUTHENTIC=0.3, VERDICT_THRESHOLD_MANIPULATED=0.7
    When aggregate() is called
    Then PipelineResult.verdict equals "suspicious"

  Scenario: Score of 0.85 produces verdict "likely manipulated"
    Given a weighted combination producing score=0.85
    And VERDICT_THRESHOLD_MANIPULATED=0.7
    When aggregate() is called
    Then PipelineResult.verdict equals "likely manipulated"

  Scenario: All regions from all three analysers appear in PipelineResult.regions
    Given ELA returns 2 regions, Noise returns 1 region, Clone returns 3 regions
    When aggregate() is called
    Then PipelineResult.regions contains all 6 regions
```

## Implementation notes
- Score formula: `score = ela_output.sub_score * settings.ela_weight + noise_output.sub_score * settings.noise_weight + clone_output.sub_score * settings.clone_weight`.
- Score must be clamped to `[0.0, 1.0]` after computation to handle any floating-point overshoot.
- Verdict derivation:
  - `score <= settings.verdict_threshold_authentic` → `"authentic"`
  - `score >= settings.verdict_threshold_manipulated` → `"likely manipulated"`
  - otherwise → `"suspicious"`
- Region deduplication: two `RegionResult` objects are considered duplicates if their `technique`, `bounding_box`, and `confidence` are identical (use `set()` with `__hash__` on the frozen dataclass).
- The function is synchronous; no async needed.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Unit tests for all three verdict boundaries with exact threshold values
- [ ] Unit test for region deduplication (duplicate regions removed)
- [ ] Type hints throughout; PEP 8 compliant
