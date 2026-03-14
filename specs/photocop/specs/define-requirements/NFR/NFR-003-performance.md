# NFR-003: Performance

## Metadata
- **Category:** Performance
- **Priority:** MUST

## Description
The system must return the complete analysis response (score, verdict, heatmap_url, exif, regions) within 10 seconds for any image up to 10 MB in size, measured from the moment the last byte of the upload is received by the server to the moment the first byte of the HTTP response is sent. This target applies under single-user load on the reference hardware. Heatmap generation must not block the API response; if it is computed asynchronously it must be available in the same response payload.

## Acceptance criteria

```gherkin
Feature: Analysis Performance

  Scenario: Analysis of a 10 MB image completes within 10 seconds
    Given a JPEG image of exactly 10 MB
    When the image is submitted to POST /api/v1/analyse
    Then the server sends the HTTP response within 10 seconds of completing the upload
    And the response status is 200

  Scenario: Analysis of a 1 MB image completes within 5 seconds
    Given a JPEG image of 1 MB
    When the image is submitted to POST /api/v1/analyse
    Then the server sends the HTTP response within 5 seconds of completing the upload
    And the response status is 200

  Scenario: Health check responds within 200 ms
    Given the PhotoCop backend service is running
    When a client sends GET /health
    Then the server sends the HTTP 200 response within 200 milliseconds
```

## Related
- FR: FR-002 (Manipulation Detection), FR-003 (Heatmap Generation), FR-005 (JSON Results Export)
