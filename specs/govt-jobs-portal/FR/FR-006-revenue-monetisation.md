# FR-006: Revenue and Monetisation

## Metadata
- **Area:** Revenue & Monetisation
- **Priority:** SHOULD
- **Source:** constitution.md — Functional Requirements / Revenue

## Description

The system must support an ad-driven revenue model as the initial monetisation approach. Phase 1 requires integration with Google AdSense (or an equivalent programmatic ad network) to display ads on job listing pages, search result pages, and content pages. Ad placements must not interfere with core job search or application flows. Phase 2 (future, out of scope for the initial release) involves a paid tier allowing government departments to self-publish and feature their listings; the data model must not preclude this but the paid tier must not be implemented in Phase 1.

## Acceptance criteria

```gherkin
Feature: Revenue and Monetisation

  Scenario: Ad unit renders on a job listing page
    Given Google AdSense (or equivalent) is configured with a valid publisher ID
    When a visitor loads a job detail page
    Then an ad unit must render in the designated ad placement zone
    And the ad must load asynchronously without blocking the rendering of the job listing content

  Scenario: Ad does not interfere with the job application flow
    Given an ad unit is active on a job detail page
    When a user clicks the "Apply" or "View on source" button
    Then the user must be navigated directly to the source job listing
    And the ad must not intercept or redirect the click

  Scenario: Ad is suppressed when AdSense is not configured
    Given no AdSense publisher ID is configured in the environment
    When a visitor loads any page that would normally carry an ad unit
    Then no ad request must be made
    And the page layout must render without a broken or empty ad container

  Scenario: Ad unit renders on a search results page
    Given AdSense is configured and the user has performed a keyword search
    When the search results page loads
    Then an ad unit must appear in the designated placement zone on the results page
    And the ad must not displace or obscure any search result entries

  Scenario: Ad unit renders on a content/blog page
    Given AdSense is configured and a published content article exists
    When a visitor loads the article page
    Then an ad unit must appear in the designated placement zone
    And the article text must remain fully readable around the ad
```

## Related
- NFR: NFR-001 (ad load must not degrade page load SLA), NFR-004 (ad network must not receive PII beyond what is standard for AdSense)
- Depends on: FR-002 (search results pages), FR-004 (content pages)

## Out of scope for Phase 1
- Paid department self-publish tier
- Featured listing placements sold directly to agencies
- Subscription billing infrastructure
