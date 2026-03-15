# T-029: Agency reviews (internal + Glassdoor fallback, moderation)

## Metadata
- **Group:** [TG-06 — Content, Reviews & Admin CMS](index.md)
- **Component:** api ECS service — reviews routes
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-020](../TG-04-search-and-discovery/T-020-web-api-middleware-stack.md), [T-011](../TG-02-auth-and-user-accounts/T-011-user-profile-and-rbac.md)
- **Blocks:** T-031
- **Requirements:** [FR-005](../../../../define-requirements.md#fr-005-agency-reviews-and-ratings), [NFR-005](../../../../define-requirements.md#nfr-005-compliance)

## Description
Implement agency profile endpoints: `GET /api/agencies/:name/reviews` (returns aggregated rating + approved reviews), `POST /api/agencies/:name/reviews` (authenticated users, status: "pending"), and admin moderation endpoints `GET /api/admin/reviews/pending`, `POST /api/admin/reviews/:id/approve`, `POST /api/admin/reviews/:id/reject`. Implement Glassdoor data fallback: if Glassdoor data is available and robots.txt permits, surface it; otherwise surface internal reviews with "Community Reviews" label.

## Acceptance criteria

```gherkin
Feature: Agency reviews

  Scenario: User submits an internal review pending moderation
    Given a logged-in user navigates to the Department of Defence agency profile
    When POST /api/agencies/department-of-defence/reviews is called with { rating: 4, body: "Great workplace culture." }
    Then HTTP 201 must be returned
    And the review must be stored with status: "pending"
    And the review must not appear in public GET /api/agencies/.../reviews

  Scenario: Admin approves a review and it appears publicly
    Given a review is in "pending" status
    When POST /api/admin/reviews/:id/approve is called by an admin
    Then HTTP 200 must be returned
    And the review must now appear in public GET /api/agencies/.../reviews
    And the agency's aggregate rating must be recalculated

  Scenario: Unauthenticated visitor cannot submit a review
    Given an unauthenticated visitor makes POST /api/agencies/.../reviews
    When the request is processed
    Then HTTP 401 must be returned
    And no review document must be created

  Scenario: Admin rejects a review without notifying the submitter
    Given a review contains inappropriate content
    When POST /api/admin/reviews/:id/reject is called
    Then the review status must be set to "rejected"
    And the review must not appear publicly
    And no notification email must be sent to the submitter (no PII leakage)

  Scenario: Glassdoor fallback displays when Glassdoor data is unavailable
    Given no Glassdoor data is available for "Geoscience Australia"
    When GET /api/agencies/geoscience-australia/reviews is called
    Then the response must use internal reviews data
    And the source field must indicate "Community Reviews"
```

## Implementation notes
- One pending or approved review per `(userId, agencyName)` pair: enforce at API layer via `count({ userId, agencyName, status: { $in: ["pending", "approved"] } }) > 0` check.
- Glassdoor scraper is in the scraper plugin system; the Glassdoor `glassdoor-reviews-scrape` plugin stores results in a separate collection. The reviews API reads from that collection if data exists AND `source.robotsTxtDisallowed === false`.
- Rejection must not send any notification email.
- `moderationNote` is stored but never returned in public API responses.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] One-review-per-user-per-agency constraint tested
- [ ] Admin rejection verified to not trigger any notification
