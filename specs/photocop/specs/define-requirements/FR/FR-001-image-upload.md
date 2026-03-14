# FR-001: Image Upload

## Metadata
- **Area:** File Ingestion
- **Priority:** MUST
- **Source:** Constitution — Core Capabilities §1; Security Standards

## Description
The system must accept image file uploads via a browser interface. Accepted formats are JPEG, PNG, WebP, TIFF, and BMP. The system must enforce a maximum file size of 10 MB. Every uploaded file must be validated against its declared content type using a magic-byte check before processing begins. Files that fail validation must be rejected with an RFC 7807 Problem Details error response.

## Acceptance criteria

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

## Related
- NFR: NFR-001 (In-Memory Processing), NFR-004 (Privacy), NFR-005 (Security)
- Depends on: none
