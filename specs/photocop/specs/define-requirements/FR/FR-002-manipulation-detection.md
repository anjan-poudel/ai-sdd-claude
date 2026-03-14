# FR-002: Manipulation Detection

## Metadata
- **Area:** Image Analysis
- **Priority:** MUST
- **Source:** Constitution — Core Capabilities §2; Review Criteria

## Description
The system must analyse a validated uploaded image for forensic indicators of manipulation, including Error Level Analysis (ELA), noise inconsistencies, cloning artefacts, and splicing. The system must produce a manipulation probability score in the range [0.0, 1.0], where 0.0 indicates no detected manipulation and 1.0 indicates high confidence of manipulation. The system must also produce a human-readable verdict string (e.g. "authentic", "suspicious", "likely manipulated") derived from the score. The detection result must be explainable — each detected region must be annotated with the technique that flagged it.

## Acceptance criteria

```gherkin
Feature: Manipulation Detection

  Scenario: Authentic image receives low manipulation score
    Given a user uploads an unmodified original JPEG photograph
    When the analysis completes
    Then the response JSON contains a "score" between 0.0 and 0.3 inclusive
    And the "verdict" field equals "authentic"

  Scenario: Manipulated image receives high manipulation score
    Given a user uploads a JPEG image with a known cloned region
    When the analysis completes
    Then the response JSON contains a "score" greater than 0.7
    And the "verdict" field equals "likely manipulated"

  Scenario: Response always contains score and verdict fields
    Given a user uploads any supported image file
    When the analysis completes
    Then the response JSON contains a non-null "score" field of type number
    And the response JSON contains a non-null "verdict" field of type string

  Scenario: Corrupted image file returns a graceful error
    Given a user uploads a file with a valid JPEG magic byte but truncated binary content
    When the server attempts analysis
    Then the server returns HTTP 422
    And the response body is RFC 7807 Problem Details JSON with title "Image Processing Error"
```

## Related
- NFR: NFR-002 (Accuracy), NFR-003 (Performance)
- Depends on: FR-001 (Image Upload)
