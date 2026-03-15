# T-011: User profile management, RBAC middleware, and admin role elevation

## Metadata
- **Group:** [TG-02 — Auth & User Accounts](index.md)
- **Component:** Web API — user profile routes + RBAC middleware
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-009](T-009-login-jwt-and-refresh-tokens.md)
- **Blocks:** T-020, T-021, T-022, T-023, T-024, T-028, T-029, T-030
- **Requirements:** [FR-007](../../../../define-requirements.md#fr-007-user-accounts), [FR-008](../../../../define-requirements.md#fr-008-admin-cms-and-operations), [NFR-004](../../../../define-requirements.md#nfr-004-security-and-privacy)

## Description
Implement `GET /api/users/me`, `PATCH /api/users/me`, `GET /api/users/me/saved-jobs`, `POST /api/users/me/saved-jobs`, `DELETE /api/users/me/saved-jobs/:id`, notification preferences endpoints, and `POST /api/admin/users/:id/elevate`. Implement the RBAC middleware that blocks admin routes for non-admin users and redirects unauthenticated visitors to login for protected routes.

## Acceptance criteria

```gherkin
Feature: User profile and RBAC

  Scenario: Role escalation via API input is blocked
    Given a regular user makes PATCH /api/users/me with body { "role": "admin" }
    When the request is processed
    Then HTTP 200 must be returned (partial update accepted)
    And the user's role in MongoDB must remain "user"

  Scenario: Admin-only endpoint returns 403 for regular user
    Given a logged-in user with role "user"
    When a GET request is made to /api/admin/scraper-sources
    Then HTTP 403 must be returned with code FORBIDDEN
    And no admin data must be returned

  Scenario: Admin-only endpoint redirects unauthenticated visitor
    Given an unauthenticated visitor accesses /api/admin/scraper-sources
    When the request is received
    Then HTTP 401 must be returned
    And no admin data must be exposed

  Scenario: User saves a job
    Given a logged-in user and an existing job document
    When POST /api/users/me/saved-jobs is called with { jobId }
    Then HTTP 201 must be returned
    And a saved_jobs document must be created for that user and job
    And a duplicate save attempt must return HTTP 409

  Scenario: User updates notification preferences
    Given a logged-in user
    When PATCH /api/users/me with { notificationPreferences: { emailEnabled: false, pushEnabled: true } }
    Then HTTP 200 must be returned
    And the updated preferences must be reflected in the database
```

## Implementation notes
- RBAC middleware position in middleware stack: after JWT auth middleware (step 8 in L2 §1.4).
- Admin double-check DB query must time out after `AUTH_ADMIN_CHECK_TIMEOUT_MS` (2000ms); return 503 on timeout.
- `PATCH /api/users/me` must use a Zod schema that does NOT include the `role` field.
- `POST /api/admin/users/:id/elevate` requires: existing admin JWT + admin DB double-check + MongoDB `findOneAndUpdate` to set `role: "admin"`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Role escalation prevention verified by test asserting database value post-request
- [ ] RBAC middleware tested for admin, user, and unauthenticated cases
