# FR-005: JSON Results Export

## Metadata
- **Area:** API Response
- **Priority:** MUST
- **Source:** Constitution — Core Capabilities §5; API Design Standards

## Description
The system must return a unified JSON results object upon successful analysis. The response must conform to the schema `{ score: number, verdict: string, heatmap_url: string, exif: object, regions: array }`. The API endpoint must be located at `POST /api/v1/analyse`. Error responses must use RFC 7807 Problem Details format. A health check endpoint must be available at `GET /health` that returns HTTP 200 when the service is operational.

## Acceptance criteria

```gherkin
Feature: JSON Results Export

  Scenario: Successful analysis returns the full unified JSON report
    Given a user uploads a valid JPEG image
    When the server completes analysis
    Then the HTTP response status is 200
    And the response Content-Type header is "application/json"
    And the response body contains all five fields: "score", "verdict", "heatmap_url", "exif", "regions"
    And "score" is a number between 0.0 and 1.0 inclusive
    And "verdict" is a non-empty string
    And "heatmap_url" is a non-empty string
    And "exif" is a JSON object
    And "regions" is a JSON array

  Scenario: Error response conforms to RFC 7807 Problem Details
    Given a user uploads a file that exceeds the 10 MB size limit
    When the server rejects the request
    Then the HTTP response status is 413
    And the response Content-Type header is "application/problem+json"
    And the response body contains "type", "title", and "status" fields

  Scenario: Health check endpoint returns 200
    Given the PhotoCop backend service is running
    When a client sends GET /health
    Then the HTTP response status is 200

  Scenario: Analysis endpoint is not reachable at an undocumented path
    Given the PhotoCop backend service is running
    When a client sends POST /analyse (without the /api/v1/ prefix)
    Then the HTTP response status is 404
```

## Related
- NFR: NFR-003 (Performance), NFR-005 (Security)
- Depends on: FR-002 (Manipulation Detection), FR-003 (Heatmap Generation), FR-004 (EXIF Extraction)
