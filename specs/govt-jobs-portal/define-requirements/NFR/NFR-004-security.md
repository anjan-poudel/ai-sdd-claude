# NFR-004: Security and Privacy

## Metadata
- **Category:** Security / Privacy
- **Priority:** MUST

## Description

The system must meet the following security and privacy requirements:

- **Authentication:** All authenticated endpoints must validate JWT tokens on every request. Tokens must have a maximum access token lifetime of 15 minutes; refresh tokens must expire after 30 days.
- **Password storage:** User passwords must be hashed using bcrypt (minimum cost factor 12) or argon2id. Plain-text passwords must never be stored or logged.
- **PII minimisation:** Only the following PII fields may be stored per user account: email address, display name (optional), OAuth provider identifiers, and notification preferences. No government ID, phone number, or address must be collected or stored.
- **Admin access:** Admin-role endpoints must enforce role-based access control at the API layer. Role elevation must not be achievable via user-controlled inputs.
- **Transport security:** All traffic between clients and the portal must use TLS 1.2 or higher. HTTP must redirect to HTTPS.
- **Scraping identity:** The scraper must not misrepresent its identity (User-Agent must identify the bot, e.g. `GovJobsBot/1.0`).
- **Secret management:** API keys, database credentials, and OAuth secrets must be stored in AWS Secrets Manager or environment variables injected at runtime. They must not be committed to source control or logged.
- **Dependency security:** Third-party dependencies must be scanned for known vulnerabilities on every CI build.

## Acceptance criteria

```gherkin
Feature: Security and Privacy

  Scenario: Expired JWT is rejected
    Given a user holds a JWT access token that expired 1 minute ago
    When the user makes a request to an authenticated API endpoint using the expired token
    Then the server must return HTTP 401 Unauthorized
    And the response must not include any user data

  Scenario: Password is not stored in plain text
    Given a user registers with password "hunter2"
    When the user record is written to MongoDB
    Then the stored credential field must be a bcrypt or argon2id hash
    And the string "hunter2" must not appear anywhere in the stored document or application logs

  Scenario: Role escalation via API input is blocked
    Given a regular user attempts to set their role to "admin" via an API request body
    When the request is processed
    Then the server must ignore the role field from user-supplied input
    And the user's role must remain "user"
    And the server must return HTTP 403 if the user attempts to access an admin endpoint

  Scenario: HTTP redirects to HTTPS
    Given the portal is deployed with TLS configured
    When a client sends an HTTP (non-TLS) request to any portal URL
    Then the server must respond with HTTP 301 redirecting to the HTTPS equivalent URL

  Scenario: PII fields beyond the permitted set are rejected
    Given a user registration request includes a "phone_number" field
    When the request is processed
    Then the phone number must not be stored in any database or log
    And the response must not acknowledge the presence of the field

  Scenario: Secrets are not present in application logs
    Given the application is running with AWS Secrets Manager integration
    When the application logs are inspected across a full scrape cycle
    Then no database connection strings, API keys, or OAuth secrets must appear in plain text in the logs

  Scenario: CI build fails on known high-severity dependency vulnerability
    Given a new dependency with a known high-severity CVE is added to package.json
    When the CI pipeline runs its dependency vulnerability scan
    Then the build must fail with an actionable error message identifying the vulnerable package
```

## Related
- FR: FR-007 (user accounts), FR-008 (admin CMS access control)
- NFR: NFR-005 (Privacy Act compliance)
