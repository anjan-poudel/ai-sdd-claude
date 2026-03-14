# FR-003: Heatmap Generation

## Metadata
- **Area:** Visualisation
- **Priority:** MUST
- **Source:** Constitution — Core Capabilities §3; Review Criteria

## Description
The system must generate a heatmap overlay image that visually highlights suspicious or manipulated regions detected during analysis. The heatmap must be superimposed on the original image using a colour scale that distinguishes high-confidence anomaly regions from low-confidence ones. The heatmap image must be returned as a URL or inline data URI in the JSON response under the key "heatmap_url". The frontend must display the heatmap inline without a full page reload.

## Acceptance criteria

```gherkin
Feature: Heatmap Generation

  Scenario: Heatmap is returned for every successfully analysed image
    Given a user uploads a supported image file
    When the analysis completes successfully
    Then the response JSON contains a non-null "heatmap_url" field
    And the value is either a data URI beginning with "data:image/" or an absolute URL

  Scenario: Heatmap highlights the manipulated region of a cloned image
    Given a user uploads a JPEG image with a known cloned region in the top-right quadrant
    When the analysis completes
    Then the response JSON "regions" array contains at least one entry
    And that entry's bounding box coordinates overlap the top-right quadrant of the image

  Scenario: Heatmap is displayed inline on the frontend without page reload
    Given a user has submitted an image and received a successful analysis response
    When the frontend renders the result
    Then the heatmap image appears within the current page view
    And the browser does not navigate to a new URL

  Scenario: Authentic image with no detected regions produces a blank heatmap
    Given a user uploads an unmodified original photograph
    When the analysis completes
    Then the "regions" array in the response is empty or absent
    And the "heatmap_url" field is still present and points to a valid image
```

## Related
- NFR: NFR-003 (Performance)
- Depends on: FR-001 (Image Upload), FR-002 (Manipulation Detection)
