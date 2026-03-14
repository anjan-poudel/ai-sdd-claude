# T-018: UploadForm component and useAnalyse hook

## Metadata
- **Group:** [TG-05 — Frontend](index.md)
- **Component:** React Frontend — `frontend/src/components/UploadForm.tsx`, `frontend/src/hooks/useAnalyse.ts`, `frontend/src/App.tsx`
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-017](T-017-frontend-types-api-client.md)
- **Blocks:** [T-020-fe](T-020-fe-frontend-integration-test.md)
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-image-upload.md), [NFR-004](../../../define-requirements/NFR/NFR-004-privacy.md)

## Description
Implement the `UploadForm` component (drag-and-drop + file picker, client-side size validation, disabled state during upload), the `useAnalyse` hook (state machine managing `AppPhase` transitions, one in-flight request at a time, abort on unmount), and the `App` component (top-level state owner dispatching transitions and rendering the correct panel for each phase).

## Acceptance criteria

```gherkin
Feature: UploadForm and useAnalyse hook

  Scenario: File larger than 10 MB is rejected client-side before any network call
    Given a file of 11 MB
    When the user drops it onto the UploadForm
    Then an inline validation error appears within the form
    And analyseImage is not called
    And no network request is made

  Scenario: Valid file triggers phase transition to "uploading" then "analysing"
    Given a file of 2 MB with a supported MIME type
    And analyseImage is mocked to resolve after 100 ms
    When the user selects the file
    Then the phase transitions from "idle" to "uploading" then to "analysing"
    And the upload button is disabled during "analysing"

  Scenario: Upload button is disabled while a request is in-flight
    Given phase is "analysing"
    When the UploadForm renders
    Then the file input or submit button has the disabled attribute

  Scenario: useAnalyse reset() returns phase to "idle" and clears result and error
    Given phase is "result" and result is a non-null AnalysisResult
    When reset() is called
    Then phase equals "idle"
    And result is null
    And error is null
```

## Implementation notes
- `UploadForm` uses `<input type="file" accept="image/jpeg,image/png,image/webp,image/tiff,image/bmp">` for the MIME filter.
- Drag-and-drop: `onDragOver` and `onDrop` events on the drop zone `<div>`; extract `event.dataTransfer.files[0]`.
- Client-side size check: `if (file.size > MAX_FILE_BYTES)` show inline error, do not call `onFileSelected`.
- `useAnalyse.submit()` is a no-op if `phase !== "idle"` (single-in-flight enforcement).
- `AbortController` is created per `submit()` call; abort is called in the `useEffect` cleanup to cancel the fetch on component unmount.
- No third-party analytics or tracking may be imported (NFR-004).
- `App.tsx` owns `AppState` via `useAnalyse()`; renders `<UploadForm>`, `<ResultPanel>`, `<ErrorBanner>`, `<LoadingSpinner>` based on `phase`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests (vitest + @testing-library/react)
- [ ] Test: `onFileSelected` is NOT called for an oversized file
- [ ] Test: upload button `disabled` attribute is set when `phase !== "idle"`
- [ ] No `any` in component or hook code
- [ ] `tsc --noEmit` passes with zero errors
