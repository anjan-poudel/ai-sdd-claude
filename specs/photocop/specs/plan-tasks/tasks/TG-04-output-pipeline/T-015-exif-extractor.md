# T-015: EXIF Extractor

## Metadata
- **Group:** [TG-04 — Output Pipeline](index.md)
- **Component:** EXIF Extractor — `backend/app/exif.py`
- **Agent:** dev
- **Effort:** S
- **Risk:** MEDIUM
- **Depends on:** [T-006](../TG-02-backend-core/T-006-image-ingestion-service.md), [T-013](T-013-shared-response-types.md)
- **Blocks:** [T-016](T-016-response-assembler.md)
- **Requirements:** [FR-004](../../../define-requirements/FR/FR-004-exif-extraction.md), [NFR-004](../../../define-requirements/NFR/NFR-004-privacy.md)

## Description
Implement `backend/app/exif.py` with `extract(raw_bytes: bytes) -> dict[str, Any]`. The function attempts EXIF parsing using `exifread` as the primary library, falling back to `piexif` if `exifread` fails. On any exception (corrupt EXIF, missing block, library error), it returns `{}` and logs only the exception type. No EXIF tag values may appear in any log message.

## Acceptance criteria

```gherkin
Feature: EXIF Extractor

  Scenario: EXIF tags are returned for a JPEG with embedded metadata
    Given raw bytes of a JPEG with known EXIF tags (Make, Model, GPSLatitude)
    When extract(raw_bytes) is called
    Then the returned dict contains keys for the embedded tags
    And the values are present (not None)

  Scenario: Empty dict is returned for a PNG with no EXIF block
    Given raw bytes of a PNG image with no EXIF data
    When extract(raw_bytes) is called
    Then the returned dict equals {}
    And no exception is raised

  Scenario: Empty dict is returned for a file with a corrupt EXIF block
    Given raw bytes of a JPEG with a deliberately malformed EXIF segment
    When extract(raw_bytes) is called
    Then the returned dict equals {}
    And a WARNING is logged containing only the exception type (e.g. "ExifRead parse error: InvalidIfdOffset")
    And the log message does not contain any GPS coordinates or tag values

  Scenario: GPS coordinates do not appear in any log line
    Given server-side logging is configured at DEBUG level
    And raw bytes of a JPEG with GPS coordinates in its EXIF block
    When extract(raw_bytes) is called
    Then no log line contains the GPS latitude or longitude values from that image
```

## Implementation notes
- Primary: `exifread.process_file(io.BytesIO(raw_bytes), details=False)` returns a dict of `IfdTag` objects; convert to `{str(k): str(v) for k, v in tags.items()}`.
- Fallback: if `exifread` raises any exception, attempt `piexif.load(raw_bytes)` and flatten the nested dict.
- Top-level `try/except Exception as e`: log `f"EXIF extraction failed: {type(e).__name__}"` and return `{}`.
- Do NOT include `str(e)` in the log message — it may contain EXIF values (NFR-004).
- The function must never propagate any exception to the caller.
- Stateless; safe to call concurrently.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Test fixture: JPEG with GPS EXIF, PNG without EXIF, JPEG with corrupt EXIF block
- [ ] Test asserts log message contains only `type(e).__name__`, not `str(e)` (use `caplog` fixture)
- [ ] No PII in logs (GPS coordinates, device serial numbers)
