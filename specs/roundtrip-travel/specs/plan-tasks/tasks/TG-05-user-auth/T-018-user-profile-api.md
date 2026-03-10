# T-018: User profile and preferences API

## Metadata
- **Group:** [TG-05 — User & Auth](index.md)
- **Component:** backend/src/main/kotlin/com/roadtrip/user (Spring Boot REST controller + service)
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** T-017
- **Blocks:** T-013 (save preferences from builder)
- **Requirements:** FR-003

## Description
Implement `GET /api/user/profile` and `PATCH /api/user/preferences` endpoints and the `UserService` class methods for reading/updating user profile and party preferences.

## Acceptance criteria

```gherkin
Feature: User profile API

  Scenario: Authenticated user retrieves profile
    Given a user is authenticated
    When GET /api/user/profile is called
    Then the user's email, name, and preferences are returned

  Scenario: User updates party preferences
    Given a user is authenticated
    When PATCH /api/user/preferences with {partyType: "family", childrenAges: [3, 6]}
    Then the preferences are saved
    And the next GET /api/user/profile returns the updated preferences
```

## Implementation notes
- Auth guard: Spring Security JWT filter — `@PreAuthorize("isAuthenticated()")` on controller methods.
- UserPreferences upsert — idempotent on repeated calls.
- Do NOT return `authProviderId` or auth tokens in profile response.
- NFR-005: profile response must only include: id, name, email, preferences.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Auth guard tested: 401 returned for unauthenticated requests
