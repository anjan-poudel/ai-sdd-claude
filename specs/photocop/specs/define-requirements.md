# Requirements — PhotoCop

## Summary
- Functional requirements: 5
- Non-functional requirements: 5
- Areas covered: File Ingestion, Image Analysis, Visualisation, Metadata Analysis, API Response, Privacy, Reliability, Performance, Security

## Open decisions
- **Verdict threshold boundaries**: The constitution does not define exact numeric cutoffs for "authentic" vs "suspicious" vs "likely manipulated". Thresholds 0.0–0.3 / 0.3–0.7 / 0.7–1.0 used in FR-002 are provisional and must be confirmed before implementation.
- **Heatmap delivery mechanism**: "heatmap_url" in the unified JSON schema may be a data URI or a server-hosted URL. NFR-001 (no persistence) constrains this to a data URI or ephemeral in-memory URL; a final decision is required before design.
- **Stateless API — concurrent requests**: Rate limiting and concurrent request handling are not defined in the constitution. Deferred to post-MVP.
- **Benchmark dataset**: NFR-002 references a labelled benchmark of 200 images. Dataset source and curation criteria must be agreed before QA sign-off.

## Out of scope
- User authentication or accounts
- Persistent storage of images, reports, or analysis history
- Batch / bulk upload of multiple images in a single request
- Asynchronous job queuing or webhook callbacks
- Export formats other than JSON (PDF, CSV, etc.)
- Mobile native applications (iOS / Android)
- Rate limiting and abuse prevention (post-MVP)
- AI-generated image detection beyond ELA, noise analysis, and clone detection
- Image editing or redaction tools

---

# Functional Requirements

---

## FR-001: Image Upload

- **Area:** File Ingestion
- **Priority:** MUST
- **Source:** Constitution — Core Capabilities §1; Security Standards

### Description
The system must accept image file uploads via a browser interface. Accepted formats are JPEG, PNG, WebP, TIFF, and BMP. The system must enforce a maximum file size of 10 MB. Every uploaded file must be validated against its declared content type using a magic-byte check before processing begins. Files that fail validation must be rejected with an RFC 7807 Problem Details error response.

### Acceptance criteria

```gherkin
Feature: Image Upload

  Scenario: Successful upload of a valid JPEG image
    Given a user has a JPEG image of 3 MB
    When the user submits the file through the browser upload interface
    Then the server accepts the file
    And returns HTTP 200 with a JSON body containing a "score" field

  Scenario: Upload rejected when file exceeds size limit
    Given a user has a PNG image of 15 MB
    When the user submits the file through the browser upload interface
    Then the server returns HTTP 413
    And the response body is RFC 7807 Problem Details JSON with title "File Too Large"

  Scenario: Upload rejected when file format is not supported
    Given a user has a GIF image
    When the user submits the file through the browser upload interface
    Then the server returns HTTP 415
    And the response body is RFC 7807 Problem Details JSON with title "Unsupported Media Type"

  Scenario: Upload rejected when magic bytes do not match declared content type
    Given a user has a file with a .jpg extension but PDF magic bytes
    When the user submits the file through the browser upload interface
    Then the server returns HTTP 422
    And the response body is RFC 7807 Problem Details JSON with title "Invalid File Content"
```

### Related
- NFR: NFR-001 (In-Memory Processing), NFR-004 (Privacy), NFR-005 (Security)

---

## FR-002: Manipulation Detection

- **Area:** Image Analysis
- **Priority:** MUST
- **Source:** Constitution — Core Capabilities §2; Review Criteria

### Description
The system must analyse a validated uploaded image for forensic indicators of manipulation, including Error Level Analysis (ELA), noise inconsistencies, cloning artefacts, and splicing. The system must produce a manipulation probability score in the range [0.0, 1.0], where 0.0 indicates no detected manipulation and 1.0 indicates high confidence of manipulation. The system must also produce a human-readable verdict string (e.g. "authentic", "suspicious", "likely manipulated") derived from the score. The detection result must be explainable — each detected region must be annotated with the technique that flagged it.

### Acceptance criteria

```gherkin
Feature: Manipulation Detection

  Scenario: Authentic image receives low manipulation score
    Given a user uploads an unmodified original JPEG photograph
    When the analysis completes
    Then the response JSON contains a "score" between 0.0 and 0.3 inclusive
    And the "verdict" field equals "authentic"

  Scenario: Manipulated image receives high manipulation score
    Given a user uploads a JPEG image with a known cloned region
    When the analysis completes
    Then the response JSON contains a "score" greater than 0.7
    And the "verdict" field equals "likely manipulated"

  Scenario: Response always contains score and verdict fields
    Given a user uploads any supported image file
    When the analysis completes
    Then the response JSON contains a non-null "score" field of type number
    And the response JSON contains a non-null "verdict" field of type string

  Scenario: Corrupted image file returns a graceful error
    Given a user uploads a file with a valid JPEG magic byte but truncated binary content
    When the server attempts analysis
    Then the server returns HTTP 422
    And the response body is RFC 7807 Problem Details JSON with title "Image Processing Error"
```

### Related
- NFR: NFR-002 (Accuracy), NFR-003 (Performance)
- Depends on: FR-001 (Image Upload)

---

## FR-003: Heatmap Generation

- **Area:** Visualisation
- **Priority:** MUST
- **Source:** Constitution — Core Capabilities §3; Review Criteria

### Description
The system must generate a heatmap overlay image that visually highlights suspicious or manipulated regions detected during analysis. The heatmap must be superimposed on the original image using a colour scale that distinguishes high-confidence anomaly regions from low-confidence ones. The heatmap image must be returned as a URL or inline data URI in the JSON response under the key "heatmap_url". The frontend must display the heatmap inline without a full page reload.

### Acceptance criteria

```gherkin
Feature: Heatmap Generation

  Scenario: Heatmap is returned for every successfully analysed image
    Given a user uploads a supported image file
    When the analysis completes successfully
    Then the response JSON contains a non-null "heatmap_url" field
    And the value is either a data URI beginning with "data:image/" or an absolute URL

  Scenario: Heatmap highlights the manipulated region of a cloned image
    Given a user uploads a JPEG image with a known cloned region in the top-right quadrant
    When the analysis completes
    Then the response JSON "regions" array contains at least one entry
    And that entry's bounding box coordinates overlap the top-right quadrant of the image

  Scenario: Heatmap is displayed inline on the frontend without page reload
    Given a user has submitted an image and received a successful analysis response
    When the frontend renders the result
    Then the heatmap image appears within the current page view
    And the browser does not navigate to a new URL

  Scenario: Authentic image with no detected regions produces a blank heatmap
    Given a user uploads an unmodified original photograph
    When the analysis completes
    Then the "regions" array in the response is empty or absent
    And the "heatmap_url" field is still present and points to a valid image
```

### Related
- NFR: NFR-003 (Performance)
- Depends on: FR-001 (Image Upload), FR-002 (Manipulation Detection)

---

## FR-004: EXIF Extraction

- **Area:** Metadata Analysis
- **Priority:** MUST
- **Source:** Constitution — Core Capabilities §4; Review Criteria

### Description
The system must parse all available EXIF metadata from the uploaded image and return it as a structured JSON object under the key "exif" in the analysis response. If the image contains no EXIF data or the EXIF block is corrupt, the system must return an empty object `{}` for the "exif" field rather than an error. The extraction must handle partial or malformed EXIF blocks gracefully without aborting the overall analysis pipeline.

### Acceptance criteria

```gherkin
Feature: EXIF Extraction

  Scenario: EXIF data is returned for an image that contains metadata
    Given a user uploads a JPEG image with embedded EXIF data including GPS coordinates and camera model
    When the analysis completes
    Then the response JSON "exif" field is an object
    And it contains keys corresponding to the embedded EXIF tags (e.g. "GPSLatitude", "Make", "Model")

  Scenario: Missing EXIF data returns an empty object, not an error
    Given a user uploads a PNG image that contains no EXIF metadata
    When the analysis completes
    Then the response JSON "exif" field equals {}
    And the overall HTTP status is 200

  Scenario: Corrupt EXIF block is handled gracefully
    Given a user uploads a JPEG image with a deliberately malformed EXIF block
    When the analysis completes
    Then the response JSON "exif" field equals {}
    And the response still includes valid "score", "verdict", and "heatmap_url" fields

  Scenario: EXIF data is not persisted after the response is sent
    Given a user uploads an image containing sensitive EXIF GPS data
    When the server sends the analysis response
    Then no EXIF values appear in any server log entry for that request
```

### Related
- NFR: NFR-004 (Privacy)
- Depends on: FR-001 (Image Upload)

---

## FR-005: JSON Results Export

- **Area:** API Response
- **Priority:** MUST
- **Source:** Constitution — Core Capabilities §5; API Design Standards

### Description
The system must return a unified JSON results object upon successful analysis. The response must conform to the schema `{ score: number, verdict: string, heatmap_url: string, exif: object, regions: array }`. The API endpoint must be located at `POST /api/v1/analyse`. Error responses must use RFC 7807 Problem Details format. A health check endpoint must be available at `GET /health` that returns HTTP 200 when the service is operational.

### Acceptance criteria

```gherkin
Feature: JSON Results Export

  Scenario: Successful analysis returns the full unified JSON report
    Given a user uploads a valid JPEG image
    When the server completes analysis
    Then the HTTP response status is 200
    And the response Content-Type header is "application/json"
    And the response body contains all five fields: "score", "verdict", "heatmap_url", "exif", "regions"
    And "score" is a number between 0.0 and 1.0 inclusive
    And "verdict" is a non-empty string
    And "heatmap_url" is a non-empty string
    And "exif" is a JSON object
    And "regions" is a JSON array

  Scenario: Error response conforms to RFC 7807 Problem Details
    Given a user uploads a file that exceeds the 10 MB size limit
    When the server rejects the request
    Then the HTTP response status is 413
    And the response Content-Type header is "application/problem+json"
    And the response body contains "type", "title", and "status" fields

  Scenario: Health check endpoint returns 200
    Given the PhotoCop backend service is running
    When a client sends GET /health
    Then the HTTP response status is 200

  Scenario: Analysis endpoint is not reachable at an undocumented path
    Given the PhotoCop backend service is running
    When a client sends POST /analyse (without the /api/v1/ prefix)
    Then the HTTP response status is 404
```

### Related
- NFR: NFR-003 (Performance), NFR-005 (Security)
- Depends on: FR-002 (Manipulation Detection), FR-003 (Heatmap Generation), FR-004 (EXIF Extraction)

---

# Non-Functional Requirements

---

## NFR-001: In-Memory Processing

- **Category:** Privacy / Reliability
- **Priority:** MUST

### Description
The system must process all uploaded image data entirely in RAM. No image bytes, derived data (heatmaps, ELA outputs), or EXIF values may be written to disk, a database, object storage, or any external system at any point during or after the request lifecycle. All in-memory buffers holding image data must be released when the HTTP response has been sent.

### Acceptance criteria

```gherkin
Feature: In-Memory Processing

  Scenario: No file is written to disk during image analysis
    Given the server's filesystem write calls are monitored
    When a user uploads a 5 MB JPEG and analysis completes
    Then no new file appears under the server's working directory or /tmp that contains image data
    And the response is returned successfully with HTTP 200

  Scenario: Image buffer is not retained after response is sent
    Given a user uploads an image and the server returns the analysis response
    When a second request is made immediately after
    Then the server has no in-memory reference to the first request's image data
    And memory usage does not grow unboundedly across 100 sequential requests
```

### Related
- FR: FR-001 (Image Upload), FR-004 (EXIF Extraction)

---

## NFR-002: Accuracy

- **Category:** Reliability
- **Priority:** MUST

### Description
The manipulation detection pipeline must achieve a false-positive rate no greater than 15% and a false-negative rate no greater than 15% when evaluated against a labelled benchmark dataset of at least 200 images (100 authentic, 100 manipulated). Detection must use established forensic techniques: ELA, noise analysis, and clone detection. Every region flagged as suspicious must carry the name of the technique that identified it.

### Acceptance criteria

```gherkin
Feature: Detection Accuracy

  Scenario: False-positive rate does not exceed 15% on benchmark dataset
    Given a labelled set of 100 unmodified authentic images
    When each image is submitted individually to the analysis endpoint
    Then no more than 15 images receive a "verdict" of "suspicious" or "likely manipulated"

  Scenario: False-negative rate does not exceed 15% on benchmark dataset
    Given a labelled set of 100 images each containing a verified manipulation
    When each image is submitted individually to the analysis endpoint
    Then no more than 15 images receive a "verdict" of "authentic"

  Scenario: Every flagged region identifies the forensic technique that detected it
    Given a user uploads an image that triggers at least one suspicious region
    When the analysis completes
    Then each entry in the "regions" array contains a non-empty "technique" field
    And the value is one of "ELA", "noise_analysis", or "clone_detection"
```

### Related
- FR: FR-002 (Manipulation Detection), FR-003 (Heatmap Generation)

---

## NFR-003: Performance

- **Category:** Performance
- **Priority:** MUST

### Description
The system must return the complete analysis response within 10 seconds for any image up to 10 MB in size, measured from the moment the last byte of the upload is received to the moment the first byte of the HTTP response is sent. This target applies under single-user load on the reference hardware. A 1 MB image must complete within 5 seconds. The health check endpoint must respond within 200 ms.

### Acceptance criteria

```gherkin
Feature: Analysis Performance

  Scenario: Analysis of a 10 MB image completes within 10 seconds
    Given a JPEG image of exactly 10 MB
    When the image is submitted to POST /api/v1/analyse
    Then the server sends the HTTP response within 10 seconds of completing the upload
    And the response status is 200

  Scenario: Analysis of a 1 MB image completes within 5 seconds
    Given a JPEG image of 1 MB
    When the image is submitted to POST /api/v1/analyse
    Then the server sends the HTTP response within 5 seconds of completing the upload
    And the response status is 200

  Scenario: Health check responds within 200 ms
    Given the PhotoCop backend service is running
    When a client sends GET /health
    Then the server sends the HTTP 200 response within 200 milliseconds
```

### Related
- FR: FR-002 (Manipulation Detection), FR-003 (Heatmap Generation), FR-005 (JSON Results Export)

---

## NFR-004: Privacy

- **Category:** Privacy
- **Priority:** MUST

### Description
The system must not retain, log, or transmit any user-identifiable data after the HTTP response for a request is sent. This covers image pixel data, derived images, EXIF metadata values (including GPS coordinates and device identifiers), and any other request payload content. Server access logs may record HTTP method, path, status code, and response time only. No third-party analytics or tracking may be embedded in the frontend or backend.

### Acceptance criteria

```gherkin
Feature: Privacy

  Scenario: EXIF GPS data does not appear in server logs
    Given server-side logging is configured at INFO level
    When a user uploads a JPEG image containing GPS coordinates in its EXIF block
    And the server returns the analysis response
    Then no log line contains the GPS latitude or longitude values from that image

  Scenario: Image binary data does not appear in server logs
    Given server-side logging is configured at DEBUG level
    When a user uploads any supported image file
    Then no log line contains a base64-encoded or raw binary representation of the image data

  Scenario: Repeated requests do not cause data accumulation
    Given 50 sequential analysis requests each with unique images
    When all 50 requests have completed
    Then no image data from any prior request is accessible in the server process memory or filesystem
```

### Related
- FR: FR-001 (Image Upload), FR-004 (EXIF Extraction)
- NFR: NFR-001 (In-Memory Processing)

---

## NFR-005: Security

- **Category:** Security
- **Priority:** MUST

### Description
The system must treat all uploaded files as untrusted input. File validation must use magic-byte inspection in addition to declared content-type and file extension. The server must not execute uploaded content. File size must be capped at 10 MB at the HTTP boundary before the payload is read into memory. No secrets may appear in source code; all secrets must be supplied via environment variables. The API must not expose internal stack traces in error responses.

### Acceptance criteria

```gherkin
Feature: Security

  Scenario: File with executable magic bytes is rejected
    Given a file with ELF or PE executable magic bytes and a .jpg extension
    When it is submitted to POST /api/v1/analyse
    Then the server returns HTTP 422
    And no part of the uploaded content is executed or interpreted

  Scenario: Oversized upload is rejected at the HTTP boundary
    Given a request with a Content-Length header of 20 MB
    When the request reaches the server
    Then the server returns HTTP 413 before reading the full request body into memory
    And peak memory increase during the rejection is less than 1 MB

  Scenario: Internal stack trace is not exposed in error response
    Given the analysis pipeline raises an unhandled internal exception
    When the server returns the error response
    Then the response body contains an RFC 7807 Problem Details object
    And the response body does not contain a Python traceback or internal file path

  Scenario: No secrets present in source code
    Given the application source code is scanned for secret patterns (API keys, passwords, tokens)
    When the scan completes
    Then zero matches are found for patterns matching AWS keys, JWT secrets, or database passwords
```

### Related
- FR: FR-001 (Image Upload), FR-005 (JSON Results Export)
