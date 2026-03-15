# T-032: Frontend authentication flows (register, login, OAuth, account management)

## Metadata
- **Group:** [TG-07 — Frontend & Monetisation](index.md)
- **Component:** Frontend SPA
- **Agent:** dev
- **Effort:** L
- **Risk:** MEDIUM
- **Depends on:** [T-031](T-031-frontend-scaffold-and-search.md), [T-009](../TG-02-auth-and-user-accounts/T-009-login-jwt-and-refresh-tokens.md), [T-010](../TG-02-auth-and-user-accounts/T-010-oauth2-google-linkedin.md)
- **Blocks:** —
- **Requirements:** [FR-007](../../../../define-requirements.md#fr-007-user-accounts), [NFR-004](../../../../define-requirements.md#nfr-004-security-and-privacy)

## Description
Implement all user-facing auth and account management UI: registration form (email + password), login form (email + password), "Sign in with Google/LinkedIn" buttons, email verification page, forgot password flow (if in scope), saved jobs list page, saved searches page, alert management page, notification preferences page, and account deletion flow. The access token must be stored in memory (not localStorage); the refresh cookie is HTTP-only.

## Acceptance criteria

```gherkin
Feature: Frontend authentication flows

  Scenario: User registers and is redirected to verify email page
    Given an unregistered visitor fills in the registration form
    When the form is submitted and HTTP 201 is returned
    Then the user must be redirected to a "Please verify your email" page
    And the page must explain that a verification link has been sent

  Scenario: JWT access token is stored in memory, not localStorage
    Given a user logs in successfully
    When the browser's localStorage and sessionStorage are inspected
    Then the JWT access token must not be present in either storage
    And the token must only exist in the application's in-memory state

  Scenario: User is redirected back after logging in
    Given an unauthenticated user tried to save a job at URL /jobs/123
    And was redirected to /login
    When the user successfully logs in
    Then the user must be redirected to /jobs/123

  Scenario: Token refresh happens transparently
    Given a logged-in user's access token has expired
    When the user makes any authenticated action (e.g. loading their alerts)
    Then the app must automatically call POST /api/auth/refresh
    And the user must not be prompted to log in again

  Scenario: Account deletion flow requires confirmation
    Given a logged-in user navigates to account settings
    When the user clicks "Delete account" and sees a confirmation dialog
    And confirms the deletion
    Then POST /api/users/me/delete must be called
    And the user must be logged out and see a "Deletion in progress" confirmation page
```

## Implementation notes
- Access token: store in React context / Zustand store in memory. Never in localStorage (XSS risk).
- Refresh cookie is set as HTTP-only by the API; the browser sends it automatically.
- Implement an Axios/fetch interceptor that retries failed requests with a 401 response by first calling `POST /api/auth/refresh`, then retrying the original request.
- Account deletion confirmation dialog must require the user to type their email address to confirm.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Access token in-memory storage verified (no localStorage writes)
- [ ] Post-login redirect tested end-to-end
- [ ] Token refresh interceptor tested by expiring the token in test
