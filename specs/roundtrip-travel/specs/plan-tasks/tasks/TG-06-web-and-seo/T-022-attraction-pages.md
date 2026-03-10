# T-022: Attraction detail pages

## Metadata
- **Group:** [TG-06 — Web App & SEO](index.md)
- **Component:** apps/web/app/attraction/[slug]
- **Agent:** dev
- **Effort:** M
- **Risk:** LOW
- **Depends on:** T-021
- **Blocks:** —
- **Requirements:** FR-007, NFR-009

## Description
Build ISR attraction pages at `/attraction/[slug]` with schema.org TouristAttraction structured data, opening hours, demographic tags display, and affiliate product links.

## Acceptance criteria

```gherkin
Feature: Attraction pages

  Scenario: Attraction page renders correctly
    Given attraction "sydney-darling-harbour-playground" exists
    When GET /attraction/sydney-darling-harbour-playground is called
    Then the page shows name, coordinates, opening hours, and demographic tags
    And schema.org JSON-LD with @type TouristAttraction is in <head>

  Scenario: Free attraction shows no affiliate products
    Given an attraction with isFree = true and no products linked
    When the attraction page is rendered
    Then no affiliate product section is shown
```

## Implementation notes
- Same ISR pattern as destination pages (revalidate: 3600).
- Demographic tags rendered as badges: "Family-friendly", "Toilets", "Parking", "Accessible".
- Affiliate product section: only shown if products are linked to the attraction.
- Opening hours: render human-friendly (e.g. "Mon-Fri 8am-5pm").

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Structured data validated
