# NFR-010: Page Load Performance

## Metadata
- **Category:** Performance
- **Priority:** MUST

## Description
All public-facing pages must achieve a Largest Contentful Paint (LCP) score of under 2.5 seconds and a Total Blocking Time (TBT) of under 300 milliseconds, as measured by Google Lighthouse on a simulated mid-tier mobile device with a 4G connection. Images must be served in WebP format with lazy loading for below-the-fold content.

## Acceptance criteria

```gherkin
Feature: Page Load Performance

  Scenario: Destination page meets Core Web Vitals thresholds
    Given a destination page is loaded on a simulated mid-tier mobile device with 4G connection
    When a Google Lighthouse audit is run
    Then the Largest Contentful Paint (LCP) must be under 2.5 seconds
    And the Total Blocking Time (TBT) must be under 300 milliseconds

  Scenario: Images are served in WebP format
    Given a page contains images
    When the page is loaded and network requests are inspected
    Then all images must be served in WebP format
    And images below the visible viewport must use the loading="lazy" attribute

  Scenario: Display advertising does not degrade Core Web Vitals
    Given a page with display advertising units is loaded
    When Lighthouse performance audit is run
    Then the LCP and TBT scores must still meet the thresholds defined above
```

## Related
- FR: FR-007 (Destination and Attraction Content Pages), FR-010 (Display Advertising)
