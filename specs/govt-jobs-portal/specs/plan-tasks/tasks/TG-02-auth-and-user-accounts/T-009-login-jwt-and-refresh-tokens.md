# T-009: Email/password login, JWT issuance and refresh token rotation

## Metadata
- **Group:** [TG-02 — Auth & User Accounts](index.md)
- **Component:** Auth Service (within Web API)
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** [T-008](T-008-registration-and-email-verification.md)
- **Blocks:** T-010, T-011, T-018, T-020, T-021, T-022, T-023, T-024, T-028, T-029, T-030
- **Requirements:** [FR-007](../../../../define-requirements.md#fr-007-user-accounts), [NFR-004](../../../../define-requirements.md#nfr-004-security-and-privacy)

## Description
Implement `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, and `GET /api/auth/.well-known/jwks.json` per L2 §§7.2, 7.4, 7.5. JWT access tokens must use RS256 with 15-minute TTL. Refresh tokens are opaque 32-byte random hex strings; only their SHA-256 hash is stored. Implement refresh token rotation (new token on each refresh), single-use enforcement, and reuse detection (revoke-all on reuse). Login lockout: 5 failed attempts within 15 minutes locks account for 15 minutes via Redis.

## Acceptance criteria

```gherkin
Feature: Login, JWT, and refresh token rotation

  Scenario: Successful login returns JWT and sets refresh cookie
    Given a registered verified user with email "u@test.com" and password "correctpass1"
    When POST /api/auth/login is called with correct credentials
    Then HTTP 200 must be returned with accessToken (JWT RS256) and expiresIn: 900
    And a Set-Cookie header must include refreshToken with HttpOnly, Secure, SameSite=Strict, Path=/api/auth/refresh

  Scenario: Expired JWT is rejected on authenticated endpoint
    Given a user holds a JWT that expired 1 minute ago
    When a request to GET /api/users/me is made with the expired token
    Then HTTP 401 must be returned
    And no user data must be returned

  Scenario: Refresh token rotation issues new tokens
    Given a user has a valid refresh token in their cookie
    When POST /api/auth/refresh is called
    Then HTTP 200 must be returned with a new accessToken
    And a new Set-Cookie header must set a new refreshToken
    And the old refresh token must be marked usedAt in the database

  Scenario: Refresh token reuse triggers revocation of all tokens
    Given a refresh token has already been used (usedAt is set)
    When POST /api/auth/refresh is called again with the same token
    Then HTTP 401 must be returned with code REFRESH_TOKEN_REUSE_DETECTED
    And ALL refresh tokens for that user must have revokedAt set
    And a WARN-level security event must be logged (without PII)

  Scenario: Login lockout after 5 failed attempts
    Given a registered user
    When POST /api/auth/login is called 5 times with incorrect passwords within 15 minutes
    Then the 6th attempt must return HTTP 429 with code RATE_LIMITED
    And the lockout must expire after LOGIN_LOCKOUT_DURATION_MS

  Scenario: Admin double-check prevents stale token privilege escalation
    Given a user had role "admin" but was demoted to "user" in MongoDB after their JWT was issued
    When that user makes a request to an admin-only endpoint using their still-valid JWT
    Then the RBAC middleware must query MongoDB to confirm current role
    And the request must be rejected with HTTP 403
```

## Implementation notes
- JWT signing key: RS256 2048-bit RSA keypair loaded from Secrets Manager at `govjobs/jwt-private-key` and `govjobs/jwt-public-key`.
- Refresh token storage: only `sha256(rawToken)` in the `refresh_tokens` collection. Raw token in the cookie.
- Admin double-check: extract `userId` from verified JWT, query `users` collection, check `role === "admin"`. Timeout: `AUTH_ADMIN_CHECK_TIMEOUT_MS` (2000ms).
- Login lockout key: `login:lockout:${sha256(email)}` in Redis with TTL = `LOGIN_LOCKOUT_DURATION_MS` / 1000 seconds.
- Reuse detection: if `usedAt` is already set on the refresh token document, revoke all tokens for `userId`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] JWT RS256 signature verified by unit test using the public key
- [ ] Refresh token rotation tested end-to-end (issue → use → issue new → old invalidated)
- [ ] Reuse detection test verifies ALL tokens are revoked (not just the used one)
