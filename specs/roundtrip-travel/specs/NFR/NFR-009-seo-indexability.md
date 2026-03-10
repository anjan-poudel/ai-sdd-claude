# NFR-009: SEO Indexability

## Metadata
- **Category:** Accessibility
- **Priority:** MUST

## Description
All public destination, attraction, and itinerary content pages must be server-side rendered (SSR) or statically generated to ensure full HTML content is available to search engine crawlers without JavaScript execution. Each page must include a unique meta title, meta description, and JSON-LD structured data (Schema.org TouristAttraction or TouristDestination).

## Acceptance criteria

```gherkin
Feature: SEO Indexability

  Scenario: Destination page HTML is fully rendered server-side
    Given a search engine crawler requests a destination page
    When the crawler receives the HTTP response
    Then the full page content (heading, description, attraction list) must be present in the HTML response body
    And must not require JavaScript execution to be visible

  Scenario: Each page has unique meta title and description
    Given two different destination pages are rendered
    When their HTML head sections are inspected
    Then each page must have a distinct meta title and meta description
    And neither field must be empty or a generic default

  Scenario: Structured data is present on attraction pages
    Given an attraction page is rendered
    When a structured data validator inspects the page
    Then valid JSON-LD markup using Schema.org TouristAttraction must be present
    And the markup must include name, description, and geo coordinates
```

## Related
- FR: FR-007 (Destination and Attraction Content Pages)
