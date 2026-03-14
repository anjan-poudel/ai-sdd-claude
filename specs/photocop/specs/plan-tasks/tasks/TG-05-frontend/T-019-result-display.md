# T-019: ResultPanel, HeatmapDisplay, ExifTable, RegionList, ErrorBanner

## Metadata
- **Group:** [TG-05 — Frontend](index.md)
- **Component:** React Frontend — `frontend/src/components/`
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-017](T-017-frontend-types-api-client.md)
- **Blocks:** [T-020-fe](T-020-fe-frontend-integration-test.md)
- **Requirements:** [FR-003](../../../define-requirements/FR/FR-003-heatmap-generation.md), [FR-004](../../../define-requirements/FR/FR-004-exif-extraction.md), [FR-005](../../../define-requirements/FR/FR-005-json-results-export.md), [NFR-004](../../../define-requirements/NFR/NFR-004-privacy.md)

## Description
Implement the display components: `ResultPanel` (composes `HeatmapDisplay`, `ExifTable`, `RegionList`), `HeatmapDisplay` (renders the heatmap data URI as `<img>` with score percentage and colour-coded verdict badge), `ExifTable` (key/value table with empty-state fallback), `RegionList` (annotated list of flagged regions), `ErrorBanner` (displays RFC 7807 `title`; never exposes 5xx detail), and `LoadingSpinner`.

## Acceptance criteria

```gherkin
Feature: Result display components

  Scenario: HeatmapDisplay renders the heatmap image inline without page reload
    Given an AnalysisResult with a valid data URI in heatmap_url
    When ResultPanel renders in the browser
    Then an <img> element with src equal to heatmap_url is present in the DOM
    And the browser URL does not change

  Scenario: HeatmapDisplay shows a green badge for an authentic verdict
    Given score=0.2 and verdict="authentic"
    When HeatmapDisplay renders
    Then the verdict badge has a CSS class or style indicating green colour

  Scenario: HeatmapDisplay shows a red badge for a likely manipulated verdict
    Given score=0.85 and verdict="likely manipulated"
    When HeatmapDisplay renders
    Then the verdict badge has a CSS class or style indicating red colour

  Scenario: ExifTable renders a fallback message when exif is empty
    Given exif={}
    When ExifTable renders
    Then the text "No EXIF metadata available" (or equivalent) is visible in the DOM
    And no table rows for EXIF data are rendered

  Scenario: ErrorBanner displays the ProblemDetails title for a 4xx error
    Given the backend returned HTTP 422 with title "Invalid File Content"
    When ErrorBanner renders with that message
    Then the text "Invalid File Content" is visible in the DOM

  Scenario: ErrorBanner does not display an internal stack trace or status code for 5xx errors
    Given the backend returned HTTP 500
    When App transitions to error phase
    Then the ErrorBanner displays "Service unavailable" (or equivalent generic message)
    And no "500" or "Internal Server Error" text appears in the user-visible output
```

## Implementation notes
- `HeatmapDisplay` score colour thresholds: green (`score <= 0.3`), amber (`score > 0.3 && score < 0.7`), red (`score >= 0.7`).
- `RegionList` renders each `Region` as a list item with technique name, confidence percentage, and bounding box coordinates.
- `ErrorBanner` must only display `outcome.title` for 4xx errors; for 5xx or network errors it must display the static string `"Service unavailable — please try again."`.
- `LoadingSpinner` is shown when `phase === "uploading"` or `phase === "analysing"`.
- All components must be typed with explicit prop interfaces; no `any` permitted.
- No third-party analytics or tracking imports (NFR-004).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests (vitest + @testing-library/react)
- [ ] Test: `<img>` with `src` matching the `heatmap_url` data URI is rendered
- [ ] Test: ExifTable renders "No EXIF metadata available" when `exif={}` is passed
- [ ] Test: ErrorBanner does not render "500" or "Traceback" for 5xx inputs
- [ ] `tsc --noEmit` passes with zero errors
- [ ] No `any` in any component file
