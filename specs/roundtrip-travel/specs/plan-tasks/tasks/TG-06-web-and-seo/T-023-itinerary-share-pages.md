# T-023: Public itinerary share pages with OG

## Metadata
- **Group:** [TG-06 — Web App & SEO](index.md)
- **Component:** apps/web/app/itinerary/[shareSlug]
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** T-019
- **Blocks:** —
- **Requirements:** FR-009, FR-011

## Description
Build public itinerary share pages at `/itinerary/[shareSlug]`. Includes Open Graph meta tags (title, description, og:image) for social sharing. Page is publicly accessible without auth.

## Acceptance criteria

```gherkin
Feature: Itinerary share page

  Scenario: Shared itinerary loads without auth
    Given a saved public itinerary with shareSlug "abc123"
    When an unauthenticated user visits /itinerary/abc123
    Then all stops and the route are displayed

  Scenario: OG tags are present for social sharing
    Given a public itinerary page
    When the page HTML is fetched
    Then og:title, og:description, og:image, and og:url are present
    And og:title includes the origin and destination
```

## Implementation notes
- `isPublic: false` itineraries return 404 for unauthenticated users.
- OG image: use a static map image (Google Maps Static API) or Vercel OG image generation.
- FR-011: This is the primary social sharing mechanism. Reachable from the "Share" button.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] OG tags validated with Open Graph debugger
