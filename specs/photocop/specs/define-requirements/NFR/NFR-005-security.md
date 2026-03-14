# NFR-005: Security

## Metadata
- **Category:** Security
- **Priority:** MUST

## Description
The system must treat all uploaded files as untrusted input. File validation must use magic-byte inspection in addition to declared content-type and file extension. The server must not execute uploaded content under any circumstance. File size must be capped at 10 MB at the HTTP boundary before the payload is read into memory. No secrets, API keys, or credentials may appear in source code; all secrets must be supplied via environment variables. Dependencies must be pinned to specific versions. The API must not expose internal stack traces in error responses.

## Acceptance criteria

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

## Related
- FR: FR-001 (Image Upload), FR-005 (JSON Results Export)
