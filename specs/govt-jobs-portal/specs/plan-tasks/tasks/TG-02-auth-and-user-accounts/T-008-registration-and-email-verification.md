# T-008: User registration and email verification

## Metadata
- **Group:** [TG-02 — Auth & User Accounts](index.md)
- **Component:** Auth Service (within Web API)
- **Agent:** dev
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** [T-002](../TG-01-infrastructure-and-project-setup/T-002-mongodb-schemas-and-indexes.md), [T-007](../TG-01-infrastructure-and-project-setup/T-007-aws-secrets-and-ci-security.md)
- **Blocks:** T-009, T-010, T-011
- **Requirements:** [FR-007](../../../../define-requirements.md#fr-007-user-accounts), [NFR-004](../../../../define-requirements.md#nfr-004-security-and-privacy)

## Description
Implement `POST /api/auth/register` and `GET /api/auth/verify-email?token=` endpoints per L2 §7.1. Password must be hashed with argon2id (cost ≥ 12). Email verification token must be a 32-byte cryptographically random hex string delivered in the email; the SHA-256 hash is stored in the database (never the raw token). Send verification email via AWS SES asynchronously (non-blocking). Implement resend-verification endpoint with rate limit of 3 per hour per email.

## Acceptance criteria

```gherkin
Feature: User registration and email verification

  Scenario: User registers and receives verification email
    Given an unregistered visitor provides email "user@test.com" and password "testpassword1"
    When POST /api/auth/register is called
    Then HTTP 201 must be returned with { userId }
    And a user document must be created with emailVerified: false
    And the password must be stored as an argon2id hash (not plain text)
    And an email must be sent via SES with a verification link

  Scenario: Plain text password is never stored or logged
    Given a user registers with password "hunter2secret"
    When the user document is written to MongoDB
    Then the string "hunter2secret" must not appear in any stored field
    And the string "hunter2secret" must not appear in any log entry

  Scenario: Email verification token is stored as SHA-256 hash
    Given registration has completed and a verification token was generated
    When the users collection is queried for the new user
    Then emailVerificationToken must be a 64-character hex string (SHA-256 of the raw token)
    And the raw 32-byte token must not appear in the database

  Scenario: Email verification succeeds with correct token
    Given a user has a pending verification with token "abc123..."
    When GET /api/auth/verify-email?token=abc123... is called
    Then HTTP 200 must be returned
    And the user document must have emailVerified: true
    And emailVerificationToken must be null

  Scenario: Expired verification token is rejected
    Given a verification token was issued more than 24 hours ago
    When GET /api/auth/verify-email?token=<<expired>> is called
    Then HTTP 400 must be returned
    And the user must remain unverified

  Scenario: Duplicate email registration is rejected
    Given a user with email "existing@test.com" is already registered
    When POST /api/auth/register is called with the same email
    Then HTTP 409 must be returned with error code EMAIL_ALREADY_REGISTERED
```

## Implementation notes
- Use `argon2` npm package with `argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 })` (cost ≥ 12 equivalent).
- Generate verification token: `crypto.randomBytes(32).toString('hex')`.
- Store hash: `crypto.createHash('sha256').update(rawToken).digest('hex')`.
- SES send must be fire-and-forget (do not `await` in the response path).
- Rate-limit resend verification: Redis key `resend:verify:${sha256(email)}` with 3-per-hour TTL.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] argon2id hash verified to not contain plain-text password
- [ ] SHA-256 token hashing verified by unit test comparing raw token vs stored hash
