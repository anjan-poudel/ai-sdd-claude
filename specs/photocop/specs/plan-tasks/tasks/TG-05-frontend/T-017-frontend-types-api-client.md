# T-017: TypeScript types and API client

## Metadata
- **Group:** [TG-05 — Frontend](index.md)
- **Component:** React Frontend — `frontend/src/api/types.ts`, `frontend/src/api/client.ts`
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** [T-007](../TG-02-backend-core/T-007-api-router-health.md)
- **Blocks:** [T-018](T-018-upload-form.md), [T-019](T-019-result-display.md)
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-image-upload.md), [FR-005](../../../define-requirements/FR/FR-005-json-results-export.md), [NFR-005](../../../define-requirements/NFR/NFR-005-security.md)

## Description
Implement `frontend/src/api/types.ts` with the full TypeScript type definitions (`BoundingBox`, `Technique`, `Region`, `AnalysisResult`, `ProblemDetails`, `AppPhase`, `AppState`, `ExifValue`) mirroring the backend Pydantic models exactly. Implement `frontend/src/api/client.ts` with `analyseImage(file: File): Promise<AnalyseOutcome>` using the Fetch API with `AbortController` timeout, proper error mapping, and no exposed `any` types.

## Acceptance criteria

```gherkin
Feature: TypeScript types and API client

  Scenario: analyseImage resolves to AnalyseSuccess on a 200 backend response
    Given the backend returns HTTP 200 with a valid AnalysisResult JSON body
    When analyseImage(file) is called in a test environment (MSW mock)
    Then the resolved outcome has ok=true
    And outcome.data.score is a number in [0.0, 1.0]

  Scenario: analyseImage resolves to AnalyseFailure on a 422 backend response
    Given the backend returns HTTP 422 with a ProblemDetails JSON body with title "Invalid File Content"
    When analyseImage(file) is called
    Then the resolved outcome has ok=false
    And outcome.title equals "Invalid File Content"
    And outcome.status equals 422

  Scenario: analyseImage resolves to AnalyseFailure with "Service unavailable" on a network error
    Given the network is unavailable
    When analyseImage(file) is called
    Then the resolved outcome has ok=false
    And outcome.title equals "Service unavailable"
    And no unhandled promise rejection occurs

  Scenario: TypeScript compilation succeeds with strict mode enabled
    Given tsconfig.json has "strict": true and "noImplicitAny": true
    When tsc --noEmit is run
    Then zero type errors are reported
```

## Implementation notes
- `MAX_FILE_BYTES` is read from `import.meta.env.VITE_MAX_FILE_BYTES`; default `10 * 1024 * 1024`.
- Timeout: `AbortController` with `setTimeout(abort, VITE_REQUEST_TIMEOUT_MS)` (default `30000`).
- `analyseImage` must never throw; all exception paths (network error, abort, JSON parse error) must be caught and mapped to `AnalyseFailure`.
- No `any` types permitted; use `ExifValue = string | number | boolean | null` for the EXIF dict value type.
- Field name `heatmap_url` (snake_case) must match the backend JSON key exactly — do not camelCase it.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests (vitest + msw)
- [ ] `tsc --noEmit` passes with zero errors
- [ ] No `any` in the type definitions or client code
