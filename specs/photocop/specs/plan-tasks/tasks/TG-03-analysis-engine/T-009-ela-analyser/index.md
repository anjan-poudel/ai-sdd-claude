# T-009: ELA Analyser

## Metadata
- **Group:** [TG-03 — Analysis Engine](../index.md)
- **Component:** Analysis Engine — `backend/app/analysis/ela.py`
- **Effort:** L (T-009-a: M + T-009-b: S)
- **Risk:** HIGH
- **Depends on:** [T-008](../T-008-analysis-engine-orchestrator.md)
- **Blocks:** [T-012](../T-012-score-aggregator.md)
- **Requirements:** [FR-002](../../../../define-requirements/FR/FR-002-manipulation-detection.md), [NFR-001](../../../../define-requirements/NFR/NFR-001-in-memory-processing.md), [NFR-002](../../../../define-requirements/NFR/NFR-002-accuracy.md)

## Description
Implements Error Level Analysis (ELA): the image is re-saved to an in-memory buffer at a configurable JPEG quality level, the absolute pixel difference between the original and re-saved version is computed and amplified, and regions with anomalously high ELA values are returned as `RegionResult` objects. Split into two subtasks to allow parallel development: the core algorithm (T-009-a) and the unit-test suite with benchmark fixtures (T-009-b).

## Subtasks

| ID | Title | Effort | Depends on |
|----|-------|--------|------------|
| [T-009-a](T-009-a-ela-algorithm.md) | ELA algorithm implementation | M | T-008 |
| [T-009-b](T-009-b-ela-tests.md) | ELA unit tests and benchmark fixtures | S | T-009-a |

## Shared acceptance criteria

```gherkin
Feature: ELA Analyser end-to-end

  Scenario: ELA returns a low sub-score for an authentic unmodified JPEG
    Given an unmodified authentic JPEG fixture (authentic.jpg)
    When run_ela(image_copy, settings) is called
    Then the returned AnalyserOutput.sub_score is less than 0.4
    And AnalyserOutput.technique equals "ELA"

  Scenario: ELA returns a high sub-score for a known-manipulated image
    Given a JPEG fixture with a known spliced region (manipulated.png)
    When run_ela(image_copy, settings) is called
    Then the returned AnalyserOutput.sub_score is greater than 0.6
    And at least one RegionResult is present in AnalyserOutput.regions

  Scenario: ELA does not write any intermediate file to disk
    Given the server filesystem write calls are monitored
    When run_ela(image_copy, settings) is called on any JPEG fixture
    Then no new file appears on disk under /tmp or the working directory
```

## Definition of done
- [ ] All subtasks completed and merged
- [ ] End-to-end integration test passing (shared acceptance criteria above)
- [ ] ELA sub-score achieves < 15% false-positive rate on a 50-image authentic subset (NFR-002)
- [ ] No disk writes of intermediate ELA buffers
