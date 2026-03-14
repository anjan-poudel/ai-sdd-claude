# Review Report — L2 Component Design (PhotoCop) — Re-Review

## Summary

This is a re-review of `design-l2.md` following the NO_GO verdict issued against the initial submission. All four findings from the previous review have been verified as resolved. The document is internally consistent, covers all seven components with complete interface specifications, error handling contracts, and test strategies, and is fully traceable to the FRs and NFRs in the constitution.

The four previous findings are addressed as follows:

1. (Blocking) `/health` is now defined on `health_router = APIRouter()` with no prefix and is wired into the app factory via `app.include_router(health_router)`. It resolves to `GET /health` at the root, matching the Docker health check target `http://localhost:8000/health`.
2. (Moderate) `Settings.validate_weights_sum` is now a Pydantic `model_validator(mode="after")` that fires at `Settings` construction time (i.e. application startup in `create_app()`). If weights do not sum to `1.0 ± 1e-6`, the process exits before serving any requests.
3. (Moderate) `ContentTypeMiddleware` has been removed entirely from the module structure and from `middleware.py`. No orphaned reference remains.
4. (Minor) The claim about `request_id` UUID propagation via middleware has been removed from the Observability section. No unspecified component is referenced.

No new issues of blocking or moderate severity were identified during this re-review.

---

## Decision

GO

---

## Evidence Checklist

### Previous NO_GO Findings — Resolution Verification

| Finding | Severity | Fixed? | Evidence location in design-l2.md |
|---|---|---|---|
| F1: `/health` under `/api/v1` prefix causing Docker health check 404 | Blocking | Yes | `router.py` snippet: `health_router = APIRouter()` (no prefix); `@health_router.get("/health", ...)`; `main.py`: `app.include_router(health_router)  # mounts /health (no prefix)` |
| F2: Weight validation deferred to per-request `ScoreAggregator` construction | Moderate | Yes | `config.py`: `@model_validator(mode="after") def validate_weights_sum(self) -> "Settings":` raises `ValueError` with actionable message at startup |
| F3: `ContentTypeMiddleware` listed in module structure but never defined or wired | Moderate | Yes | `middleware.py` module comment now reads `# SizeLimitMiddleware (ASGI only)` — no `ContentTypeMiddleware` reference anywhere in the document |
| F4: `request_id` UUID middleware promised in Observability section but never specified | Minor | Yes | Observability section no longer contains any reference to `request_id`, UUID generation, or `ContextVar` propagation |

### Review Checklist (Standards)

| Criterion | Met? | Notes |
|---|---|---|
| Every interface method has an explicit error return type (not `any` or `unknown`) | Yes | Python side: all public functions specify explicit `Raises:` docstrings or return type annotations. TypeScript side: `analyseImage` returns `Promise<AnalyseOutcome>` (discriminated union — no `any`); `exif: Record<string, ExifValue>` uses bounded union type, not `any`. `exif.py`'s `extract()` returns `dict[str, Any]` — `Any` is used only at the boundary with external EXIF libraries where values are structurally unpredictable; this is documented as intentional and the frontend type narrows it via `ExifValue`. |
| Every async or external call has a documented failure mode and recovery path | Yes | `analyseImage`: all failure paths mapped to `AnalyseFailure`; never throws. `run_pipeline`: `asyncio.TimeoutError` propagates to `timeout_error_handler` → HTTP 504; `AnalysisError` propagates to `generic_error_handler` → HTTP 500. `ingest()`: four error codes mapped in `INGESTION_ERROR_MAP`. `extract()`: never raises; returns `{}` on all exceptions. `render()`: never raises; returns original image data URI on all exceptions. |
| Timeouts and retry limits are configurable parameters, not hardcoded constants | Yes | Frontend: `VITE_REQUEST_TIMEOUT_MS` (env var, default 30 000 ms). Backend: `ANALYSIS_TIMEOUT_SECONDS` (env var, default 9.0 s). `MAX_UPLOAD_BYTES` (env var, default 10 MB). `ELA_QUALITY`, `ELA_WEIGHT`, `NOISE_WEIGHT`, `CLONE_WEIGHT`, `HEATMAP_ALPHA`, `CORS_ORIGINS`, `LOG_LEVEL` all configurable. No hardcoded magic values outside of documented fixed constants (e.g. `CloneDetector.MIN_MATCH_COUNT = 10`, which is documented as intentionally fixed for MVP with explicit rationale). |
| Every element traces back to a specific FR or NFR | Yes | See Functional Requirements traceability table below. No unspecified features are introduced. |
| The design describes what the operator sees when the feature runs and when it fails | Yes | Startup failure: `Settings.validate_weights_sum` raises `ValueError` with `"ELA_WEIGHT + NOISE_WEIGHT + CLONE_WEIGHT must sum to 1.0; got {total}"` — process exits before serving requests. Request failure paths: 413/415/422/504/500 all produce `application/problem+json` with `title` field. Observability section specifies log levels per event type including ERROR with `exc_info=True` for unhandled exceptions. |

### Functional Requirements

| Requirement | Covered? | Where in design-l2.md |
|---|---|---|
| FR-001: Accept JPEG/PNG/WebP/TIFF/BMP | Yes | `ingestion.py` — `SUPPORTED_MIME_TO_FORMAT`; `UploadForm` `accept` attribute |
| FR-001: Magic-byte validation | Yes | `_detect_mime()` — `python-magic` primary + `filetype` fallback |
| FR-001: Max 10 MB; reject with RFC 7807 | Yes | `SizeLimitMiddleware` at HTTP boundary; `ingest()` secondary check; `errors.py` maps `SIZE_EXCEEDED` → 413 |
| FR-001: No persistence | Yes | `io.BytesIO` throughout; no `open()` calls in processing path |
| FR-002: ELA + noise analysis + clone detection | Yes | `ela.py`, `noise.py`, `clone.py` — fully typed classes with `analyse()` returning `AnalyserOutput` |
| FR-002: Return 0.0–1.0 score | Yes | `ScoreAggregator.aggregate()` clamps; `AnalysisResponse.score` constrained by `Field(ge=0.0, le=1.0)` |
| FR-002: Return verdict | Yes | `_derive_verdict()` maps to `"authentic"` / `"suspicious"` / `"likely manipulated"` |
| FR-003: Heatmap overlay as data URI | Yes | `render()` returns `"data:image/png;base64,..."` in-memory |
| FR-003: In-memory, no server storage | Yes | `_encode_to_data_uri()` uses `io.BytesIO`; intermediates explicitly deleted |
| FR-004: EXIF extraction as structured JSON | Yes | `extract()` returns `dict[str, Any]` via `exifread` → `piexif` fallback chain |
| FR-004: Handle missing/corrupt gracefully | Yes | `extract()` returns `{}` on all exceptions; never raises |
| FR-005: Unified JSON response | Yes | `AnalysisResponse` Pydantic model: `score`, `verdict`, `heatmap_url`, `exif`, `regions` |

### Non-Functional Requirements

| Requirement | Covered? | Where in design-l2.md |
|---|---|---|
| NFR-001: All processing in-memory, no persistence | Yes | `ingest()`, `heatmap.py`, `exif.py` all use `io.BytesIO`; cross-cutting security section |
| NFR-002: Established forensic techniques | Yes | ELA (JPEG re-compression), noise residual (Gaussian filter), clone detection (ORB + BFMatcher) |
| NFR-003: < 10 s for images up to 10 MB | Yes | `analysis_timeout_seconds=9.0` enforced via `asyncio.wait_for`; three analysers run concurrently via `ThreadPoolExecutor` |
| NFR-004: Privacy — no logging of image data or EXIF values | Yes | `exif.py`: only `type(exc).__name__` logged; `render()`: exception type only; observability section explicit negative list |
| NFR-005: Upload sanitisation — magic-byte check + size limit | Yes | Three-layer validation: magic bytes → PIL decode → ASGI size limit |
| NFR-005: No execution of uploads | Yes | Pillow decode only; no subprocess calls |
| NFR-005: No secrets in source | Yes | All configuration via `Settings` (Pydantic `BaseSettings`); no hardcoded secrets |
| API Design: `/health` at root, REST under `/api/v1/` | Yes | `health_router` with no prefix → `GET /health`; `router` with `prefix="/api/v1"` → `POST /api/v1/analyse` |
| API Design: Errors return RFC 7807 Problem Details JSON | Yes | `ProblemDetail` model with `type`, `title`, `status`, `detail`; `Content-Type: application/problem+json` in all handlers |

---

## Findings

No new blocking or moderate findings were identified.

### Observation 1 — `ScoreAggregator` still validates weights at construction time (informational)

The `ScoreAggregator.__init__` docstring and comment on line 1004 state it still validates the weight sum at construction time ("Validates at construction time; raises `ValueError` if not satisfied."). This is harmless — it acts as a defensive second-line guard after the startup-time `Settings.validate_weights_sum`. Since the `Settings` validator is now the authoritative startup gate, the per-construction check in `ScoreAggregator` is redundant but not incorrect. No action required.

### Observation 2 — `MIN_MATCH_COUNT = 10` in `CloneDetector` is a fixed class constant (informational)

The `CloneDetector.MIN_MATCH_COUNT = 10` is documented as "Fixed at 10 for MVP; not externally configurable per L1." This is an explicit, documented design decision consistent with the L1 architecture's scope boundary. It is not a hardcoded constant problem — the value is named, documented, and its non-configurability is justified. No action required.

---

## Recommendations

1. (Optional, non-blocking) If the `ScoreAggregator` weight-sum check at construction time is retained for defence-in-depth, a comment clarifying it as a "secondary guard" (the primary being `Settings.validate_weights_sum`) would improve future maintainability. This does not need to be done before implementation begins.

2. (Optional, non-blocking) The `exif.py` `extract()` return type is `dict[str, Any]`. Consider narrowing this to `dict[str, str | int | float | bool | None]` (i.e. the `ExifValue` union from the TypeScript types) once the sanitiser implementation is complete, so the contract is tighter end-to-end. This is deferred to implementation, not a design issue.

All four previous NO_GO findings are resolved. The design is ready for implementation.
