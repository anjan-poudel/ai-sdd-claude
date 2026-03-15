# T-010: OAuth2 sign-in (Google & LinkedIn)

## Metadata
- **Group:** [TG-02 — Auth & User Accounts](index.md)
- **Component:** Auth Service (within Web API)
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-009](T-009-login-jwt-and-refresh-tokens.md)
- **Blocks:** —
- **Requirements:** [FR-007](../../../../define-requirements.md#fr-007-user-accounts), [NFR-004](../../../../define-requirements.md#nfr-004-security-and-privacy)

## Description
Implement OAuth2 sign-in for Google and LinkedIn per L2 §7.3. Endpoints: `GET /api/auth/oauth/:provider` (redirects to provider with CSRF state nonce), `GET /api/auth/oauth/:provider/callback` (exchanges code, upserts user, issues JWT + refresh token). CSRF protection via Redis-stored one-time nonce. On successful OAuth callback, upsert user by `(provider, providerId)` and link the `oauthIdentities` entry.

## Acceptance criteria

```gherkin
Feature: OAuth2 sign-in

  Scenario: Google OAuth2 sign-in creates or retrieves user
    Given an unregistered visitor initiates Google sign-in
    And Google returns a valid code at the callback endpoint
    When the callback is processed
    Then a user document must be created (or retrieved if email already exists)
    And the user's oauthIdentities must include { provider: "google", providerId: <<google_id>> }
    And a JWT accessToken and refresh token must be issued

  Scenario: CSRF state nonce is single-use
    Given an OAuth flow has been initiated and a state nonce was stored in Redis
    When the callback endpoint is called with the correct state
    Then the nonce must be deleted from Redis
    And a second callback request with the same state must be rejected with HTTP 400

  Scenario: OAuth callback with invalid state is rejected
    Given a callback request arrives with state that does not match any stored nonce
    When the callback is processed
    Then HTTP 400 must be returned
    And no user must be created or logged in

  Scenario: LinkedIn OAuth2 requests only permitted scopes
    Given a LinkedIn OAuth2 redirect URL is generated
    When the URL parameters are inspected
    Then the scope parameter must only contain "r_emailaddress r_liteprofile"
    And no write or posting permissions must be requested
```

## Implementation notes
- CSRF nonce: `crypto.randomBytes(16).toString('hex')`. Redis key: `oauth:state:${nonce}` with TTL 600 seconds (10 minutes).
- Google scopes: `["openid", "email", "profile"]`. LinkedIn scopes: `["r_emailaddress", "r_liteprofile"]`.
- For new users created via OAuth: `emailVerified: true` (provider has verified the email), `passwordHash: null`.
- Use `passport.js` with `passport-google-oauth20` and `passport-linkedin-oauth2` strategies, or implement the OAuth exchange manually.
- Client credentials loaded from Secrets Manager via T-007 loader.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] CSRF nonce single-use behaviour tested
- [ ] OAuth flow tested using a mock OAuth provider (not real Google/LinkedIn in CI)
