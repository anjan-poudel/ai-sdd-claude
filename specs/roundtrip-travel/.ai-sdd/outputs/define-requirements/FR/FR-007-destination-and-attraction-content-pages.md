# FR-007: Destination and Attraction Content Pages

## Metadata
- **Area:** Content Management
- **Priority:** MUST
- **Source:** Constitution — "A geographic place (city, region, national park) with curated content and SEO pages"; requirements.md — "provide lots of free content and highly tailored local content and attractions"

## Description
The system must provide rich, SEO-optimised content pages for Destinations and Attractions. Each page must display curated content beyond a simple product listing, including contextual information, highlights, opening hours, accessibility features, and relevant demographic tags. Pages must be suitable for organic search indexing.

## Acceptance criteria

```gherkin
Feature: Destination and Attraction Content Pages

  Scenario: User views a destination page
    Given a user navigates to a destination page (e.g. a national park or regional town)
    When the page loads
    Then the page must display curated content about the destination
    And must list nearby attractions and products
    And the page must include meta title, description, and structured data for SEO indexing

  Scenario: User filters attractions on a destination page by family suitability
    Given a user is on a destination page and has selected the "travelling with children" filter
    When the attraction list is rendered
    Then only attractions tagged as family-friendly must be shown
    And attractions lacking family facilities must be hidden or deprioritised

  Scenario: Attraction page displays operational details
    Given a user navigates to an attraction page
    When the page loads
    Then the page must display opening hours, admission type (free/paid), category, and demographic tags
    And if a paid product is available, an affiliate booking link must be shown
```

## Related
- NFR: NFR-009 (SEO indexability), NFR-002 (Geospatial accuracy)
- Depends on: FR-005 (POI Indexing), FR-004 (Mixed Free and Paid Content)
