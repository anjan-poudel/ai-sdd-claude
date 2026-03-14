# FR-004: EXIF Extraction

## Metadata
- **Area:** Metadata Analysis
- **Priority:** MUST
- **Source:** Constitution — Core Capabilities §4; Review Criteria

## Description
The system must parse all available EXIF metadata from the uploaded image and return it as a structured JSON object under the key "exif" in the analysis response. If the image contains no EXIF data or the EXIF block is corrupt, the system must return an empty object `{}` for the "exif" field rather than an error. The extraction must handle partial or malformed EXIF blocks gracefully without aborting the overall analysis pipeline.

## Acceptance criteria

```gherkin
Feature: EXIF Extraction

  Scenario: EXIF data is returned for an image that contains metadata
    Given a user uploads a JPEG image with embedded EXIF data including GPS coordinates and camera model
    When the analysis completes
    Then the response JSON "exif" field is an object
    And it contains keys corresponding to the embedded EXIF tags (e.g. "GPSLatitude", "Make", "Model")

  Scenario: Missing EXIF data returns an empty object, not an error
    Given a user uploads a PNG image that contains no EXIF metadata
    When the analysis completes
    Then the response JSON "exif" field equals {}
    And the overall HTTP status is 200

  Scenario: Corrupt EXIF block is handled gracefully
    Given a user uploads a JPEG image with a deliberately malformed EXIF block
    When the analysis completes
    Then the response JSON "exif" field equals {}
    And the response still includes valid "score", "verdict", and "heatmap_url" fields

  Scenario: EXIF data is not persisted after the response is sent
    Given a user uploads an image containing sensitive EXIF GPS data
    When the server sends the analysis response
    Then no EXIF values appear in any server log entry for that request
```

## Related
- NFR: NFR-004 (Privacy)
- Depends on: FR-001 (Image Upload)
