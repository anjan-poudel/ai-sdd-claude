# T-024: Alert management API (CRUD)

## Metadata
- **Group:** [TG-05 — Notifications & Alerts](index.md)
- **Component:** api ECS service — alert routes
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-020](../TG-04-search-and-discovery/T-020-web-api-middleware-stack.md), [T-011](../TG-02-auth-and-user-accounts/T-011-user-profile-and-rbac.md)
- **Blocks:** T-025, T-026, T-027
- **Requirements:** [FR-003](../../../../define-requirements.md#fr-003-notifications-and-alerts), [FR-007](../../../../define-requirements.md#fr-007-user-accounts)

## Description
Implement alert CRUD endpoints per L2 §9.4: `GET /api/users/me/alerts`, `POST /api/users/me/alerts`, `PATCH /api/users/me/alerts/:id`, `DELETE /api/users/me/alerts/:id` (soft delete). Enforce `ALERTS_PER_USER` (10) limit. At least one criterion must be non-empty on create. Push channel requires a registered FCM token. Implement FCM token registration: `POST /api/users/me/fcm-tokens`.

## Acceptance criteria

```gherkin
Feature: Alert management API

  Scenario: User creates an alert with multiple criteria
    Given a logged-in user
    When POST /api/users/me/alerts is called with { name: "ACT Economists", criteria: { query: "economist", states: ["ACT"] }, channels: ["email"] }
    Then HTTP 201 must be returned
    And an alerts document must exist with status: "active" for that user

  Scenario: Alert per-user limit is enforced
    Given a user has ALERTS_PER_USER (10) active or paused alerts
    When POST /api/users/me/alerts is called for the 11th alert
    Then HTTP 409 must be returned

  Scenario: User pauses an alert
    Given an active alert with id "xyz"
    When PATCH /api/users/me/alerts/xyz is called with { status: "paused" }
    Then HTTP 200 must be returned
    And the alert's status in MongoDB must be "paused"

  Scenario: Soft-deleted alert is excluded from listing
    Given an alert with id "abc" exists for a user
    When DELETE /api/users/me/alerts/abc is called
    Then HTTP 200 must be returned
    And the alert's status must be "deleted" in MongoDB
    And the alert must not appear in GET /api/users/me/alerts results

  Scenario: Alert with empty criteria is rejected
    Given a create request with criteria: {} (all fields absent or empty)
    When POST /api/users/me/alerts is called
    Then HTTP 422 must be returned
```

## Implementation notes
- FCM token registration: `POST /api/users/me/fcm-tokens` with `{ token, deviceId }`. Upsert: if token+deviceId already exists, update `registeredAt`; otherwise push to `fcmTokens` array up to `MAX_FCM_TOKENS_PER_USER` (10).
- Alert CRUD must only operate on alerts belonging to the authenticated user (validate `userId` on every operation).
- Soft delete sets `status: "deleted"` — alert data is retained for audit.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Per-user alert limit tested
- [ ] FCM token registration and cap (10) tested
