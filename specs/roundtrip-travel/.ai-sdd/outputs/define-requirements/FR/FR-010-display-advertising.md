# FR-010: Display Advertising

## Metadata
- **Area:** Content & Monetisation
- **Priority:** SHOULD
- **Source:** Requirements.md — "Revenue will initially come via affiliate links from OTAs like Viator and Ads for phase 1"

## Description
The system must support display advertising placements on content pages (destination pages, attraction pages, itinerary results). Advertising placements must be configurable and must not interfere with core user journeys (itinerary generation, attraction browsing).

## Acceptance criteria

```gherkin
Feature: Display Advertising

  Scenario: Advertising units are rendered on a destination page
    Given a user navigates to a destination page
    When the page loads
    Then one or more advertising units must be rendered in designated placement zones
    And the core content (attractions, itinerary links) must remain fully visible and accessible

  Scenario: Advertising placement does not block core itinerary functionality
    Given a user is using the itinerary builder
    When an advertising unit is present on the page
    Then the advertising unit must not obstruct or delay the itinerary generation form or results

  Scenario: Advertising system is configurable per page type
    Given a platform administrator updates ad placement configuration
    When a new configuration is applied
    Then the specified page types must reflect the updated ad placements without a code deployment
```

## Related
- NFR: NFR-010 (Page load performance)
- Depends on: FR-007 (Destination and Attraction Content Pages)
