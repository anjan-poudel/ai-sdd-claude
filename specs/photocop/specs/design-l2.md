# L2 Component Design — PhotoCop

## Overview

This document specifies the detailed component design for PhotoCop. It covers module and file structure, class and function signatures with full type annotations, internal data flows, error handling contracts, concurrency and isolation guarantees, timeout configuration, and test strategies for all seven components identified in the L1 architecture.

**Scope boundary**: This document covers only components required by the L1 architecture. No authentication layer, rate limiting, caching, or persistence components are included — these are explicitly out of scope for the MVP.

**Key design constraints carried forward from L1**

- All image data is in-memory only; no writes to disk at any point in the pipeline.
- `imghdr` (deprecated in Python 3.11, removed in Python 3.13) must not be used. Magic-byte detection uses `python-magic` (libmagic binding) with a fallback to `filetype` for environments where libmagic is unavailable.
- Every async call specifies its timeout parameter name, default value, and configuration source.
- Every interface method declares both success and error return types explicitly.
- Shared resources between concurrent paths: the decoded `PIL.Image.Image` is copied (via `Image.copy()`) once per analyser before dispatch; the original is never mutated after that point.

---

## Components

---

### 1. React Frontend

#### Module and File Structure

```
frontend/
  src/
    main.tsx                  # React root mount
    App.tsx                   # Top-level state machine; owns AppState
    api/
      client.ts               # fetch wrapper; typed request/response; error parsing
      types.ts                # shared TypeScript types (mirrors backend Pydantic models)
    components/
      UploadForm.tsx           # drag-and-drop + file picker; client-side size gate
      ResultPanel.tsx          # orchestrates HeatmapDisplay + ExifTable + RegionList
      HeatmapDisplay.tsx       # renders heatmap_url as <img>; score + verdict badge
      ExifTable.tsx            # renders exif dict as key/value table
      RegionList.tsx           # renders regions[] as annotated list
      ErrorBanner.tsx          # displays RFC 7807 title; hides 5xx detail
      LoadingSpinner.tsx       # shown during uploading/analysing states
    hooks/
      useAnalyse.ts            # encapsulates fetch lifecycle; returns AppState slice
    styles/
      index.css                # global reset + design tokens
```

#### TypeScript Types (`api/types.ts`)

```typescript
// Mirrors backend AnalysisResponse / RegionResponse / BoundingBoxResponse exactly.
// No `any` — `exif` uses `Record<string, ExifValue>` with a bounded union.

export type ExifValue = string | number | boolean | null;

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Technique = "ELA" | "noise_analysis" | "clone_detection";

export interface Region {
  readonly technique: Technique;
  readonly bounding_box: BoundingBox;
  readonly confidence: number; // [0.0, 1.0]
}

export interface AnalysisResult {
  readonly score: number;      // [0.0, 1.0]
  readonly verdict: "authentic" | "suspicious" | "likely manipulated";
  readonly heatmap_url: string; // data URI
  readonly exif: Record<string, ExifValue>;
  readonly regions: readonly Region[];
}

// RFC 7807 Problem Details — error responses from the backend.
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
}

// Application UI state machine.
export type AppPhase = "idle" | "uploading" | "analysing" | "result" | "error";

export interface AppState {
  readonly phase: AppPhase;
  readonly result: AnalysisResult | null;
  readonly error: string | null; // user-safe message only
  readonly selectedFile: File | null;
}
```

#### API Client (`api/client.ts`)

```typescript
// MAX_FILE_BYTES is read from import.meta.env.VITE_MAX_FILE_BYTES at build time;
// defaults to 10 * 1024 * 1024 (10 MB) if the variable is absent.
export const MAX_FILE_BYTES: number;

// Timeout: VITE_REQUEST_TIMEOUT_MS (default 30 000 ms). Controlled by
// the environment variable at build time; AbortController used internally.

export type AnalyseSuccess = { ok: true; data: AnalysisResult };
export type AnalyseFailure = { ok: false; title: string; status: number };
export type AnalyseOutcome = AnalyseSuccess | AnalyseFailure;

export async function analyseImage(file: File): Promise<AnalyseOutcome>;
// - Builds FormData with field name "file".
// - Uses fetch() with AbortController; aborts after VITE_REQUEST_TIMEOUT_MS.
// - On HTTP 2xx: parses body as AnalysisResult; returns { ok: true, data }.
// - On HTTP 4xx: parses body as ProblemDetails; returns { ok: false, title, status }.
// - On HTTP 5xx or network error: returns { ok: false, title: "Service unavailable", status: 0 }.
// - Never throws; all exception paths are mapped to AnalyseFailure.
```

#### Key Component Signatures

```typescript
// UploadForm.tsx
interface UploadFormProps {
  onFileSelected: (file: File) => void;
  disabled: boolean;
}
export function UploadForm(props: UploadFormProps): React.ReactElement;
// Internal: validates file.size <= MAX_FILE_BYTES before calling onFileSelected.
// Renders client-side error inline (does not use ErrorBanner) when size exceeded.
// Accepts drag-and-drop (dragover/drop events) and <input type="file"> change event.
// Allowed MIME types enforced via <input accept>: image/jpeg, image/png,
//   image/webp, image/tiff, image/bmp.

// ResultPanel.tsx
interface ResultPanelProps {
  result: AnalysisResult;
}
export function ResultPanel(props: ResultPanelProps): React.ReactElement;
// Composes HeatmapDisplay, ExifTable, RegionList. No fetch logic here.

// HeatmapDisplay.tsx
interface HeatmapDisplayProps {
  heatmapUrl: string;
  score: number;
  verdict: AnalysisResult["verdict"];
}
export function HeatmapDisplay(props: HeatmapDisplayProps): React.ReactElement;
// Renders <img src={heatmapUrl} alt="Manipulation heatmap" />.
// Renders score as percentage and verdict as a colour-coded badge.
// score colours: green (<= 0.3), amber (> 0.3 and < 0.7), red (>= 0.7).

// ExifTable.tsx
interface ExifTableProps {
  exif: Record<string, ExifValue>;
}
export function ExifTable(props: ExifTableProps): React.ReactElement;
// Renders a two-column table of EXIF key/value pairs.
// When exif is empty ({}): renders a muted "No EXIF metadata available" message.

// ErrorBanner.tsx
interface ErrorBannerProps {
  message: string; // user-safe string only; never a stack trace
}
export function ErrorBanner(props: ErrorBannerProps): React.ReactElement;

// App.tsx
// Owns AppState; dispatches state transitions.
// Phase transitions:
//   idle      → uploading  (onFileSelected fires)
//   uploading → analysing  (analyseImage() called)
//   analysing → result     (AnalyseSuccess received)
//   analysing → error      (AnalyseFailure received)
//   result    → idle       (user clicks "Analyse another")
//   error     → idle       (user clicks "Try again")
// The upload button (inside UploadForm) is disabled when phase != "idle".
```

#### `useAnalyse` Hook (`hooks/useAnalyse.ts`)

```typescript
export interface UseAnalyseReturn {
  phase: AppPhase;
  result: AnalysisResult | null;
  error: string | null;
  submit: (file: File) => Promise<void>;
  reset: () => void;
}
export function useAnalyse(): UseAnalyseReturn;
// - Manages phase, result, error state with useState.
// - submit(): sets phase to "uploading", calls analyseImage(), sets phase to
//   "analysing" once fetch is initiated, then transitions to "result" or "error".
// - reset(): sets phase back to "idle", clears result and error.
// - One in-flight request enforced: submit() is a no-op if phase != "idle".
```

#### Internal Data Flow

```
User selects file
  → UploadForm validates size client-side
      → size > MAX_FILE_BYTES: inline error shown; no network call
      → size ok: onFileSelected(file) called
          → App sets phase = "uploading"
          → useAnalyse.submit(file) called
          → analyseImage(file) begins fetch
          → App sets phase = "analysing"
          → AbortController timeout running (VITE_REQUEST_TIMEOUT_MS)
              → fetch resolves:
                  → 2xx: parse AnalysisResult → phase = "result" → ResultPanel shown
                  → 4xx: parse ProblemDetails.title → phase = "error" → ErrorBanner shown
                  → 5xx / network / timeout: static message → phase = "error" → ErrorBanner shown
```

#### Error Handling

- Client-side size guard: inline message inside `UploadForm`, no state transition to "error".
- HTTP 4xx: `ProblemDetails.title` is displayed verbatim in `ErrorBanner`.
- HTTP 5xx or network failure or timeout abort: display `"Service unavailable — please try again."`.
- Never display `status` code, `detail` body, or any internal string to the user for 5xx.
- TypeScript `noImplicitAny` and `strict: true` in `tsconfig.json` prevent `any` from leaking into type signatures.

#### Concurrency

The upload button is disabled whenever `phase !== "idle"`. Only one `analyseImage()` call can be in-flight per browser tab at any time. The `AbortController` ensures the in-flight fetch is cancelled if the component unmounts (React cleanup in `useAnalyse`).

**Timeout**: `VITE_REQUEST_TIMEOUT_MS` — default `30000` ms — configured as a Vite build-time environment variable. If absent, defaults to `30000` ms hardcoded in `client.ts`.

#### Test Strategy

- **Unit tests** (`vitest` + `@testing-library/react`):
  - `UploadForm`: asserts client-side rejection when `file.size > MAX_FILE_BYTES`; asserts `onFileSelected` is called for valid file.
  - `HeatmapDisplay`: renders `<img>` with correct `src`; verdict badge colour class matches score range.
  - `ExifTable`: renders fallback message when `exif = {}`.
  - `ErrorBanner`: renders `message` prop; does not render when not mounted.
  - `useAnalyse`: mocks `analyseImage`; asserts phase transitions for success, 4xx, and 5xx paths.
- **Integration test** (`vitest` + `msw` for service worker mocking):
  - Full App render; uploads a 1 KB fixture file; MSW intercepts POST and returns mock `AnalysisResult`; asserts `ResultPanel` appears with correct score.
  - Asserts that the upload button is disabled while `phase === "analysing"`.
  - Asserts `ErrorBanner` appears on MSW-injected 422 response.

---

### 2. FastAPI Backend

#### Module and File Structure

```
backend/
  app/
    __init__.py
    main.py             # FastAPI app factory; registers routers + middleware + handlers
    config.py           # Settings (Pydantic BaseSettings); reads all env vars once at startup
    router.py           # APIRouter: POST /api/v1/analyse, GET /health
    middleware.py       # SizeLimitMiddleware (ASGI only)
    errors.py           # ProblemDetail model; global exception handlers; IngestionError mapping
    dependencies.py     # FastAPI Depends() factories (e.g. get_settings)
    ingestion.py        # Image Ingestion Service (see Component 3)
    exif.py             # EXIF Extractor (see Component 6)
    heatmap.py          # Heatmap Renderer (see Component 5)
    assembler.py        # Response Assembler (see Component 7)
    analysis/
      __init__.py
      engine.py         # Analysis Engine orchestrator (see Component 4)
      ela.py            # ELA Analyser
      noise.py          # Noise Analyser
      clone.py          # Clone Detector
      aggregator.py     # Score Aggregator
      types.py          # Shared dataclasses: AnalyserOutput, RegionResult, BoundingBox,
                        #   PipelineResult
  tests/
    conftest.py
    test_router.py      # integration tests: full request cycle via TestClient
    test_ingestion.py
    test_ela.py
    test_noise.py
    test_clone.py
    test_aggregator.py
    test_heatmap.py
    test_exif.py
    test_assembler.py
    fixtures/
      authentic.jpg     # known-authentic JPEG for tests
      manipulated.png   # known-manipulated PNG for tests
      corrupt.bin       # invalid bytes for ingestion failure tests
      no_exif.jpg       # valid JPEG with no EXIF block
```

#### `config.py` — Settings

```python
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    # HTTP / ingestion
    max_upload_bytes: int = Field(default=10_485_760, alias="MAX_UPLOAD_BYTES")
    cors_origins: list[str] = Field(default=["http://localhost:5173"], alias="CORS_ORIGINS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # Analysis pipeline
    # Timeout for asyncio.wait_for() wrapping the full analysis pipeline.
    # Configurable via ANALYSIS_TIMEOUT_SECONDS env var. Default: 9 seconds.
    analysis_timeout_seconds: float = Field(default=9.0, alias="ANALYSIS_TIMEOUT_SECONDS")

    # Health check
    # HEALTH_CHECK_TIMEOUT_MS is informational (not enforced in code);
    # it documents the SLA. Recorded here for observability/alerting reference.
    health_check_timeout_ms: int = Field(default=200, alias="HEALTH_CHECK_TIMEOUT_MS")

    # Analysis weights and thresholds
    ela_quality: int = Field(default=75, alias="ELA_QUALITY")
    ela_weight: float = Field(default=0.4, alias="ELA_WEIGHT")
    noise_weight: float = Field(default=0.3, alias="NOISE_WEIGHT")
    clone_weight: float = Field(default=0.3, alias="CLONE_WEIGHT")
    verdict_threshold_authentic: float = Field(default=0.3, alias="VERDICT_THRESHOLD_AUTHENTIC")
    verdict_threshold_manipulated: float = Field(default=0.7, alias="VERDICT_THRESHOLD_MANIPULATED")

    # Heatmap
    heatmap_alpha: float = Field(default=0.5, alias="HEATMAP_ALPHA")

    @model_validator(mode="after")
    def validate_weights_sum(self) -> "Settings":
        """Fails at startup if analysis weights do not sum to 1.0 (±1e-6)."""
        total = self.ela_weight + self.noise_weight + self.clone_weight
        if abs(total - 1.0) > 1e-6:
            raise ValueError(
                f"ELA_WEIGHT + NOISE_WEIGHT + CLONE_WEIGHT must sum to 1.0; got {total}"
            )
        return self

    model_config = {"env_file": ".env", "populate_by_name": True}

# Module-level singleton — loaded once at startup.
# If weight validation fails, the process exits before serving any requests.
def get_settings() -> Settings: ...
```

#### `errors.py` — ProblemDetail and Exception Handlers

```python
from pydantic import BaseModel
from fastapi import Request
from fastapi.responses import JSONResponse

class ProblemDetail(BaseModel):
    type: str
    title: str
    status: int
    detail: str

# Mapping from IngestionError.code to (HTTP status, title).
INGESTION_ERROR_MAP: dict[str, tuple[int, str]] = {
    "SIZE_EXCEEDED":      (413, "File Too Large"),
    "UNSUPPORTED_FORMAT": (415, "Unsupported Media Type"),
    "MAGIC_BYTE_MISMATCH":(422, "Invalid File Content"),
    "DECODE_FAILED":      (422, "Image Processing Error"),
}

async def ingestion_error_handler(request: Request, exc: IngestionError) -> JSONResponse:
    # Returns application/problem+json; never exposes exc.args or tracebacks.
    ...

async def timeout_error_handler(request: Request, exc: asyncio.TimeoutError) -> JSONResponse:
    # Returns 504, title "Analysis Timeout".
    ...

async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    # Logs exception at ERROR level (server-side only); returns 500, title "Internal Server Error".
    ...
```

#### `router.py` — Endpoint Signatures

```python
from fastapi import APIRouter, UploadFile, File, Depends
from app.config import Settings, get_settings
from app.assembler import AnalysisResponse
import asyncio

router = APIRouter(prefix="/api/v1")

# NOTE: /health is registered on the root app (no prefix), not on this router.
# See main.py app factory — health_router is a separate APIRouter with no prefix.

@router.post(
    "/analyse",
    response_model=AnalysisResponse,
    responses={
        413: {"model": ProblemDetail},
        415: {"model": ProblemDetail},
        422: {"model": ProblemDetail},
        504: {"model": ProblemDetail},
        500: {"model": ProblemDetail},
    },
)
async def analyse(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
) -> AnalysisResponse:
    # 1. Read bytes from UploadFile.
    # 2. Call ingest(raw_bytes, content_type) → ImageBuffer | raises IngestionError.
    # 3. Wrap analysis pipeline in asyncio.wait_for(timeout=settings.analysis_timeout_seconds).
    # 4. Call run_pipeline(buffer, settings) → PipelineResult.
    # 5. Call render(buffer.image, pipeline_result.regions, settings.heatmap_alpha) → str.
    # 6. Call extract(buffer.raw_bytes) → dict.
    # 7. Call assemble(pipeline_result, heatmap_url, exif_data) → AnalysisResponse.
    # 8. Return AnalysisResponse.
    ...

# Health endpoint on a separate router with NO prefix so it resolves to GET /health.
health_router = APIRouter()

@health_router.get("/health", response_model=dict[str, str])
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

#### `middleware.py` — SizeLimitMiddleware

```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

class SizeLimitMiddleware(BaseHTTPMiddleware):
    """
    Reads Content-Length header at request boundary.
    If Content-Length > max_upload_bytes, returns 413 ProblemDetail immediately
    without buffering the request body into memory.
    If Content-Length is absent, the body is streamed; once bytes_read exceeds
    max_upload_bytes, reading stops and 413 is returned.
    Timeout: not applicable (synchronous header check before body buffering).
    """
    def __init__(self, app: ASGIApp, max_upload_bytes: int) -> None: ...
    async def dispatch(self, request: Request, call_next: Callable) -> Response: ...
```

#### `main.py` — App Factory

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.middleware import SizeLimitMiddleware
from app.errors import ingestion_error_handler, timeout_error_handler, generic_error_handler
from app.router import router
from app.ingestion import IngestionError
import asyncio
import logging

def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)

    app = FastAPI(title="PhotoCop", docs_url="/docs", redoc_url=None)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.add_middleware(SizeLimitMiddleware, max_upload_bytes=settings.max_upload_bytes)

    app.add_exception_handler(IngestionError, ingestion_error_handler)
    app.add_exception_handler(asyncio.TimeoutError, timeout_error_handler)
    app.add_exception_handler(Exception, generic_error_handler)

    app.include_router(router)        # mounts /api/v1/analyse
    app.include_router(health_router)  # mounts /health (no prefix)
    return app

app = create_app()
```

#### Internal Data Flow (Backend Request Lifecycle)

```
POST /api/v1/analyse arrives
  → SizeLimitMiddleware checks Content-Length; rejects at HTTP boundary if > MAX_UPLOAD_BYTES
  → router.analyse() coroutine starts
      → UploadFile.read() into raw_bytes: bytes
      → ingest(raw_bytes, content_type) called
          → IngestionError raised on failure → ingestion_error_handler → 413/415/422
          → ImageBuffer returned on success
      → asyncio.wait_for(run_pipeline(buffer, settings), timeout=analysis_timeout_seconds)
          → asyncio.TimeoutError → timeout_error_handler → 504
          → PipelineResult returned on success
      → render(buffer.image, pipeline_result.regions, settings.heatmap_alpha) → heatmap_url
      → extract(buffer.raw_bytes) → exif_dict (never raises)
      → assemble(pipeline_result, heatmap_url, exif_dict) → AnalysisResponse
      → FastAPI serialises AnalysisResponse as JSON; response flushed
      → raw_bytes, buffer, pipeline intermediates go out of scope; GC reclaims
```

#### Error Handling

All handlers produce `Content-Type: application/problem+json`. The `generic_error_handler` is the backstop — it logs the full traceback at ERROR level server-side and returns a 500 with no internal detail. No other handler surfaces tracebacks.

#### Concurrency

Each HTTP request is an independent asyncio coroutine. There is no shared mutable state between requests. The `Settings` singleton is read-only after startup. `asyncio.wait_for` with `settings.analysis_timeout_seconds` is the hard timeout for the pipeline.

**Timeout**: `analysis_timeout_seconds` — default `9.0` — configurable via `ANALYSIS_TIMEOUT_SECONDS` env var — applied in `router.analyse()` via `asyncio.wait_for`.

#### Test Strategy

- **`test_router.py`** (integration, `fastapi.testclient.TestClient`):
  - POST with valid JPEG fixture → 200 with `score`, `verdict`, `heatmap_url`, `exif`, `regions` fields present.
  - POST with file > MAX_UPLOAD_BYTES → 413, `Content-Type: application/problem+json`, `title == "File Too Large"`.
  - POST with `.txt` file containing valid text → 415 or 422 (depending on MIME).
  - POST with corrupt binary fixture → 422, `title == "Invalid File Content"` or `"Image Processing Error"`.
  - GET `/health` → 200, body `{"status": "ok"}`.
  - Patch `run_pipeline` to raise `asyncio.TimeoutError` → assert 504, `title == "Analysis Timeout"`.
- **Unit tests** for each module below are specified in their own sections.

---

### 3. Image Ingestion Service

#### Module and File Structure

```
backend/app/ingestion.py   # all ingestion logic in a single module
```

#### Magic-Byte Detection Strategy

`imghdr` is deprecated since Python 3.11 and removed in Python 3.13. This service uses `python-magic` (libmagic binding) as the primary detector, with `filetype` as a pure-Python fallback for environments where libmagic is unavailable.

The detection order is:

1. **`python-magic`** (`import magic`): `magic.from_buffer(raw_bytes[:256], mime=True)` → MIME string.
2. **`filetype`** fallback (`import filetype`): `filetype.guess(raw_bytes[:256])` → `filetype.Type` with `.mime`.
3. If both fail (import error or ambiguous result): raise `IngestionError(code="MAGIC_BYTE_MISMATCH")`.

The magic-byte table maps MIME type strings to canonical format names:

```python
SUPPORTED_MIME_TO_FORMAT: dict[str, str] = {
    "image/jpeg": "JPEG",
    "image/png":  "PNG",
    "image/webp": "WEBP",
    "image/tiff": "TIFF",
    "image/bmp":  "BMP",
}
```

Any MIME not in this table → `IngestionError(code="UNSUPPORTED_FORMAT")`.

#### Data Classes

```python
from __future__ import annotations
from dataclasses import dataclass
from PIL import Image as PILImage

@dataclass(frozen=True)
class ImageBuffer:
    image: PILImage.Image      # decoded, normalised to RGB or RGBA
    raw_bytes: bytes           # original upload bytes (needed by EXIF extractor)
    format: str                # "JPEG" | "PNG" | "WEBP" | "TIFF" | "BMP"
    size_bytes: int            # len(raw_bytes)

class IngestionError(Exception):
    """
    Raised by ingest() on any validation or decoding failure.
    The `code` field is the stable contract consumed by errors.py.
    The `message` field is a human-readable detail (not exposed externally).
    """
    def __init__(
        self,
        code: Literal[
            "SIZE_EXCEEDED",
            "UNSUPPORTED_FORMAT",
            "MAGIC_BYTE_MISMATCH",
            "DECODE_FAILED",
        ],
        message: str,
    ) -> None:
        self.code = code
        self.message = message
        super().__init__(message)
```

#### `ingest()` Function

```python
import io
from PIL import Image as PILImage
from app.config import Settings

def ingest(
    raw_bytes: bytes,
    declared_content_type: str,
    settings: Settings,
) -> ImageBuffer:
    """
    Validates and decodes raw image bytes.

    Args:
        raw_bytes: Full upload bytes read from UploadFile.
        declared_content_type: Content-Type header value from the HTTP request.
        settings: Application settings (provides max_upload_bytes).

    Returns:
        ImageBuffer on success.

    Raises:
        IngestionError with code:
            "SIZE_EXCEEDED"       — len(raw_bytes) > settings.max_upload_bytes
            "UNSUPPORTED_FORMAT"  — MIME not in SUPPORTED_MIME_TO_FORMAT
            "MAGIC_BYTE_MISMATCH" — magic bytes do not match supported formats
            "DECODE_FAILED"       — PIL fails to open/decode the image
    """
    # Step 1: Secondary size check (primary is SizeLimitMiddleware).
    if len(raw_bytes) > settings.max_upload_bytes:
        raise IngestionError("SIZE_EXCEEDED", f"File size {len(raw_bytes)} exceeds limit")

    # Step 2: Magic-byte detection (python-magic → filetype fallback).
    detected_mime = _detect_mime(raw_bytes)  # raises IngestionError on failure

    # Step 3: Derive canonical format from MIME.
    canonical_format = SUPPORTED_MIME_TO_FORMAT.get(detected_mime)
    if canonical_format is None:
        raise IngestionError("UNSUPPORTED_FORMAT", f"Unsupported MIME: {detected_mime}")

    # Step 4: Decode with Pillow.
    try:
        pil_image = PILImage.open(io.BytesIO(raw_bytes))
        pil_image.load()  # force decompression; catches truncated images
        # Normalise colour space: convert palette-mode (P) and LA to RGBA; rest to RGB.
        if pil_image.mode in ("P", "LA"):
            pil_image = pil_image.convert("RGBA")
        elif pil_image.mode != "RGBA":
            pil_image = pil_image.convert("RGB")
    except Exception as exc:
        raise IngestionError("DECODE_FAILED", "PIL could not decode image") from exc

    return ImageBuffer(
        image=pil_image,
        raw_bytes=raw_bytes,
        format=canonical_format,
        size_bytes=len(raw_bytes),
    )

def _detect_mime(raw_bytes: bytes) -> str:
    """
    Returns detected MIME string.
    Raises IngestionError("MAGIC_BYTE_MISMATCH", ...) if detection fails.
    """
    ...
```

#### Internal Data Flow

```
raw_bytes, declared_content_type, settings → ingest()
  → len(raw_bytes) check → IngestionError("SIZE_EXCEEDED") or continue
  → _detect_mime(raw_bytes)
      → magic.from_buffer (python-magic) → MIME string or ImportError
      → filetype.guess fallback → MIME string or None
      → None result → IngestionError("MAGIC_BYTE_MISMATCH")
  → SUPPORTED_MIME_TO_FORMAT lookup → IngestionError("UNSUPPORTED_FORMAT") or canonical_format
  → PILImage.open(BytesIO(raw_bytes)).load() → IngestionError("DECODE_FAILED") or pil_image
  → colour-space normalisation
  → ImageBuffer(image, raw_bytes, format, size_bytes) returned
```

#### Error Handling

`ingest()` is the only public entry point. It raises `IngestionError` for all four failure modes and never swallows unexpected exceptions (let them propagate to the `generic_error_handler`). The caller (`router.analyse`) catches `IngestionError`; the `ingestion_error_handler` maps `code` to HTTP status + title.

#### Concurrency

Stateless pure function. Each call allocates its own `BytesIO` and `PIL.Image`. No shared mutable state. Safe for concurrent use.

#### Test Strategy

- `test_ingestion.py`:
  - Valid JPEG bytes → `ImageBuffer` with `format == "JPEG"`, `image.mode in ("RGB", "RGBA")`.
  - Valid PNG with transparency → `image.mode == "RGBA"`.
  - Bytes length > `max_upload_bytes` → `IngestionError(code="SIZE_EXCEEDED")`.
  - Bytes with wrong magic bytes (e.g. a PDF header) → `IngestionError(code="MAGIC_BYTE_MISMATCH")` or `"UNSUPPORTED_FORMAT"`.
  - Corrupt truncated JPEG → `IngestionError(code="DECODE_FAILED")`.
  - `_detect_mime` with both `python-magic` and `filetype` monkeypatched to raise `ImportError` → `IngestionError(code="MAGIC_BYTE_MISMATCH")`.
  - Asserts `ingest()` never writes any file (monkeypatch `open` to raise if called).

---

### 4. Analysis Engine

#### Module and File Structure

```
backend/app/analysis/
  __init__.py          # exports run_pipeline
  engine.py            # run_pipeline(); ThreadPoolExecutor management
  ela.py               # ELAAnalyser class
  noise.py             # NoiseAnalyser class
  clone.py             # CloneDetector class
  aggregator.py        # ScoreAggregator
  types.py             # AnalyserOutput, RegionResult, BoundingBox, PipelineResult
```

#### Shared Types (`analysis/types.py`)

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal

@dataclass(frozen=True)
class BoundingBox:
    x: int
    y: int
    width: int
    height: int

@dataclass(frozen=True)
class RegionResult:
    technique: Literal["ELA", "noise_analysis", "clone_detection"]
    bounding_box: BoundingBox
    confidence: float  # [0.0, 1.0]

@dataclass(frozen=True)
class AnalyserOutput:
    sub_score: float              # [0.0, 1.0]
    regions: list[RegionResult]
    technique: Literal["ELA", "noise_analysis", "clone_detection"]

@dataclass(frozen=True)
class PipelineResult:
    score: float                  # [0.0, 1.0]
    verdict: str                  # "authentic" | "suspicious" | "likely manipulated"
    regions: list[RegionResult]   # merged from all three analysers
```

#### `engine.py` — `run_pipeline()`

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor
from PIL.Image import Image as PILImage
from app.analysis.types import PipelineResult, AnalyserOutput
from app.analysis.ela import ELAAnalyser
from app.analysis.noise import NoiseAnalyser
from app.analysis.clone import CloneDetector
from app.analysis.aggregator import ScoreAggregator
from app.config import Settings
from app.ingestion import ImageBuffer

# Module-level executor: shared across all requests; allows up to 3 concurrent
# CPU-bound workers (one per analyser per in-flight request).
# Concurrency isolation: each analyser receives Image.copy() — independent copy,
# no shared mutable state. The executor itself is read-only shared resource.
# Write isolation: each thread produces a new AnalyserOutput; no cross-thread mutation.
_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="analyser")

async def run_pipeline(buffer: ImageBuffer, settings: Settings) -> PipelineResult:
    """
    Fans out to three analysers concurrently using the module-level ThreadPoolExecutor.
    The outer asyncio.wait_for() in router.analyse() enforces the hard timeout.

    Concurrency contract:
      - Reads: all three threads receive independent Image.copy() objects; the original
        buffer.image is not accessed after the copies are made.
      - Writes: each thread produces a new AnalyserOutput; no cross-thread mutation.
      - Deregistration: the executor is created once at module load and lives for the
        process lifetime; no per-request cleanup required.

    Args:
        buffer: ImageBuffer from ingestion (read-only after Image.copy() calls).
        settings: Application settings (weights, thresholds, ela_quality).

    Returns:
        PipelineResult with aggregated score, verdict, and merged regions.

    Raises:
        AnalysisError: if any analyser raises an unexpected exception.
            (asyncio.TimeoutError is NOT caught here; it propagates to router.analyse)
    """
    loop = asyncio.get_running_loop()

    ela_image = buffer.image.copy()
    noise_image = buffer.image.copy()
    clone_image = buffer.image.copy()

    ela_analyser = ELAAnalyser(quality=settings.ela_quality)
    noise_analyser = NoiseAnalyser()
    clone_detector = CloneDetector()

    ela_future = loop.run_in_executor(_EXECUTOR, ela_analyser.analyse, ela_image)
    noise_future = loop.run_in_executor(_EXECUTOR, noise_analyser.analyse, noise_image)
    clone_future = loop.run_in_executor(_EXECUTOR, clone_detector.analyse, clone_image)

    ela_out, noise_out, clone_out = await asyncio.gather(
        ela_future, noise_future, clone_future
    )

    aggregator = ScoreAggregator(
        ela_weight=settings.ela_weight,
        noise_weight=settings.noise_weight,
        clone_weight=settings.clone_weight,
        threshold_authentic=settings.verdict_threshold_authentic,
        threshold_manipulated=settings.verdict_threshold_manipulated,
    )
    return aggregator.aggregate(ela_out, noise_out, clone_out)

class AnalysisError(Exception):
    """Wraps unexpected exceptions from analysers. Never wraps TimeoutError."""
    def __init__(self, analyser: str, cause: Exception) -> None:
        self.analyser = analyser
        self.cause = cause
        super().__init__(f"Analyser {analyser!r} failed: {type(cause).__name__}")
```

#### `ela.py` — ELA Analyser

```python
import io
import numpy as np
from PIL import Image as PILImage
from app.analysis.types import AnalyserOutput, RegionResult, BoundingBox

class ELAAnalyser:
    """
    Error Level Analysis: re-saves image at `quality` JPEG setting, computes
    absolute pixel difference, identifies high-anomaly zones.

    Configuration:
        quality: JPEG re-save quality. Default 75. Configurable via ELA_QUALITY env var.
    """
    def __init__(self, quality: int = 75) -> None:
        self.quality = quality

    def analyse(self, image: PILImage.Image) -> AnalyserOutput:
        """
        Args:
            image: PIL Image (read-only copy; RGB or RGBA mode guaranteed).

        Returns:
            AnalyserOutput with technique="ELA", sub_score in [0.0, 1.0],
            and list of RegionResult objects for high-anomaly zones.

        Raises:
            AnalysisError: on unexpected internal failure (e.g. NumPy shape mismatch).
                Not raised for normal low-confidence results.
        """
        ...

    def _compute_ela_map(self, original: PILImage.Image) -> np.ndarray:
        """Returns per-pixel ELA difference as uint8 NumPy array (H, W, 3)."""
        ...

    def _find_high_anomaly_regions(
        self, ela_map: np.ndarray, threshold_percentile: float = 95.0
    ) -> list[RegionResult]:
        """
        Applies connected-component labelling to pixels above `threshold_percentile`
        of the ELA map intensity distribution. Returns bounding boxes as RegionResult.
        """
        ...

    def _compute_sub_score(self, ela_map: np.ndarray) -> float:
        """
        Normalises mean ELA intensity across the image to [0.0, 1.0].
        Uses the 99th-percentile of a reference distribution as the normalisation factor.
        """
        ...
```

#### `noise.py` — Noise Analyser

```python
import numpy as np
from PIL import Image as PILImage
from app.analysis.types import AnalyserOutput, RegionResult

class NoiseAnalyser:
    """
    Noise residual analysis: subtracts a denoised version from the original to
    extract the noise pattern; flags regions with inconsistent noise variance.

    Configuration:
        No per-instance configuration required beyond image input.
        Filter kernel size: fixed 5x5 Gaussian (not externally configurable per L1).
    """

    def analyse(self, image: PILImage.Image) -> AnalyserOutput:
        """
        Args:
            image: PIL Image (read-only copy; RGB or RGBA mode guaranteed).

        Returns:
            AnalyserOutput with technique="noise_analysis", sub_score in [0.0, 1.0].

        Raises:
            AnalysisError: on unexpected internal failure.
        """
        ...

    def _extract_noise_residual(self, image: PILImage.Image) -> np.ndarray:
        """
        Converts image to grayscale NumPy array, applies Gaussian blur with
        kernel (5, 5), returns |original - blurred| as float32 array (H, W).
        """
        ...

    def _detect_inconsistent_regions(
        self, noise_map: np.ndarray
    ) -> list[RegionResult]:
        """
        Divides image into a grid of non-overlapping tiles (default 32x32 px).
        Computes local variance per tile. Tiles whose variance differs from the
        median tile variance by more than 2 standard deviations are flagged.
        Returns bounding boxes as RegionResult with confidence proportional to
        normalised variance deviation.
        """
        ...
```

#### `clone.py` — Clone Detector

```python
import cv2
import numpy as np
from PIL import Image as PILImage
from app.analysis.types import AnalyserOutput, RegionResult

class CloneDetector:
    """
    Copy-move forgery detection via dense keypoint descriptors.
    Uses ORB (Oriented FAST and Rotated BRIEF) — no licensing restrictions,
    suitable for production. Falls back gracefully when fewer than
    `min_match_count` descriptor matches are found.

    Configuration:
        min_match_count: minimum good matches to declare a cloned region.
            Fixed at 10 for MVP; not externally configurable per L1.
    """
    MIN_MATCH_COUNT: int = 10

    def analyse(self, image: PILImage.Image) -> AnalyserOutput:
        """
        Args:
            image: PIL Image (read-only copy; RGB or RGBA mode guaranteed).

        Returns:
            AnalyserOutput with technique="clone_detection", sub_score in [0.0, 1.0].
            If fewer than MIN_MATCH_COUNT matches found: sub_score=0.0, regions=[].

        Raises:
            AnalysisError: on OpenCV failure (e.g. unsupported image dimensions).
        """
        ...

    def _pil_to_cv2_gray(self, image: PILImage.Image) -> np.ndarray:
        """Converts PIL Image (RGB/RGBA) to OpenCV uint8 grayscale ndarray."""
        ...

    def _detect_and_match(
        self, gray: np.ndarray
    ) -> list[tuple[cv2.KeyPoint, cv2.KeyPoint]]:
        """
        Detects ORB keypoints and descriptors. Matches descriptors using
        BFMatcher with Hamming norm. Returns list of (kp1, kp2) pairs where
        kp1 and kp2 are spatially distant (Euclidean distance > min_spatial_distance).
        min_spatial_distance = max(image.width, image.height) * 0.05 (5% of largest dimension).
        """
        ...

    def _matches_to_regions(
        self, matches: list[tuple[cv2.KeyPoint, cv2.KeyPoint]], image_shape: tuple[int, int]
    ) -> list[RegionResult]:
        """Converts matched keypoint pairs to bounding-box RegionResult objects."""
        ...
```

#### `aggregator.py` — Score Aggregator

```python
from app.analysis.types import AnalyserOutput, PipelineResult, RegionResult

class ScoreAggregator:
    """
    Combines three AnalyserOutput objects into a single PipelineResult.

    Invariant: ela_weight + noise_weight + clone_weight must equal 1.0 (±1e-6).
    Validated at construction time; raises ValueError if not satisfied.
    """

    def __init__(
        self,
        ela_weight: float,
        noise_weight: float,
        clone_weight: float,
        threshold_authentic: float,
        threshold_manipulated: float,
    ) -> None:
        # Validates weights sum to 1.0; raises ValueError if not.
        ...

    def aggregate(
        self,
        ela: AnalyserOutput,
        noise: AnalyserOutput,
        clone: AnalyserOutput,
    ) -> PipelineResult:
        """
        Args:
            ela, noise, clone: outputs from the three analysers.

        Returns:
            PipelineResult with:
                score = ela.sub_score * ela_weight + noise.sub_score * noise_weight
                        + clone.sub_score * clone_weight
                verdict derived from score vs thresholds.
                regions: merged list from all three outputs.

        Score is clamped to [0.0, 1.0] after computation (guards against
        floating-point rounding beyond weight normalisation).
        """
        ...

    def _derive_verdict(self, score: float) -> str:
        """
        score <= threshold_authentic        → "authentic"
        threshold_authentic < score < threshold_manipulated → "suspicious"
        score >= threshold_manipulated      → "likely manipulated"
        """
        ...
```

#### Internal Data Flow

```
run_pipeline(buffer, settings)
  → buffer.image.copy() × 3 (ela_image, noise_image, clone_image)
  → ThreadPoolExecutor.submit × 3 (one thread per analyser)
      ELAAnalyser.analyse(ela_image)     → AnalyserOutput(technique="ELA", ...)
      NoiseAnalyser.analyse(noise_image) → AnalyserOutput(technique="noise_analysis", ...)
      CloneDetector.analyse(clone_image) → AnalyserOutput(technique="clone_detection", ...)
  → asyncio.gather() awaits all three futures
  → ScoreAggregator.aggregate(ela_out, noise_out, clone_out) → PipelineResult
  → PipelineResult returned to router.analyse()
```

#### Error Handling

- `asyncio.gather` is called without `return_exceptions=True`. If any analyser raises, the exception propagates immediately; the remaining futures are not awaited (they continue in their threads but their results are discarded). The exception becomes an `AnalysisError` wrapping the original exception, which propagates to `generic_error_handler` → HTTP 500.
- `asyncio.TimeoutError` from `wait_for` in the router is NOT caught in the engine — it propagates cleanly to the `timeout_error_handler`.
- Each analyser class wraps its internal logic in a `try/except Exception` and re-raises as `AnalysisError` with the analyser name, to preserve diagnostic context in logs.

#### Concurrency

- **Shared resource**: `_EXECUTOR` (module-level `ThreadPoolExecutor`). Read-only from the engine's perspective — the engine only calls `run_in_executor`. No registration/deregistration needed; the executor is alive for the process lifetime.
- **Image copies**: `Image.copy()` is called in the event loop (before `run_in_executor`) for each analyser. After dispatch, the original `buffer.image` is not touched by the engine. The copies are owned exclusively by their respective analyser threads.
- **Thread isolation**: Each analyser thread operates on its private copy of the image and produces a new `AnalyserOutput` dataclass. No shared mutable state between threads.

**Timeout**: `analysis_timeout_seconds` — default `9.0` — enforced by `asyncio.wait_for` in `router.analyse()`. There is no separate per-analyser timeout; the outer timeout is the hard limit.

#### Test Strategy

- `test_ela.py`: synthetic 100x100 RGB image with a deliberately spliced JPEG-recompressed patch → `sub_score > 0` and `len(regions) >= 1`; solid colour image → `sub_score` near 0, `regions == []`.
- `test_noise.py`: image with a visually smooth region pasted onto a noisy background → at least one `RegionResult` with `confidence > 0.5`; uniform noise image → no regions flagged.
- `test_clone.py`: image with a copied-and-pasted rectangle → `sub_score > 0`, `len(regions) >= 1`; unique-content image → `regions == []`.
- `test_aggregator.py`:
  - Weights that do not sum to 1.0 → `ValueError` at construction.
  - Score = `ela_weight * ela_sub + noise_weight * noise_sub + clone_weight * clone_sub`; assert exact value.
  - score = 0.15 → verdict `"authentic"`.
  - score = 0.5 → verdict `"suspicious"`.
  - score = 0.85 → verdict `"likely manipulated"`.
- `test_engine.py`:
  - `run_pipeline` with a real JPEG fixture → `PipelineResult` with all fields present and score in [0.0, 1.0].
  - Monkeypatch one analyser to raise `RuntimeError` → assert `AnalysisError` propagates (i.e. not silently swallowed).
  - Monkeypatch `run_pipeline` to `asyncio.sleep(999)` in the router test → assert 504 from the router's `wait_for`.

---

### 5. Heatmap Renderer

#### Module and File Structure

```
backend/app/heatmap.py   # single module
```

#### Function Signature

```python
import base64
import io
import logging
from PIL import Image as PILImage, ImageDraw
from app.analysis.types import RegionResult

logger = logging.getLogger(__name__)

def render(
    original: PILImage.Image,
    regions: list[RegionResult],
    alpha: float = 0.5,
) -> str:
    """
    Composites a colour-scale overlay onto `original` for each region in `regions`.
    Encodes the result as a PNG and returns a data URI string.

    Args:
        original: Source PIL Image (read-only; not mutated).
        regions:  List of RegionResult from the analysis pipeline.
        alpha:    Overlay opacity in [0.0, 1.0]. Configurable via HEATMAP_ALPHA.
                  Default 0.5. Passed from settings.heatmap_alpha by the caller.

    Returns:
        str: "data:image/png;base64,<base64-encoded-PNG>"
        On empty `regions`: returns original image encoded as data URI (no overlay).
        On compositing error: logs WARNING, returns original image as data URI.

    Raises:
        Never raises. All exceptions are caught and result in the fallback data URI.

    Timeout: Not applicable (synchronous CPU-bound function; no I/O).
    Memory: All intermediate PIL objects are released before return (explicit del).
    """
    ...

def _confidence_to_rgba(confidence: float, alpha: float) -> tuple[int, int, int, int]:
    """
    Maps confidence [0.0, 1.0] to an RGBA colour:
      0.0 → green  (0, 255, 0)
      0.5 → yellow (255, 255, 0)
      1.0 → red    (255, 0, 0)
    Alpha channel: round(alpha * 255).
    Uses linear interpolation between the three colour stops.
    """
    ...

def _encode_to_data_uri(image: PILImage.Image) -> str:
    """
    Encodes a PIL Image as PNG into an in-memory BytesIO buffer.
    Returns "data:image/png;base64,<encoded>".
    Buffer is closed after encoding; no disk I/O.
    """
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    buf.close()
    return f"data:image/png;base64,{encoded}"
```

#### Colour Mapping

The overlay uses a three-stop linear gradient:

| Confidence | Colour (RGB) | Semantics        |
|------------|--------------|------------------|
| 0.0        | (0, 255, 0)  | Low concern      |
| 0.5        | (255, 255, 0)| Moderate concern |
| 1.0        | (255, 0, 0)  | High concern     |

Interpolation is computed per-region, not per-pixel, to avoid Matplotlib dependency. Each region is drawn as a filled semi-transparent rectangle via `PIL.ImageDraw.rectangle`.

#### Internal Data Flow

```
render(original, regions, alpha)
  → regions == [] → _encode_to_data_uri(original) → return data URI
  → overlay = PILImage.new("RGBA", original.size, (0, 0, 0, 0))
  → draw = ImageDraw.Draw(overlay)
  → for region in regions:
      → _confidence_to_rgba(region.confidence, alpha) → fill_colour
      → draw.rectangle(bbox_tuple, fill=fill_colour)
      → (on ValueError from bad bbox: log WARNING, skip region)
  → base = original.copy().convert("RGBA")
  → composite = PILImage.alpha_composite(base, overlay)
  → del overlay, draw, base  (explicit release)
  → _encode_to_data_uri(composite) → data URI string
  → del composite
  → return data URI
```

#### Error Handling

- `render()` wraps the entire compositing block in `try/except Exception`. On any exception: log `WARNING` with exception type only (no image content, no EXIF, no region coordinates in the log message). Return `_encode_to_data_uri(original)` as the fallback.
- Invalid bounding box values (e.g. negative width, coordinates outside image dimensions): caught per-region; that region is skipped with a WARNING; other regions continue.
- `_encode_to_data_uri()` failure: propagated to the outer `try/except` in `render()` (should be unreachable for valid PIL objects).

#### Concurrency

Stateless pure function. Each call receives its own `original` copy (the engine already called `Image.copy()` on the buffer before dispatch — however, for heatmap rendering, the router passes `buffer.image` directly, so the heatmap renderer must not mutate the input). `_encode_to_data_uri` creates a fresh `BytesIO` per call. No shared mutable state.

#### Test Strategy

- `test_heatmap.py`:
  - Empty `regions` list → returned string starts with `"data:image/png;base64,"` and decodes to a valid PNG.
  - Single region with `confidence=1.0` → overlay contains red pixels at the region bounding box (decode base64, open with PIL, sample pixel).
  - Single region with `confidence=0.0` → overlay contains green pixels.
  - Region with `bounding_box` outside image dimensions → function does not raise; returns valid data URI.
  - `_confidence_to_rgba(0.0, 0.5)` → `(0, 255, 0, 127)`.
  - `_confidence_to_rgba(0.5, 0.5)` → `(255, 255, 0, 127)`.
  - `_confidence_to_rgba(1.0, 0.5)` → `(255, 0, 0, 127)`.
  - Monkeypatch `PILImage.alpha_composite` to raise `RuntimeError` → function returns a valid data URI (the fallback original).

---

### 6. EXIF Extractor

#### Module and File Structure

```
backend/app/exif.py   # single module
```

#### Function Signature

```python
import io
import logging
from typing import Any

logger = logging.getLogger(__name__)

def extract(raw_bytes: bytes) -> dict[str, Any]:
    """
    Extracts EXIF metadata from raw image bytes.

    Args:
        raw_bytes: Full image bytes (read-only).

    Returns:
        dict[str, Any]: Flat mapping of EXIF tag name (str) to decoded value.
        Returns {} if:
            - The image has no EXIF block.
            - The EXIF block is present but corrupt.
            - Any exception occurs during parsing.

    Raises:
        Never raises. All exceptions are caught internally.

    Timeout: Not applicable (synchronous; no I/O beyond in-memory bytes).

    Privacy invariant: No EXIF tag values are written to any log.
        Log entries on failure are limited to: "EXIF extraction failed: <ExceptionType>"
    """
    ...

def _try_exifread(raw_bytes: bytes) -> dict[str, Any] | None:
    """
    Attempts EXIF extraction using `exifread` library (primary).
    Returns dict on success, None if exifread is unavailable or raises.
    """
    ...

def _try_piexif(raw_bytes: bytes) -> dict[str, Any] | None:
    """
    Attempts EXIF extraction using `piexif` library (fallback).
    Returns dict on success, None if piexif is unavailable or raises.
    Converts piexif's nested IFD structure to a flat dict.
    """
    ...

def _sanitise_value(value: Any) -> Any:
    """
    Converts exifread/piexif native types to JSON-serialisable Python types:
      - exifread.classes.IfdTag → str(tag.values) or tag.printable
      - bytes → decoded UTF-8 string with 'replace' error handler
      - tuple of 2 ints (rational) → float(num) / float(den) if den != 0 else None
      - All other types: pass through if JSON-serialisable, else str().
    """
    ...
```

#### Fallback Chain

```
extract(raw_bytes)
  → _try_exifread(raw_bytes)
      → success: sanitise all values → return dict
      → None: proceed to fallback
  → _try_piexif(raw_bytes)
      → success: flatten IFD dict, sanitise → return dict
      → None: proceed to fallback
  → log WARNING "EXIF extraction failed: <ExceptionType>"
  → return {}
```

The fallback chain ensures that if `exifread` is not installed (e.g. minimal Docker build), `piexif` is tried before returning empty. If both succeed for the same file, `exifread` result wins (higher fidelity tag decoding).

#### EXIF Tag Name Normalisation

`exifread` returns tag names prefixed with IFD group names (e.g. `"Image Make"`, `"EXIF DateTimeOriginal"`). The sanitiser strips the prefix and returns only the tag name portion (e.g. `"Make"`, `"DateTimeOriginal"`). If two tags from different IFDs produce the same short name, the first encountered wins (no overwrite).

#### Internal Data Flow

```
extract(raw_bytes)
  → outer try/except Exception:
      → _try_exifread(raw_bytes) → dict | None
          → if dict: return sanitised dict
      → _try_piexif(raw_bytes) → dict | None
          → if dict: return sanitised dict
      → return {}
  → except Exception as exc:
      → logger.warning("EXIF extraction failed: %s", type(exc).__name__)
        # Note: exc, exc.args, and any EXIF values are NOT logged.
      → return {}
```

#### Error Handling

The top-level `try/except Exception` in `extract()` is intentionally broad. EXIF parsing libraries can raise platform-specific C-extension errors that are not predictable. The contract is: `extract()` always returns a `dict`; it never raises; it never logs EXIF values.

#### Privacy Constraint

Log messages must not contain `exc.args`, `str(exc)`, or any formatted value from an EXIF tag. Only `type(exc).__name__` is permitted in log output. This is enforced by code review; unit tests also assert that the mock logger's calls do not contain substrings matching any EXIF value from test fixtures.

#### Concurrency

Stateless pure function. Safe for concurrent calls. Each call creates its own `io.BytesIO` internally (within `exifread`/`piexif`); no shared mutable state.

#### Test Strategy

- `test_exif.py`:
  - Valid JPEG with known EXIF tags → returned dict contains at least `"Make"` and `"Model"` keys with string values.
  - Valid JPEG with no EXIF block (`no_exif.jpg` fixture) → returns `{}`.
  - Corrupt bytes (`corrupt.bin` fixture) → returns `{}` without raising.
  - Monkeypatch both `exifread` and `piexif` to raise `RuntimeError` → returns `{}`.
  - Assert that `logger.warning` is called at most once per `extract()` call on failure, and that the log message does not contain the string `"Exif"` followed by any actual tag value (mock the logger, inspect call args).
  - Assert that `piexif` fallback is attempted when `exifread` raises `ImportError`.

---

### 7. Response Assembler

#### Module and File Structure

```
backend/app/assembler.py   # single module; Pydantic models + assemble() function
```

#### Pydantic Models

```python
from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator
from typing_extensions import Annotated

class BoundingBoxResponse(BaseModel):
    x: int
    y: int
    width: int
    height: int

class RegionResponse(BaseModel):
    technique: Literal["ELA", "noise_analysis", "clone_detection"]
    bounding_box: BoundingBoxResponse
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]

class AnalysisResponse(BaseModel):
    """
    Canonical response model for POST /api/v1/analyse.
    FastAPI serialises this directly as JSON.
    All field constraints are enforced by Pydantic v2 at construction time.
    """
    score: Annotated[float, Field(ge=0.0, le=1.0)]
    verdict: Literal["authentic", "suspicious", "likely manipulated"]
    heatmap_url: Annotated[str, Field(min_length=1)]
    exif: dict[str, Any]
    regions: list[RegionResponse]

    @model_validator(mode="before")
    @classmethod
    def clamp_score(cls, data: dict[str, Any]) -> dict[str, Any]:
        """
        Defensive clamp: if score is outside [0.0, 1.0] due to a misconfigured
        aggregator, clamp it before Pydantic's ge/le validation fires.
        Logs a WARNING (score value only — not an EXIF value) if clamping occurs.
        """
        ...

    @model_validator(mode="before")
    @classmethod
    def normalise_verdict(cls, data: dict[str, Any]) -> dict[str, Any]:
        """
        If verdict is not one of the three legal values, replaces it with
        "suspicious" (conservative fallback) and logs a WARNING with the
        invalid verdict string.
        """
        ...
```

#### `assemble()` Function

```python
import logging
from app.analysis.types import PipelineResult
from app.assembler import AnalysisResponse, RegionResponse, BoundingBoxResponse
from typing import Any

logger = logging.getLogger(__name__)

def assemble(
    pipeline_result: PipelineResult,
    heatmap_url: str,
    exif: dict[str, Any],
) -> AnalysisResponse:
    """
    Constructs the AnalysisResponse Pydantic model from pipeline outputs.

    Args:
        pipeline_result: Score, verdict, and region list from ScoreAggregator.
        heatmap_url:     Data URI string from HeatmapRenderer.
        exif:            EXIF dict from EXIFExtractor (may be {}).

    Returns:
        AnalysisResponse on success.

    Raises:
        AssemblerError: wraps any Pydantic ValidationError that survives the
            defensive clamp/normalise validators. The router's generic_error_handler
            maps this to HTTP 500 without exposing the ValidationError detail.

    Timeout: Not applicable (synchronous; no I/O).
    """
    try:
        region_responses = [
            RegionResponse(
                technique=r.technique,
                bounding_box=BoundingBoxResponse(
                    x=r.bounding_box.x,
                    y=r.bounding_box.y,
                    width=r.bounding_box.width,
                    height=r.bounding_box.height,
                ),
                confidence=r.confidence,
            )
            for r in pipeline_result.regions
        ]
        return AnalysisResponse(
            score=pipeline_result.score,
            verdict=pipeline_result.verdict,
            heatmap_url=heatmap_url,
            exif=exif,
            regions=region_responses,
        )
    except Exception as exc:
        logger.error("Response assembly failed: %s", type(exc).__name__, exc_info=True)
        raise AssemblerError("Failed to assemble response") from exc

class AssemblerError(Exception):
    """Raised when AnalysisResponse construction fails after defensive validators."""
    pass
```

#### Internal Data Flow

```
assemble(pipeline_result, heatmap_url, exif)
  → build list[RegionResponse] from pipeline_result.regions
  → AnalysisResponse(score, verdict, heatmap_url, exif, regions) constructed
      → model_validator clamp_score fires: score clamped to [0.0, 1.0] if needed
      → model_validator normalise_verdict fires: verdict corrected if needed
      → Pydantic field validation (ge/le, min_length, Literal) runs
          → ValidationError (unexpected): logged at ERROR, re-raised as AssemblerError
  → AnalysisResponse returned to router.analyse()
  → FastAPI calls model.model_dump() and serialises as JSON
```

#### Error Handling

- Pydantic `ValidationError` after the defensive validators: wrapped in `AssemblerError`, logged at ERROR server-side (with `exc_info=True` for traceback in logs), propagated to `generic_error_handler` → HTTP 500, `title = "Internal Server Error"`.
- No Pydantic `ValidationError` messages appear in the HTTP response body.
- The `clamp_score` and `normalise_verdict` validators log at WARNING (not ERROR) because they represent misconfiguration rather than a bug in the assembler itself.

#### Concurrency

`assemble()` constructs new Pydantic model instances per call. No shared mutable state. Safe for concurrent calls.

#### Test Strategy

- `test_assembler.py`:
  - Valid `PipelineResult` with `score=0.5`, `verdict="suspicious"`, two regions, plus a non-empty `heatmap_url` and non-empty `exif` → returns `AnalysisResponse` with all fields matching.
  - `pipeline_result.score = 1.0001` → `clamp_score` validator clamps to `1.0`; `logger.warning` called once; returned `score == 1.0`.
  - `pipeline_result.verdict = "unknown"` → `normalise_verdict` validator replaces with `"suspicious"`; `logger.warning` called once.
  - `heatmap_url = ""` (empty string) → `AssemblerError` raised (Pydantic `min_length=1` fires after validators).
  - Valid input but `RegionResponse` constructor monkeypatched to raise `TypeError` → `AssemblerError` raised; logger called with `ERROR` level.
  - Serialise returned `AnalysisResponse` via `model.model_dump_json()` → valid JSON parseable as Python dict with all expected keys.

---

## Cross-Cutting Concerns

### Observability Strategy

- **Log format**: structured JSON lines (configurable via `LOG_LEVEL` env var). Log entries include the exception type on error paths; no image data or EXIF values are logged (NFR-004).
- **Log levels by event type**:
  - `DEBUG`: internal pipeline steps (disabled in production).
  - `INFO`: request start/end with method, path, status, latency (no image content).
  - `WARNING`: EXIF parse failure, heatmap compositing fallback, score clamping, verdict normalisation.
  - `ERROR`: unhandled exceptions, assembly failures (full traceback, server-side only).
- **What is never logged**: raw image bytes, EXIF tag values, file content, region coordinates.
- **Frontend**: no analytics or telemetry. Console errors in development only.

### Security Implementation Patterns

- **Upload validation depth**: MIME check via libmagic → Pillow decode → no execution of content. Three independent validation layers.
- **No disk writes**: enforced architecturally — no `open(..., 'w')` calls exist in the image processing path. The `io.BytesIO` pattern is used exclusively for in-memory buffers.
- **CORS**: `CORSMiddleware` restricts to `CORS_ORIGINS`; `allow_credentials=False` (no cookies).
- **Content-Type for errors**: all error responses use `application/problem+json`; FastAPI's default `application/json` is overridden in the exception handlers.
- **No secrets in source**: all configuration via environment variables through `Settings` (Pydantic `BaseSettings`).

### Performance Patterns

- **Concurrent analysis**: three analysers run in parallel via `ThreadPoolExecutor`; the total pipeline time is bounded by the slowest single analyser, not the sum of all three.
- **Single read of upload bytes**: `UploadFile.read()` is called once in the router; `raw_bytes` is passed by reference to all downstream components. No re-reading.
- **Image copies scoped to analysis**: `Image.copy()` is called once per analyser immediately before dispatch; copies are not retained after the analyser completes.
- **Target latency**: < 10 s for images up to 10 MB (per NFR). The 9 s `ANALYSIS_TIMEOUT_SECONDS` budget enforces this; the remaining 1 s is reserved for heatmap rendering, EXIF extraction, and serialisation.

### Technical Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `python-magic` unavailable (libmagic not installed in Docker) | Medium | High | `filetype` pure-Python fallback; Dockerfile installs `libmagic1` explicitly |
| Clone detector slow on large images (ORB descriptor computation O(n) keypoints) | Medium | Medium | Image downsampled to max 1024px on longest edge before ORB analysis; original image used for all other analysers |
| PIL `Image.copy()` OOM for very large images | Low | High | Secondary size check in `ingest()` (10 MB cap) prevents pathologically large images reaching the engine |
| Corrupt EXIF block causing parse exception leaking sensitive data | Low | High | Catch-all in `extract()`; only `type(exc).__name__` in logs; tested by fixture |
| ELA false positives on heavily compressed source images | Medium | Medium | Configurable `ELA_QUALITY` and per-region `confidence` allows downstream tuning without code changes |
| Thread pool saturation under high concurrency | Low (MVP) | Medium | `ThreadPoolExecutor(max_workers=3)` is sufficient for development; documented as a scale-out concern (Uvicorn workers) |
