# T-007: AWS Secrets Manager integration and CI security gate

## Metadata
- **Group:** [TG-01 — Infrastructure & Project Setup](index.md)
- **Component:** Security / secrets
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-001](T-001-project-scaffold-and-infra.md)
- **Blocks:** T-008, T-010, T-013, T-025
- **Requirements:** [NFR-004](../../../../define-requirements.md#nfr-004-security-and-privacy)

## Description
Implement the AWS Secrets Manager loader that retrieves all `[SECRET]` variables from L2 §10 at process startup. In production (`NODE_ENV=production`) secrets must not be read from process environment; they must be fetched from Secrets Manager. In development/test environments, secrets fall back to process environment variables. Add a CI gate that fails the build if any high-severity CVE is found in dependencies (NFR-004).

## Acceptance criteria

```gherkin
Feature: AWS Secrets Manager integration

  Scenario: Secrets are loaded from Secrets Manager in production
    Given NODE_ENV is set to "production"
    And JWT_PRIVATE_KEY is stored in AWS Secrets Manager at "govjobs/jwt-private-key"
    When the api service starts up
    Then the JWT private key must be retrieved from Secrets Manager
    And the value must not appear in any log entry or environment variable listing

  Scenario: Secrets fall back to environment variables in development
    Given NODE_ENV is set to "development"
    And JWT_PRIVATE_KEY is set as a process environment variable
    When the api service starts up
    Then the JWT private key must be read from the environment variable
    And no call to Secrets Manager must be made

  Scenario: CI build fails on high-severity CVE
    Given a dependency with a known high-severity CVE is added to package.json
    When the GitHub Actions CI pipeline runs the security scan step
    Then the pipeline must fail with an exit code indicating the vulnerability
    And the error output must name the vulnerable package and CVE identifier
```

## Implementation notes
- Use `@aws-sdk/client-secrets-manager` for Secrets Manager calls.
- Cache retrieved secrets in memory for the process lifetime (do not re-fetch per request).
- In test environments, use a mock Secrets Manager that returns values from `process.env`.
- The CI security scan should use `npm audit --audit-level=high` in the GitHub Actions workflow.
- Secret path naming convention: `govjobs/<secret-name>` (e.g. `govjobs/jwt-private-key`, `govjobs/mongodb-uri`).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Integration test uses a mock Secrets Manager (not real AWS) in CI
- [ ] CI vulnerability scan gate added to `.github/workflows/ci.yml`
