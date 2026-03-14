# T-014: Heatmap Renderer

## Metadata
- **Group:** [TG-04 — Output Pipeline](index.md)
- **Component:** Heatmap Renderer — `backend/app/heatmap.py`
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-012](../TG-03-analysis-engine/T-012-score-aggregator.md), [T-013](T-013-shared-response-types.md)
- **Blocks:** [T-016](T-016-response-assembler.md)
- **Requirements:** [FR-003](../../../define-requirements/FR/FR-003-heatmap-generation.md), [NFR-001](../../../define-requirements/NFR/NFR-001-in-memory-processing.md), [NFR-003](../../../define-requirements/NFR/NFR-003-performance.md)

## Description
Implement `backend/app/heatmap.py` with `render(original: PIL.Image.Image, regions: list[RegionResult], alpha: float) -> str`. The function composites a colour-coded semi-transparent overlay onto the original image for each flagged region, encodes the result as PNG in a `BytesIO` buffer, and returns a `data:image/png;base64,...` data URI. If compositing fails, it logs a WARNING and returns the original image as the data URI. No disk writes at any step.

## Acceptance criteria

```gherkin
Feature: Heatmap Renderer

  Scenario: Renderer returns a data URI for a valid image with regions
    Given a 100x100 RGB PIL Image
    And a list containing one RegionResult with bounding_box (x=10, y=10, width=20, height=20) and confidence=0.8
    When render(image, regions, alpha=0.5) is called
    Then the returned string starts with "data:image/png;base64,"
    And the base64 portion decodes to a valid PNG

  Scenario: Renderer returns the original image as a data URI when regions is empty
    Given a 100x100 RGB PIL Image
    And an empty regions list
    When render(image, [], alpha=0.5) is called
    Then the returned string starts with "data:image/png;base64,"
    And the decoded PNG matches the original image dimensions

  Scenario: Renderer does not write any file to disk
    Given filesystem write calls are monitored
    When render(image, regions, alpha=0.5) is called with any input
    Then no new file appears under /tmp or the working directory

  Scenario: Renderer returns original image URI when a region has a malformed bounding box
    Given a RegionResult with bounding_box (x=-1, y=-1, width=0, height=0)
    When render(image, [malformed_region], alpha=0.5) is called
    Then a WARNING is logged
    And the returned string is a valid data URI of the original image
    And no exception is raised
```

## Implementation notes
- Colour scale: map `confidence` to a colour using `matplotlib.cm.RdYlGn_r` (reversed: low confidence = green, high = red). Use `matplotlib.colors.to_rgba(cmap(confidence))`.
- Overlay compositing: create a transparent RGBA overlay image with `PIL.Image.new("RGBA", original.size, (0,0,0,0))`; draw filled rectangles with `PIL.ImageDraw.Draw(overlay).rectangle(...)` using the mapped RGBA colour with alpha channel = `int(alpha * 255)`.
- Composite: `PIL.Image.alpha_composite(original.convert("RGBA"), overlay)`.
- Encoding: `buf = io.BytesIO(); result.save(buf, "PNG"); encoded = base64.b64encode(buf.getvalue()).decode(); return f"data:image/png;base64,{encoded}"`.
- Error handling: wrap the compositing loop in a try/except; on exception log `WARNING: heatmap overlay failed for region: <ExceptionType>` (no image data in log), skip the region, and continue.
- Privacy: no pixel values or EXIF data in log messages (NFR-004).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Test verifies the returned data URI decodes to a valid PNG
- [ ] Test verifies no disk file is created (mock `open()` in write mode)
- [ ] Test verifies WARNING log on malformed bounding box
- [ ] No PII in logs
