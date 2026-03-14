# T-013: Shared Pydantic response types

## Metadata
- **Group:** [TG-04 — Output Pipeline](index.md)
- **Component:** FastAPI Backend — `backend/app/assembler.py` (type definitions only)
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** [T-007](../TG-02-backend-core/T-007-api-router-health.md)
- **Blocks:** [T-014](T-014-heatmap-renderer.md), [T-015](T-015-exif-extractor.md), [T-016](T-016-response-assembler.md)
- **Requirements:** [FR-005](../../../define-requirements/FR/FR-005-json-results-export.md)

## Description
Define the Pydantic v2 response models (`BoundingBoxResponse`, `RegionResponse`, `AnalysisResponse`) in `backend/app/assembler.py`. These models are the serialisation contract between the backend and the frontend, so all field names and types must exactly match the L2 design specification and the TypeScript types in `frontend/src/api/types.ts`.

## Acceptance criteria

```gherkin
Feature: Shared Pydantic response types

  Scenario: AnalysisResponse serialises to the expected JSON schema
    Given an AnalysisResponse instance with score=0.5, verdict="suspicious", heatmap_url="data:image/png;base64,abc", exif={}, regions=[]
    When the model is serialised with model.model_dump()
    Then the resulting dict contains keys "score", "verdict", "heatmap_url", "exif", "regions"
    And "score" equals 0.5
    And "verdict" equals "suspicious"

  Scenario: AnalysisResponse rejects a score outside [0.0, 1.0]
    Given score=-0.1
    When AnalysisResponse is instantiated
    Then a Pydantic ValidationError is raised

  Scenario: RegionResponse rejects an invalid technique string
    Given technique="invalid_technique"
    When RegionResponse is instantiated
    Then a Pydantic ValidationError is raised
```

## Implementation notes
- `AnalysisResponse.score`: `Annotated[float, Field(ge=0.0, le=1.0)]`.
- `AnalysisResponse.verdict`: `Literal["authentic", "suspicious", "likely manipulated"]`.
- `RegionResponse.technique`: `Literal["ELA", "noise_analysis", "clone_detection"]`.
- `RegionResponse.confidence`: `Annotated[float, Field(ge=0.0, le=1.0)]`.
- `BoundingBoxResponse` fields (`x`, `y`, `width`, `height`): all `int`, non-negative.
- Use Pydantic v2 syntax throughout; no v1 `validator` decorators.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] TypeScript `api/types.ts` field names verified to match Python model field names exactly
