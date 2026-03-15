# T-023: Saved searches and search history

## Metadata
- **Group:** [TG-04 — Search & Discovery](index.md)
- **Component:** api ECS service — user search endpoints
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** [T-020](T-020-web-api-middleware-stack.md)
- **Blocks:** —
- **Requirements:** [FR-002](../../../../define-requirements.md#fr-002-search-and-discovery), [FR-007](../../../../define-requirements.md#fr-007-user-accounts)

## Description
Implement saved search CRUD endpoints (`GET`, `POST`, `PATCH`, `DELETE /api/users/me/saved-searches`) and search history (`GET`, `POST /api/users/me/search-history`) per L2 §§2.6, 9.1. Max `SAVED_SEARCHES_PER_USER` (20) per user. Search history records the last N searches in reverse chronological order. Anonymous users have no history persisted.

## Acceptance criteria

```gherkin
Feature: Saved searches and search history

  Scenario: User saves a search and it persists
    Given a logged-in user filters by agency: "ATO" and classification: "EL1"
    When POST /api/users/me/saved-searches is called with { name: "ATO EL1 roles", criteria: { agencies: ["ATO"], classifications: ["EL1"] } }
    Then HTTP 201 must be returned
    And a saved_searches document must exist with the correct criteria for that user

  Scenario: Saved search limit is enforced
    Given a user already has SAVED_SEARCHES_PER_USER (20) saved searches
    When POST /api/users/me/saved-searches is called for a 21st search
    Then HTTP 409 must be returned

  Scenario: Search history is recorded per logged-in user
    Given a logged-in user has executed 3 searches
    When GET /api/users/me/search-history is called
    Then all 3 searches must be returned in reverse chronological order
    And each entry must include the query string and applied filters

  Scenario: Anonymous user search is not persisted
    Given an unauthenticated visitor performs a search
    When the search completes
    Then no search history document must be created in the database
```

## Implementation notes
- Search history: stored in a `search_history` collection (or as an embedded array in `users` capped at N=50).
- `SAVED_SEARCHES_PER_USER` limit enforced at API layer (not DB-unique).
- `DELETE /api/users/me/saved-searches/:id` hard-deletes the document.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Per-user limit enforced and tested
- [ ] Anonymous user non-persistence verified
