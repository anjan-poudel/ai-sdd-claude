# Review Report — L1 Architecture (PhotoCop)

## Summary

The L1 architecture document (`design-l1.md`) is comprehensive, well-structured, and directly traceable to every FR and NFR in the requirements set. The design covers all seven logical components, defines typed interfaces for every component boundary, documents every error path with an explicit failure mode and HTTP status code, and configures all timeouts and thresholds via environment variables rather than hardcoded constants. No unspecified features are introduced.

Two minor gaps are noted, neither of which is a blocker:

1. The heatmap data URI privacy note is implicit rather than explicit with respect to NFR-004 (the design states the heatmap is never written to disk and intermediate PIL objects are released, but does not explicitly state that the heatmap data URI is not written to any log — required by NFR-004 which covers "derived images").
2. The `imghdr` module referenced in the Image Ingestion Service component is deprecated as of Python 3.11 and removed in Python 3.13. The design should commit to a concrete magic-byte lookup table or an actively maintained library (e.g. `python-magic` or `filetype`) rather than listing `imghdr` as the primary approach.

Both findings are low-severity and do not prevent the design from being approved. The architecture is feasible and implementable as written.

**Decision: GO**

---

## Decision

GO

---

## Evidence Checklist

### Functional Requirements

| Requirement | Covered? | Where in design-l1.md |
|-------------|----------|-----------------------|
| FR-001: Accept JPEG/PNG/WebP/TIFF/BMP | Yes | Image Ingestion Service — format normalisation; API Gateway § error table (HTTP 415 for unsupported format) |
| FR-001: Magic-byte validation | Yes | Image Ingestion Service — "magic-byte inspection (first 16 bytes checked against known signatures)" |
| FR-001: Max 10 MB; reject with RFC 7807 | Yes | FastAPI Backend — MAX_UPLOAD_BYTES env var; error table HTTP 413 "File Too Large"; Image Ingestion re-check for defence-in-depth |
| FR-001: No persistence | Yes | Image Ingestion Service — "never write to disk"; NFR-001 coverage statement in Overview |
| FR-002: ELA + noise analysis + clone detection | Yes | Analysis Engine §§ 4a, 4b, 4c — each analyser fully described with algorithm rationale |
| FR-002: Score 0.0–1.0 | Yes | Score Aggregator — weighted average; AnalysisResponse Pydantic model with `ge=0.0, le=1.0` constraint |
| FR-002: Verdict string | Yes | Score Aggregator — three configurable threshold bands map to "authentic" / "suspicious" / "likely manipulated" |
| FR-002: Explainable — region annotations | Yes | RegionResult dataclass carries `technique` (Literal["ELA","noise_analysis","clone_detection"]) and `confidence` |
| FR-003: Heatmap overlay as data URI | Yes | Heatmap Renderer — renders in-memory, returns `data:image/png;base64,...` string; never writes to disk |
| FR-003: Inline display without page reload | Yes | React Frontend — heatmap_url rendered inline from data URI; UI state machine documented |
| FR-003: No server storage | Yes | Heatmap Renderer — "never retain the intermediate PIL objects after the data URI is produced" |
| FR-004: EXIF extraction as structured JSON | Yes | EXIF Extractor — returns `dict[str, Any]` via `exifread` (primary) / `piexif` (fallback) |
| FR-004: Handle missing/corrupt gracefully | Yes | EXIF Extractor — top-level try/except catches all exceptions; returns `{}` on any error |
| FR-005: Unified JSON response `{score, verdict, heatmap_url, exif, regions}` | Yes | Response Assembler — AnalysisResponse Pydantic model with all five fields; endpoint `POST /api/v1/analyse` |

### Non-Functional Requirements

| Requirement | Covered? | Where in design-l1.md |
|-------------|----------|-----------------------|
| NFR-001: All processing in-memory, no persistence | Yes | Overview ("no on-disk artefacts"); Image Ingestion ("never write to disk"); Heatmap Renderer ("never retain"); Response Assembler releases buffers after response |
| NFR-002: High accuracy — ELA, noise, clone detection | Yes | Analysis Engine §§ 4a-4c use established forensic techniques; Score Aggregator uses configurable weighted blend |
| NFR-003: < 10 s for images up to 10 MB | Yes | FastAPI Backend — `ANALYSIS_TIMEOUT_SECONDS` env var (default 9 s); `asyncio.wait_for` hard limit; concurrent analysers via asyncio.gather / thread pool |
| NFR-003: Health check < 200 ms | Yes | FastAPI Backend — `HEALTH_CHECK_TIMEOUT_MS` env var (default 200 ms); `/health` endpoint documented |
| NFR-004: Nothing logged after request | Partial | EXIF Extractor — explicit log restriction (exception type only, not values). Heatmap Renderer — warning log restricts to "no image data in log". However, there is no explicit statement that the heatmap data URI string itself is never written to any log; NFR-004 covers "derived images". This should be made explicit. |
| NFR-005: Magic-byte validation | Yes | Image Ingestion Service — magic-byte check before decoding; `MAGIC_BYTE_MISMATCH` → HTTP 422 |
| NFR-005: Size limits at HTTP boundary | Yes | FastAPI Backend — Starlette MAX_UPLOAD_SIZE enforced before body is read into memory |
| NFR-005: No execution of uploads | Yes | Overview — "treat all uploads as untrusted data"; Image Ingestion decodes via Pillow only; no subprocess calls on upload content |
| NFR-005: No secrets in source code | Yes | Auth Strategy — all config via environment variables; no secrets in source |
| NFR-005: No stack traces in error responses | Yes | FastAPI Backend — global exception handler converts all unhandled exceptions to RFC 7807; `detail` field: "no stack trace or internal file path" |

---

## Findings

### Finding 1 — `imghdr` is deprecated and removed in Python 3.13 (Low Severity)

**Location**: Image Ingestion Service — Technology section: "Python: `io.BytesIO`, `PIL.Image` (Pillow), `imghdr` / custom magic-byte lookup table"

The `imghdr` standard library module was deprecated in Python 3.11 and removed in Python 3.13. The design lists it as the first option alongside a "custom magic-byte lookup table". Since the document states Python 3.11+ as the runtime, shipping code that imports `imghdr` will produce a deprecation warning on 3.11 and break on 3.13+. The fallback ("custom magic-byte lookup table") is the correct approach but is described as secondary.

**Recommendation**: Remove `imghdr` from the listed approach. The implementation should use either a maintained third-party library (`python-magic`, `filetype`) or an inline magic-byte lookup table keyed on the first 16 bytes. This avoids a forward-compatibility break with no change to the architectural model.

---

### Finding 2 — NFR-004 coverage for heatmap data URI in logs is implicit (Low Severity)

**Location**: Heatmap Renderer — Error handling: "logs a warning at WARNING level (no image data in log)". NFR-004 requires that no derived image data is logged after the request.

The design's warning log restriction correctly excludes pixel data in the warning path. However, the normal-path rendering does not include an explicit statement that the heatmap data URI string (which encodes a full PNG of the image) is never emitted to any log. The EXIF Extractor section carries an explicit prohibition ("must not emit the values of any EXIF tags in log messages"). The Heatmap Renderer should carry an equivalent explicit constraint at the same level of specificity.

**Recommendation**: Add a Privacy note to the Heatmap Renderer section (analogous to the one in EXIF Extractor) stating: "The heatmap data URI must not appear in any log entry. Log messages in this component are limited to status/error type information, never image content."

---

### Finding 3 — Score Aggregator weight validation is runtime-only (Informational)

**Location**: Score Aggregator — "Weights are configurable via environment variables (`ELA_WEIGHT`, `NOISE_WEIGHT`, `CLONE_WEIGHT`; defaults `0.4`, `0.3`, `0.3`; must sum to 1.0)"

The design states that weights must sum to 1.0 but does not describe what happens if misconfigured values are provided (e.g. weights summing to 0.9 due to a typo in the environment). This is a gap in the documented failure mode for this configuration path. No other component has an unspecified failure mode for its configurable parameters.

**Recommendation**: The design should state that weight validation occurs at startup: if the sum of `ELA_WEIGHT + NOISE_WEIGHT + CLONE_WEIGHT` differs from 1.0 by more than a small epsilon (e.g. 1e-6), the application must fail to start with an actionable error message. This ensures misconfiguration is caught early rather than silently producing wrong scores.

---

### Finding 4 — Concurrent request memory isolation under Uvicorn ASGI (Informational)

**Location**: FastAPI Backend — Concurrency: "Concurrent requests share no mutable state; each request allocates its own image buffer scope."

The design correctly identifies request-level isolation, and the async/thread-pool model is appropriate. However, for a 10 MB image processed with three concurrent analysers each receiving an `Image.copy()`, peak memory per request could reach approximately 150–300 MB (raw bytes + PIL RGB array + three copies + ELA intermediate + noise map + keypoint descriptors). Under concurrent load, this can compound. The design does not mention a request concurrency limit or worker count setting.

This is flagged as informational only — it does not affect the single-user MVP target in NFR-003. If the service is deployed under multi-user load, an operator note covering `--workers` or a concurrency cap would be prudent. This does not need to be resolved before implementation.

---

## Recommendations

1. **Replace `imghdr`** with an actively maintained magic-byte strategy (`python-magic` or an inline lookup table). Update the Image Ingestion Service Technology section. (Addresses Finding 1 — prevents a forward-compatibility break.)

2. **Add a Privacy note to the Heatmap Renderer** explicitly prohibiting the heatmap data URI string from appearing in any log entry, matching the specificity of the equivalent note in the EXIF Extractor. (Addresses Finding 2 — closes a small NFR-004 gap.)

3. **Document startup validation for Score Aggregator weights**: state that the service must fail to start if weights do not sum to 1.0 within epsilon. (Addresses Finding 3 — eliminates a silent misconfiguration failure mode.)

4. **Add an informational note** under the FastAPI Backend concurrency section acknowledging per-request peak memory and recommending an operator-configurable `MAX_CONCURRENT_REQUESTS` or Uvicorn worker documentation for production deployments. (Addresses Finding 4 — informational only.)

None of the above findings block implementation. Findings 1 and 2 are strongly recommended for resolution at the component design (L2) stage before code is written.
