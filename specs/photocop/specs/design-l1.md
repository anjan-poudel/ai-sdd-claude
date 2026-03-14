# L1 Architecture — PhotoCop

## Overview

PhotoCop is a stateless, single-request web application for forensic image analysis. A user uploads an image through a browser interface; the backend validates the file, runs three independent forensic algorithms in memory, assembles a unified JSON report, and returns the result — all within a single HTTP request/response cycle. No image data, derived data, or metadata is persisted after the response is sent.

**Design philosophy**

- **Stateless by construction.** Every request carries its full payload. The server holds no session state, no cache of prior uploads, and no on-disk artefacts. Memory allocated for a request is released when the HTTP response is flushed.
- **Validation at the boundary.** File size is enforced at the HTTP layer before the body is read into process memory. Magic-byte validation occurs before any image decoding or algorithm execution begins.
- **Error paths are first-class.** Every pipeline stage produces either a typed success value or a structured error. Errors propagate as RFC 7807 Problem Details responses; internal tracebacks are never exposed.
- **In-process parallelism.** The three forensic analysers (ELA, noise, clone detection) are independent and may execute concurrently within a single request using Python's `asyncio` or a thread pool. Isolation is guaranteed because each analyser receives a read-only copy of the decoded image buffer.
- **Configurable timeouts.** No timeout value is hardcoded. The analysis pipeline timeout (default 9 s, leaving 1 s for serialisation) and the health check timeout are read from environment variables at startup.

---

## Architecture

```
Browser
  │
  │  POST /api/v1/analyse  (multipart/form-data, max 10 MB)
  │  GET  /health
  ▼
┌─────────────────────────────────────────────────────────────────┐
│  React Frontend  (TypeScript, Vite)                             │
│  ┌────────────┐  ┌──────────────────┐  ┌─────────────────────┐ │
│  │ Upload UI  │  │  Result Display  │  │  Error Banner       │ │
│  │ (drag+drop │  │  score / verdict │  │  (RFC 7807 title)   │ │
│  │  file pick)│  │  heatmap inline  │  │                     │ │
│  │            │  │  EXIF table      │  │                     │ │
│  └────────────┘  └──────────────────┘  └─────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────┘
                               │  HTTP/JSON  (fetch API)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  FastAPI Backend  (Python, Uvicorn)                             │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  API Gateway  (routes, CORS, size limit, error handler)  │   │
│  └───────────────────────┬──────────────────────────────────┘   │
│                          │ UploadFile (SpooledTemporaryFile)     │
│                          ▼                                       │
│  ┌───────────────────────────────────────┐                      │
│  │  Image Ingestion Service              │                      │
│  │  • magic-byte validation              │                      │
│  │  • size re-check                      │                      │
│  │  • format normalisation → PIL Image   │                      │
│  └──────┬────────────────────────────────┘                      │
│         │ ImageBuffer (in-memory PIL Image + raw bytes)         │
│         ├──────────────────┬──────────────────┐                 │
│         ▼                  ▼                  ▼                 │
│  ┌────────────┐  ┌──────────────────┐  ┌────────────────┐      │
│  │  Analysis Engine                                       │     │
│  │  ┌─────────────┐ ┌─────────────┐ ┌──────────────────┐│     │
│  │  │ELA Analyser │ │Noise        │ │Clone Detector    ││     │
│  │  │             │ │Analyser     │ │                  ││     │
│  │  └──────┬──────┘ └──────┬──────┘ └────────┬─────────┘│     │
│  │         └───────────────┴─────────┬────────┘          │     │
│  │                                   │ AnalysisResults[]  │     │
│  │                          ┌────────▼────────┐           │     │
│  │                          │ Score Aggregator│           │     │
│  │                          └────────┬────────┘           │     │
│  └──────────────────────────────┬────┘────────────────────┘     │
│                                 │                                │
│         ┌───────────────────────┼──────────────────┐            │
│         │                       │                  │            │
│         ▼                       ▼                  ▼            │
│  ┌─────────────┐   ┌──────────────────┐  ┌──────────────────┐  │
│  │  Heatmap    │   │  EXIF Extractor  │  │  (score, verdict,│  │
│  │  Renderer   │   │                  │  │   regions)       │  │
│  └──────┬──────┘   └───────┬──────────┘  └────────┬─────────┘  │
│         │ base64 data URI  │ dict | {}             │            │
│         └──────────────────┴───────────────────────┘            │
│                                         │                        │
│                              ┌──────────▼──────────┐            │
│                              │  Response Assembler  │           │
│                              │  builds unified JSON │           │
│                              └──────────┬───────────┘           │
└─────────────────────────────────────────┼───────────────────────┘
                                          │  AnalysisResponse JSON
                                          ▼
                                       Browser
```

**Data flow summary**

1. Browser submits `POST /api/v1/analyse` with the image as `multipart/form-data`.
2. FastAPI's size limiter rejects oversized payloads at the HTTP boundary (HTTP 413) before the body is fully buffered.
3. Image Ingestion Service reads the raw bytes, performs magic-byte validation (HTTP 422 on failure), and decodes into a normalised PIL `Image` object.
4. The Analysis Engine fans out to three analysers concurrently. Each returns a list of `RegionResult` objects and a sub-score.
5. The Score Aggregator combines sub-scores into a single `[0.0, 1.0]` value and derives the verdict string.
6. Heatmap Renderer composites the region masks into a colour overlay and encodes as a `data:image/png;base64,...` data URI.
7. EXIF Extractor reads metadata from the raw bytes and returns a flat dict; returns `{}` on any error.
8. Response Assembler merges all outputs into the `AnalysisResponse` Pydantic model and FastAPI serialises it as JSON.
9. All in-memory buffers (image bytes, PIL objects, ELA artefacts) are released after the response is sent.

**Infrastructure topology (Docker Compose — development)**

```
┌─────────────────────────────────────────────┐
│  docker-compose.yml                         │
│                                             │
│  service: frontend                          │
│    build: ./frontend                        │
│    ports: "${FRONTEND_PORT:-5173}:5173"     │
│    depends_on: [backend]                    │
│                                             │
│  service: backend                           │
│    build: ./backend                         │
│    ports: "${BACKEND_PORT:-8000}:8000"      │
│    environment:                             │
│      ANALYSIS_TIMEOUT_SECONDS               │
│      MAX_UPLOAD_BYTES                       │
│      LOG_LEVEL                              │
│    healthcheck:                             │
│      test: ["CMD","curl","-f",             │
│             "http://localhost:8000/health"] │
│      interval: 30s                         │
│      timeout: 5s                           │
│      retries: 3                             │
└─────────────────────────────────────────────┘
```

No database, cache, queue, or object-storage service is present; none is required by any FR or NFR.

---

## Components

### 1. React Frontend

**Responsibilities**

- Render a drag-and-drop / file-picker upload control accepting JPEG, PNG, WebP, TIFF, and BMP files.
- Submit the selected file to `POST /api/v1/analyse` via the `fetch` API as `multipart/form-data`.
- Display the analysis result: manipulation score (numeric + human verdict label), heatmap image (rendered inline from the `heatmap_url` data URI), EXIF metadata table, and flagged regions list.
- Render RFC 7807 error titles as user-facing error messages without exposing internal detail.
- Manage UI state transitions: idle → uploading → analysing → result / error.

**Technology**

- React 18, TypeScript (strict, no `any`), Vite
- No third-party analytics or tracking libraries

**Key interfaces**

- Outbound: `POST /api/v1/analyse` — multipart form with `file` field; expects `AnalysisResponse` JSON on success and `ProblemDetails` JSON on error.
- Internal: `AnalysisResult` TypeScript type mirrors the backend `AnalysisResponse` shape:
  ```
  interface AnalysisResult {
    score: number;           // [0.0, 1.0]
    verdict: string;         // "authentic" | "suspicious" | "likely manipulated"
    heatmap_url: string;     // data URI, e.g. "data:image/png;base64,..."
    exif: Record<string, unknown>;
    regions: Region[];
  }

  interface Region {
    technique: "ELA" | "noise_analysis" | "clone_detection";
    bounding_box: { x: number; y: number; width: number; height: number };
    confidence: number;      // [0.0, 1.0]
  }
  ```

**Error handling**

- HTTP 4xx responses: parse `ProblemDetails.title` and display to the user.
- HTTP 5xx / network failure: display a generic "Service unavailable" message; do not expose status codes or internal detail.
- Client-side file size check (> 10 MB): reject before upload and show an inline validation error.

**Concurrency**

- One in-flight request at a time per browser tab; the upload button is disabled while a request is pending. No server-side concurrency concern at this layer.

---

### 2. FastAPI Backend

**Responsibilities**

- Expose `POST /api/v1/analyse` and `GET /health` endpoints with Pydantic request/response models.
- Enforce the 10 MB upload size limit at the HTTP boundary using Uvicorn / Starlette's `MAX_UPLOAD_SIZE` setting (configured via `MAX_UPLOAD_BYTES` environment variable) before the request body is read into process memory.
- Configure CORS to allow the frontend origin (configurable via `CORS_ORIGINS` environment variable).
- Register a global exception handler that converts all unhandled exceptions into RFC 7807 `ProblemDetails` responses without leaking tracebacks or internal paths.
- Route validated requests to the Image Ingestion Service, collect results from the pipeline, and return the serialised `AnalysisResponse`.
- Enforce the analysis pipeline timeout (read from `ANALYSIS_TIMEOUT_SECONDS` environment variable, default 9).

**Technology**

- Python 3.11+, FastAPI, Uvicorn (ASGI), Pydantic v2

**Key interfaces**

Endpoint: `POST /api/v1/analyse`
- Request: `multipart/form-data` with field `file` (`UploadFile`)
- Success response (`200 OK`):
  ```
  Content-Type: application/json
  {
    "score": number,
    "verdict": string,
    "heatmap_url": string,
    "exif": object,
    "regions": [
      {
        "technique": string,
        "bounding_box": { "x": int, "y": int, "width": int, "height": int },
        "confidence": number
      }
    ]
  }
  ```
- Error responses (`application/problem+json`):

  | Condition | Status | `title` |
  |-----------|--------|---------|
  | File exceeds `MAX_UPLOAD_BYTES` | 413 | `"File Too Large"` |
  | Unsupported format (extension / MIME) | 415 | `"Unsupported Media Type"` |
  | Magic-byte / content mismatch | 422 | `"Invalid File Content"` |
  | Corrupt or undecodable image | 422 | `"Image Processing Error"` |
  | Analysis timeout exceeded | 504 | `"Analysis Timeout"` |
  | Unhandled internal error | 500 | `"Internal Server Error"` |

  All error bodies conform to:
  ```
  Content-Type: application/problem+json
  { "type": string, "title": string, "status": int, "detail": string }
  ```
  The `detail` field contains a human-readable description only; no stack trace or internal file path.

Endpoint: `GET /health`
- Success response (`200 OK`): `{ "status": "ok" }`
- Must respond within `HEALTH_CHECK_TIMEOUT_MS` (default 200 ms) per NFR-003.

**Concurrency**

- Uvicorn runs as a single-process ASGI server (development). Each HTTP request is handled in its own coroutine. The analysis pipeline uses `asyncio.wait_for` with the configured timeout. Concurrent requests share no mutable state; each request allocates its own image buffer scope.

**Configuration (environment variables)**

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_UPLOAD_BYTES` | `10485760` | Hard limit enforced at HTTP boundary |
| `ANALYSIS_TIMEOUT_SECONDS` | `9` | Timeout for the full analysis pipeline per request |
| `HEALTH_CHECK_TIMEOUT_MS` | `200` | Target for /health response time (informational) |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated list of allowed origins |
| `LOG_LEVEL` | `INFO` | Uvicorn/application log level |

---

### 3. Image Ingestion Service

**Responsibilities**

- Read the raw bytes from the FastAPI `UploadFile` into a single in-memory `bytes` object.
- Re-confirm the file size does not exceed `MAX_UPLOAD_BYTES` after reading (defence in depth; primary enforcement is at HTTP boundary).
- Validate file bytes against the declared `Content-Type` and file extension using magic-byte inspection (first 16 bytes checked against known signatures for JPEG, PNG, WebP, TIFF, BMP).
- Reject any file whose magic bytes do not match a supported image format, regardless of extension or `Content-Type`.
- Decode the validated bytes into a Pillow `Image` object, normalised to RGB or RGBA colour space.
- Provide the decoded `Image` and the original raw `bytes` to downstream components.
- Release all buffers on exit or exception; never write to disk.

**Technology**

- Python: `io.BytesIO`, `PIL.Image` (Pillow), `imghdr` / custom magic-byte lookup table

**Key interfaces**

Input: raw `bytes` from `UploadFile.read()`, declared content-type string.

Output (success):
```python
@dataclass
class ImageBuffer:
    image: PIL.Image.Image   # decoded, normalised
    raw_bytes: bytes         # original upload bytes (needed by EXIF extractor)
    format: str              # "JPEG" | "PNG" | "WEBP" | "TIFF" | "BMP"
    size_bytes: int
```

Output (error): raises `IngestionError` with a `code` field (`"SIZE_EXCEEDED"`, `"UNSUPPORTED_FORMAT"`, `"MAGIC_BYTE_MISMATCH"`, `"DECODE_FAILED"`) that the API Gateway maps to the appropriate HTTP status and `ProblemDetails` title.

**Error handling**

- `SIZE_EXCEEDED` → HTTP 413
- `UNSUPPORTED_FORMAT` → HTTP 415
- `MAGIC_BYTE_MISMATCH` → HTTP 422, title `"Invalid File Content"`
- `DECODE_FAILED` → HTTP 422, title `"Image Processing Error"`

**Concurrency**

Each request allocates its own `ImageBuffer`. The service is stateless; no shared mutable state between calls.

---

### 4. Analysis Engine

**Responsibilities**

- Receive an `ImageBuffer` and coordinate the three forensic analysers.
- Execute ELA Analyser, Noise Analyser, and Clone Detector. These three may run concurrently (via `asyncio.gather` or a thread pool executor) because they each receive read-only access to the decoded image and do not share mutable state.
- Collect `AnalysisResult` objects from each analyser and pass them to the Score Aggregator.
- Enforce the per-analyser timeout (each analyser must complete within `ANALYSIS_TIMEOUT_SECONDS / 3` as a soft guideline; the outer `asyncio.wait_for` enforces the hard limit on the whole pipeline).
- Return a combined `PipelineResult` to the API layer.

**Technology**

- Python: `asyncio`, `concurrent.futures.ThreadPoolExecutor` (for CPU-bound analysers), OpenCV (`cv2`), Pillow, scikit-image, NumPy

**Sub-components**

#### 4a. ELA Analyser

- Re-saves the image at a known JPEG quality setting (configurable, default `75`), computes the absolute pixel difference between the original and the re-saved version, and amplifies the difference.
- High ELA values in a region indicate prior compression at a different quality level — a forensic indicator of splicing or re-editing.
- Returns a per-pixel ELA map (NumPy array) and a list of `RegionResult` objects for high-anomaly zones.

Input: `PIL.Image.Image` (read-only), ELA quality parameter (from config).
Output:
```python
@dataclass
class AnalyserOutput:
    sub_score: float             # [0.0, 1.0]
    regions: list[RegionResult]
    technique: Literal["ELA"]
```

#### 4b. Noise Analyser

- Estimates the local noise residual by subtracting a denoised version of the image from the original (using a Gaussian or bilateral filter).
- Inconsistencies in the noise pattern across image regions indicate splicing or copy-paste manipulation.
- Returns high-variance noise regions as `RegionResult` objects.

Input: `PIL.Image.Image` (read-only), filter parameters (from config).
Output: same `AnalyserOutput` shape with `technique: "noise_analysis"`.

#### 4c. Clone Detector

- Detects duplicated regions within the image by computing dense keypoint descriptors (e.g. SIFT or ORB) and finding matching descriptor clusters that correspond to spatially distinct image patches.
- A high-confidence match between two non-adjacent regions is evidence of copy-move forgery.
- Returns matched region pairs as `RegionResult` objects.

Input: `PIL.Image.Image` (read-only), minimum match threshold (from config).
Output: same `AnalyserOutput` shape with `technique: "clone_detection"`.

#### 4d. Score Aggregator

- Accepts the three `AnalyserOutput` objects.
- Computes the final score as a weighted average of sub-scores. Weights are configurable via environment variables (`ELA_WEIGHT`, `NOISE_WEIGHT`, `CLONE_WEIGHT`; defaults `0.4`, `0.3`, `0.3`; must sum to 1.0).
- Derives the verdict string from the score using configurable thresholds (`VERDICT_THRESHOLD_AUTHENTIC`, default `0.3`; `VERDICT_THRESHOLD_MANIPULATED`, default `0.7`):
  - `[0.0, VERDICT_THRESHOLD_AUTHENTIC]` → `"authentic"`
  - `(VERDICT_THRESHOLD_AUTHENTIC, VERDICT_THRESHOLD_MANIPULATED)` → `"suspicious"`
  - `[VERDICT_THRESHOLD_MANIPULATED, 1.0]` → `"likely manipulated"`
- Merges all region lists into a single deduplicated list.

Output:
```python
@dataclass
class PipelineResult:
    score: float
    verdict: str
    regions: list[RegionResult]
```

**Shared types**

```python
@dataclass
class RegionResult:
    technique: Literal["ELA", "noise_analysis", "clone_detection"]
    bounding_box: BoundingBox   # x, y, width, height in pixels
    confidence: float           # [0.0, 1.0]
```

**Concurrency**

All three analysers receive independent read-only views of the image. The `Image.copy()` call is made once per analyser before dispatch. No shared mutable state. Thread-safety guaranteed by value isolation.

**Configuration (environment variables)**

| Variable | Default | Description |
|----------|---------|-------------|
| `ELA_QUALITY` | `75` | JPEG re-save quality for ELA |
| `ELA_WEIGHT` | `0.4` | Score aggregation weight |
| `NOISE_WEIGHT` | `0.3` | Score aggregation weight |
| `CLONE_WEIGHT` | `0.3` | Score aggregation weight |
| `VERDICT_THRESHOLD_AUTHENTIC` | `0.3` | Upper bound for "authentic" verdict |
| `VERDICT_THRESHOLD_MANIPULATED` | `0.7` | Lower bound for "likely manipulated" verdict |

---

### 5. Heatmap Renderer

**Responsibilities**

- Accept the original `PIL.Image.Image` and the list of `RegionResult` objects from the Analysis Engine.
- Generate a colour-scale overlay image: each flagged region is painted with a semi-transparent colour proportional to its `confidence` value (low confidence: yellow/green; high confidence: red).
- Composite the overlay onto the original image.
- Encode the composited image as a PNG in memory and return it as a `data:image/png;base64,...` data URI string.
- Never write to disk; never retain the intermediate PIL objects after the data URI is produced.

**Technology**

- Python: Pillow (`PIL.Image`, `PIL.ImageDraw`), `base64`, `io.BytesIO`; optional Matplotlib for colour map generation

**Key interfaces**

Input:
```python
def render(
    original: PIL.Image.Image,
    regions: list[RegionResult],
    alpha: float,          # overlay opacity, from config HEATMAP_ALPHA default 0.5
) -> str:                  # returns data URI string
```

Output: `str` — `"data:image/png;base64,<base64-encoded-bytes>"`

On empty `regions` list: returns a data URI of the original image unmodified (as per FR-003 acceptance criterion for authentic images).

**Error handling**

If compositing fails (malformed region bounding box, colour mapping error), the renderer logs a warning at WARNING level (no image data in log) and returns the original image as the data URI without overlay, so the overall response is not aborted.

**Configuration (environment variables)**

| Variable | Default | Description |
|----------|---------|-------------|
| `HEATMAP_ALPHA` | `0.5` | Overlay opacity (0.0 = invisible, 1.0 = opaque) |

---

### 6. EXIF Extractor

**Responsibilities**

- Accept the raw image bytes (`bytes` object from `ImageBuffer.raw_bytes`).
- Attempt to parse all EXIF tags using ExifRead (or piexif as fallback).
- Return a flat `dict[str, Any]` mapping tag names to their decoded values.
- Return `{}` (empty dict) if the image has no EXIF block, the EXIF block is corrupt, or any parsing exception occurs. Never propagate EXIF parsing errors to the caller.
- Ensure no EXIF values (especially GPS coordinates, device identifiers) are written to any log.

**Technology**

- Python: `exifread` (primary), `piexif` (fallback), standard library `io`

**Key interfaces**

Input: `bytes` (raw image bytes, read-only).

Output:
```python
def extract(raw_bytes: bytes) -> dict[str, Any]:
    ...
    # returns {} on any error
```

**Error handling**

All exceptions during EXIF parsing are caught at the top-level `try/except` block. On any exception, the extractor logs a WARNING message containing only the exception type (not the exception message, which may contain EXIF values), and returns `{}`. This guarantees that a corrupt EXIF block cannot abort the analysis pipeline (FR-004).

**Privacy**

The extractor must not emit the values of any EXIF tags in log messages. The log entry on a parse error is limited to: `"EXIF extraction failed: <ExceptionType>"`.

**Concurrency**

Stateless; each call is fully independent. Safe to call concurrently.

---

### 7. Response Assembler

**Responsibilities**

- Accept the `PipelineResult` (score, verdict, regions), the heatmap data URI string, and the EXIF dict.
- Construct and return the `AnalysisResponse` Pydantic model.
- Validate that all required fields are present and within their declared ranges before serialisation; if the score is out of `[0.0, 1.0]` or the verdict is not one of the three defined strings, clamp/correct and log a WARNING (this is a defensive check against a misconfigured aggregator).

**Technology**

- Python: Pydantic v2

**Key interfaces**

```python
class AnalysisResponse(BaseModel):
    score: Annotated[float, Field(ge=0.0, le=1.0)]
    verdict: Literal["authentic", "suspicious", "likely manipulated"]
    heatmap_url: str        # data URI; non-empty
    exif: dict[str, Any]    # may be {}
    regions: list[RegionResponse]

class RegionResponse(BaseModel):
    technique: Literal["ELA", "noise_analysis", "clone_detection"]
    bounding_box: BoundingBoxResponse
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]

class BoundingBoxResponse(BaseModel):
    x: int
    y: int
    width: int
    height: int
```

**Error handling**

Pydantic validation failure at this stage is treated as an internal server error (HTTP 500, `ProblemDetails` title `"Internal Server Error"`). The internal validation message is logged at ERROR level and is not exposed in the response body.

**Concurrency**

Stateless; constructs a new model instance per request. No shared mutable state.

---

## Auth Strategy

PhotoCop MVP has no user authentication or authorisation layer. This is an explicit requirement boundary: user accounts and access control are out of scope (see `define-requirements.md` — Out of Scope).

At the API boundary, the only access controls are:

1. **File validation** — magic-byte checks and size limits (NFR-005).
2. **CORS** — the `CORS_ORIGINS` environment variable restricts cross-origin requests to the configured frontend origin.
3. **No secrets in source code** — all sensitive configuration (future API keys, etc.) must be supplied via environment variables.

Post-MVP additions such as rate limiting and API keys are deferred and must not be stubbed or partially implemented in this release.
