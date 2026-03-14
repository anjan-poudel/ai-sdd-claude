# NFR-001: In-Memory Processing

## Metadata
- **Category:** Privacy / Reliability
- **Priority:** MUST

## Description
The system must process all uploaded image data entirely in RAM. No image bytes, derived data (heatmaps, ELA outputs), or EXIF values may be written to disk, a database, object storage, or any external system at any point during or after the request lifecycle. All in-memory buffers holding image data must be released when the HTTP response has been sent.

## Acceptance criteria

```gherkin
Feature: In-Memory Processing

  Scenario: No file is written to disk during image analysis
    Given the server's filesystem write calls are monitored
    When a user uploads a 5 MB JPEG and analysis completes
    Then no new file appears under the server's working directory or /tmp that contains image data
    And the response is returned successfully with HTTP 200

  Scenario: Image buffer is not retained after response is sent
    Given a user uploads an image and the server returns the analysis response
    When a second request is made immediately after
    Then the server has no in-memory reference to the first request's image data
    And memory usage does not grow unboundedly across 100 sequential requests
```

## Related
- FR: FR-001 (Image Upload), FR-004 (EXIF Extraction)
