# T-020: Account deletion (Privacy Act compliance)

## Metadata
- **Group:** [TG-05 — User & Auth](index.md)
- **Component:** apps/web/app/api/user, services/user
- **Agent:** dev
- **Effort:** S
- **Risk:** HIGH
- **Depends on:** T-017
- **Blocks:** —
- **Requirements:** NFR-005

## Description
Implement `DELETE /api/user` (authenticated) that anonymises affiliate clicks, deletes user data (cascade), and revokes the session. Australian Privacy Act 1988 right to erasure.

## Acceptance criteria

```gherkin
Feature: Account deletion

  Scenario: User deletes account and data is removed
    Given a user has a saved itinerary and affiliate clicks
    When DELETE /api/user is called with valid session
    Then the User, UserPreferences, and SavedItinerary records are deleted
    And any AffiliateClick rows with the userId are updated to userId = null
    And the session cookie is cleared

  Scenario: Deletion is transactional
    Given a user requests deletion
    When a database error occurs mid-deletion
    Then all deletions are rolled back (no partial state)
    And the user record still exists
```

## Implementation notes
- Use Prisma `$transaction([...])` for atomicity.
- `AffiliateClick` rows: UPDATE `userId = null` (not DELETE — audit requirement NFR-007 preserves the click record).
- After deletion: invalidate NextAuth session (`signOut`).
- Log deletion event (without PII) for audit: `{ event: "user_deleted", userId_hash: sha256(userId) }`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Integration test: verify AffiliateClick rows are anonymised, not deleted
- [ ] Transaction test: verify rollback on mid-deletion error
