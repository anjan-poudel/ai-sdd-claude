# NFR-002: Accuracy

## Metadata
- **Category:** Reliability
- **Priority:** MUST

## Description
The manipulation detection pipeline must achieve a false-positive rate no greater than 15% and a false-negative rate no greater than 15% when evaluated against a labelled benchmark dataset of at least 200 images (100 authentic, 100 manipulated). Detection must use established forensic techniques: Error Level Analysis (ELA), noise analysis, and clone detection. Results must be explainable — every region flagged as suspicious must carry the name of the technique that identified it.

## Acceptance criteria

```gherkin
Feature: Detection Accuracy

  Scenario: False-positive rate does not exceed 15% on benchmark dataset
    Given a labelled set of 100 unmodified authentic images
    When each image is submitted individually to the analysis endpoint
    Then no more than 15 images receive a "verdict" of "suspicious" or "likely manipulated"

  Scenario: False-negative rate does not exceed 15% on benchmark dataset
    Given a labelled set of 100 images each containing a verified manipulation
    When each image is submitted individually to the analysis endpoint
    Then no more than 15 images receive a "verdict" of "authentic"

  Scenario: Every flagged region identifies the forensic technique that detected it
    Given a user uploads an image that triggers at least one suspicious region
    When the analysis completes
    Then each entry in the "regions" array contains a non-empty "technique" field
    And the value is one of "ELA", "noise_analysis", or "clone_detection"
```

## Related
- FR: FR-002 (Manipulation Detection), FR-003 (Heatmap Generation)
