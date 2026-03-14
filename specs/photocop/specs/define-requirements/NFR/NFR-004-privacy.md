# NFR-004: Privacy

## Metadata
- **Category:** Privacy
- **Priority:** MUST

## Description
The system must not retain, log, or transmit any user-identifiable data after the HTTP response for a request is sent. This covers: image pixel data, derived images (heatmaps, ELA outputs), EXIF metadata values (including GPS coordinates, device identifiers), and any other request payload content. Server access logs may record the HTTP method, path, status code, and response time, but must not record file content, EXIF values, or any portion of the response body. No third-party analytics or tracking must be embedded in either the frontend or backend.

## Acceptance criteria

```gherkin
Feature: Privacy

  Scenario: EXIF GPS data does not appear in server logs
    Given server-side logging is configured at INFO level
    When a user uploads a JPEG image containing GPS coordinates in its EXIF block
    And the server returns the analysis response
    Then no log line contains the GPS latitude or longitude values from that image

  Scenario: Image binary data does not appear in server logs
    Given server-side logging is configured at DEBUG level
    When a user uploads any supported image file
    Then no log line contains a base64-encoded or raw binary representation of the image data

  Scenario: Repeated requests do not cause data accumulation
    Given 50 sequential analysis requests each with unique images
    When all 50 requests have completed
    Then no image data from any prior request is accessible in the server process memory or filesystem
```

## Related
- FR: FR-001 (Image Upload), FR-004 (EXIF Extraction)
- NFR: NFR-001 (In-Memory Processing)
