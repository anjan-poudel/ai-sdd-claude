# T-019: Save and share itinerary

## Metadata
- **Group:** [TG-05 — User & Auth](index.md)
- **Component:** apps/web, services/user
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** T-017, T-013
- **Blocks:** T-023 (public share pages)
- **Requirements:** FR-009, FR-011

## Description
Implement POST /api/itinerary/save (authenticated), GET /api/itinerary/[id] (public for shared), and the "Save" button in the itinerary builder UI that triggers auth flow if needed.

## Acceptance criteria

```gherkin
Feature: Save and share itinerary

  Scenario: Authenticated user saves itinerary
    Given a user is signed in and has generated an itinerary
    When they click "Save"
    Then the itinerary is saved with a unique shareSlug
    And a share link /itinerary/[shareSlug] is displayed

  Scenario: Public share link loads saved itinerary
    Given a saved itinerary with shareSlug "abc123" that is public
    When an unauthenticated user visits /itinerary/abc123
    Then the itinerary is displayed with all stops

  Scenario: Unauthenticated user is prompted to sign in before saving
    Given a user is not signed in and has generated an itinerary
    When they click "Save"
    Then the sign-in flow is triggered
    And after sign-in, the itinerary is saved automatically
```

## Implementation notes
- `shareSlug`: `nanoid(10)` — 10-char random ID (URL-safe).
- `isPublic: false` by default; user can toggle to share.
- OG tags on `/itinerary/[shareSlug]` page for FR-011 social sharing.
- FR-011 UGC (POI ratings/photos): deferred to Phase 2 — out of scope for this task.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] OG meta tags present on public itinerary pages
- [ ] Share link works when pasted into new browser session
