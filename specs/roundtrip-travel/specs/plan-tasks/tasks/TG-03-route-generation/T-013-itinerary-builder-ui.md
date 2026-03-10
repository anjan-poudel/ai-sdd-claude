# T-013: Itinerary builder UI

## Metadata
- **Group:** [TG-03 — Route Generation](index.md)
- **Component:** apps/web/app/(planner)
- **Agent:** dev
- **Effort:** L
- **Risk:** MEDIUM
- **Depends on:** T-012
- **Blocks:** T-017, T-018
- **Requirements:** FR-001, FR-002, FR-004, FR-008

## Description
Build the interactive itinerary builder page: origin/destination input with autocomplete (Google Places), party selector, and the result display showing route segments + stopover cards with mixed free/paid content. Client-side React component.

## Acceptance criteria

```gherkin
Feature: Itinerary builder UI

  Scenario: User generates an itinerary
    Given the user enters Sydney as origin and Brisbane as destination
    And selects "Family" with 2 children
    When the user submits the form
    Then a loading state is shown
    And the itinerary with stopover cards is displayed
    And each card shows the POI name, distance, and free/paid label

  Scenario: Empty search clears results
    Given an itinerary is displayed
    When the user clears the destination field
    Then the itinerary results are cleared
    And the form is ready for a new search
```

## Implementation notes
- Google Places Autocomplete for origin/destination (restrict to Australia).
- StopoverCard component: shows POI photo (if available), name, distance, category tags, free/paid badge, and affiliate product links.
- Mobile-responsive layout (key for road-trip use case on phone).
- Loading skeleton while itinerary is being generated.
- No auth required to generate — save button triggers auth flow if not logged in.
- NFR-010: LCP must be <2s. Use Next.js Image component for POI photos.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Lighthouse Performance score ≥ 90 on mobile (measured against real device)
- [ ] Accessible: keyboard navigable, ARIA labels on form inputs
