# T-006: Image Ingestion Service

## Metadata
- **Group:** [TG-02 — Backend Core](index.md)
- **Component:** Image Ingestion Service — `backend/app/ingestion.py`
- **Agent:** dev
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** [T-004](T-004-app-factory-config.md), [T-005](T-005-error-handlers.md)
- **Blocks:** [T-007](T-007-api-router-health.md), [T-008](../TG-03-analysis-engine/T-008-analysis-engine-orchestrator.md)
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-image-upload.md), [NFR-001](../../../define-requirements/NFR/NFR-001-in-memory-processing.md), [NFR-005](../../../define-requirements/NFR/NFR-005-security.md)

## Description
Implement `backend/app/ingestion.py` with the `ingest()` function, `ImageBuffer` dataclass, and `IngestionError` exception class. The function must: (1) validate file size against `MAX_UPLOAD_BYTES`, (2) detect the true MIME type using `python-magic` with `filetype` as fallback, (3) reject any MIME not in `SUPPORTED_MIME_TO_FORMAT`, (4) decode the bytes into a normalised PIL Image (RGB or RGBA), and (5) return a frozen `ImageBuffer`. The function must never write to disk.

## Acceptance criteria

```gherkin
Feature: Image Ingestion Service

  Scenario: Valid JPEG bytes are ingested and return an ImageBuffer
    Given raw bytes of a valid 3 MB JPEG file
    And the declared content-type is "image/jpeg"
    When ingest(raw_bytes, "image/jpeg", settings) is called
    Then an ImageBuffer is returned
    And ImageBuffer.format equals "JPEG"
    And ImageBuffer.image is a PIL Image in RGB or RGBA mode
    And ImageBuffer.raw_bytes is the original bytes unchanged

  Scenario: File exceeding MAX_UPLOAD_BYTES raises SIZE_EXCEEDED
    Given raw bytes of length MAX_UPLOAD_BYTES + 1
    When ingest() is called
    Then an IngestionError with code "SIZE_EXCEEDED" is raised
    And no PIL decoding is attempted

  Scenario: File with PDF magic bytes and .jpg extension raises MAGIC_BYTE_MISMATCH
    Given raw bytes whose first 4 bytes are the PDF magic sequence (25 50 44 46)
    And the declared content-type is "image/jpeg"
    When ingest() is called
    Then an IngestionError with code "MAGIC_BYTE_MISMATCH" is raised

  Scenario: GIF file raises UNSUPPORTED_FORMAT
    Given raw bytes of a valid GIF image
    When ingest() is called
    Then an IngestionError with code "UNSUPPORTED_FORMAT" is raised

  Scenario: Truncated JPEG that passes magic-byte check but fails PIL decode raises DECODE_FAILED
    Given raw bytes that begin with the JPEG magic bytes (FF D8 FF) but are truncated after 100 bytes
    When ingest() is called
    Then an IngestionError with code "DECODE_FAILED" is raised

  Scenario: No image data is written to disk during ingestion
    Given the server filesystem write calls are monitored
    When ingest() processes a 5 MB JPEG
    Then no new file appears on disk under /tmp or the working directory
```

## Implementation notes
- `imghdr` must NOT be used (deprecated in Python 3.11, removed in Python 3.13). Use `python-magic` with `filetype` fallback per L2 design.
- Magic-byte detection reads only the first 256 bytes to avoid buffering the whole file for detection.
- PIL decode: use `PIL.Image.open(io.BytesIO(raw_bytes))` followed by `.convert("RGB")` for non-RGBA formats.
- The `ImageBuffer` dataclass must be `frozen=True` to prevent mutation by downstream analysers.
- NFR-001: no `open()` calls in write mode, no `tempfile` writes, no `BytesIO.getvalue()` saved to disk.
- NFR-005: the magic-byte check must run before PIL decoding to ensure no executable content reaches the image decoder.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Test fixtures committed: `authentic.jpg`, `corrupt.bin`, GIF fixture, truncated JPEG fixture
- [ ] Test verifies `python-magic` is tried first; `filetype` is used when `magic` import fails (mock the import)
- [ ] No PII in logs
- [ ] No disk writes of image data (verified by mocking `open()` and asserting it is not called in write mode)
