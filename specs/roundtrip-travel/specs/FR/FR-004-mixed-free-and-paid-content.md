# FR-004: Mixed Free and Paid Content Display

## Metadata
- **Area:** Content & Monetisation
- **Priority:** MUST
- **Source:** Constitution — "Mixed free/paid content: show free attractions alongside bookable products; source cheapest/best tickets via Viator and GetYourGuide affiliate links"

## Description
The system must display both free attractions and bookable paid products in a unified, side-by-side view. Paid products must be sourced via affiliate links from Viator and GetYourGuide, and the system must surface the cheapest or best-value option available.

## Acceptance criteria

```gherkin
Feature: Mixed Free and Paid Content Display

  Scenario: User views a destination page
    Given a user navigates to a destination or stopover page
    When the page loads
    Then the page must display both free attractions and paid bookable products
    And paid products must include affiliate links to the cheapest or best-value ticket source
    And free content must be clearly labelled as free

  Scenario: User clicks an affiliate link for a paid product
    Given a user is viewing a paid product on the platform
    When the user clicks the booking link
    Then the system must redirect the user to the OTA (Viator or GetYourGuide) via a tracked affiliate link
    And the affiliate tracking parameters must be present in the URL

  Scenario: No paid product is available for an attraction
    Given an attraction has no associated bookable product from any OTA
    When the attraction page is displayed
    Then the page must show the attraction as free-only without a booking call-to-action
```

## Related
- NFR: NFR-007 (Affiliate link auditability), NFR-008 (Data freshness)
- Depends on: FR-005 (POI Indexing), FR-006 (OTA Affiliate Integration)
