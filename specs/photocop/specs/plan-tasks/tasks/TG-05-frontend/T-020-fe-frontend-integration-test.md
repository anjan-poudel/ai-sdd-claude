# T-020-fe: Frontend integration test (MSW)

## Metadata
- **Group:** [TG-05 — Frontend](index.md)
- **Component:** React Frontend — `frontend/src/tests/`
- **Agent:** dev
- **Effort:** S
- **Risk:** MEDIUM
- **Depends on:** [T-018](T-018-upload-form.md), [T-019](T-019-result-display.md)
- **Blocks:** [T-021](../TG-06-quality-integration/T-021-qa-sign-off.md)
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-image-upload.md), [FR-003](../../../define-requirements/FR/FR-003-heatmap-generation.md), [FR-005](../../../define-requirements/FR/FR-005-json-results-export.md)

## Description
Write frontend integration tests using `vitest` and `msw` (Mock Service Worker) that render the full `App` component, simulate a file upload, intercept the `POST /api/v1/analyse` request via MSW, and assert that the `ResultPanel` renders the correct data. Also assert error-path rendering for 422 and 5xx MSW-injected responses.

## Acceptance criteria

```gherkin
Feature: Frontend integration tests

  Scenario: Full app renders ResultPanel after a successful mock analysis response
    Given the App component is rendered in jsdom
    And MSW intercepts POST /api/v1/analyse and returns a mock AnalysisResult
    When the user selects a 1 KB JPEG fixture file
    Then ResultPanel appears in the DOM
    And an <img> element with a data URI src is visible
    And the score is displayed as a percentage

  Scenario: Upload button is disabled while the mock request is in-flight
    Given the App component is rendered
    And MSW intercepts POST /api/v1/analyse with a 200 ms delay
    When the user selects a file and the request starts
    Then the upload button is disabled during the request
    And becomes enabled after the response is received

  Scenario: ErrorBanner appears on a MSW-injected 422 response
    Given MSW intercepts POST /api/v1/analyse and returns HTTP 422 with title "Invalid File Content"
    When the user selects a file
    Then ErrorBanner renders with the text "Invalid File Content"
    And ResultPanel is not visible
```

## Implementation notes
- Use `@testing-library/react` for rendering and user interactions.
- Use `msw/browser` with `setupServer` (vitest + jsdom environment).
- The 1 KB JPEG fixture can be a tiny synthetic JPEG created with PIL and committed to `frontend/src/tests/fixtures/`.
- Simulate file selection using `userEvent.upload(input, file)` from `@testing-library/user-event`.
- Assert `getByRole("img")` for the heatmap image; assert `queryByRole("img")` is null when in the error state.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] All tests pass in CI via `vitest run`
- [ ] `tsc --noEmit` passes with zero errors
