# FR-006: OTA Affiliate Integration (GetYourGuide, Viator, and Klook)

## Metadata
- **Area:** Content & Monetisation
- **Priority:** MUST
- **Source:** Requirements.md — "Revenue will initially come via affiliate links from OTAs like Viator and Ads for phase 1. But work will start on API integration with Viator as we already have partner account with them."
- **Amended:** Market research (Jan 2026 Similarweb data) shows GetYourGuide leads web traffic (45.4M visits/mo) over Viator (26.3M), and Klook (44.9M) is the dominant APAC-focused OTA highly relevant to the Australian market. All three must be treated as co-equal affiliate targets.

## Description
The system must integrate with GetYourGuide, Viator, and Klook via affiliate link mechanisms to surface bookable products and generate commission revenue. For Viator specifically, the system must support API-based product lookup (using the existing partner account) to retrieve product data including pricing, availability, and variants. GetYourGuide and Klook are integrated via their published affiliate programmes.

The priority order for display on the platform should be determined by best-price matching and relevance, not by OTA preference.

## Acceptance criteria

```gherkin
Feature: OTA Affiliate Integration

  Scenario: Viator products are retrieved via API
    Given the system has valid Viator API credentials
    When a product search is executed for a given destination
    Then the system must return available Viator products with pricing, variants, and availability
    And each product must be stored or cached for presentation on the platform

  Scenario: GetYourGuide products are surfaced via affiliate links
    Given a destination page is rendered
    When the system queries GetYourGuide affiliate data for that destination
    Then the page must display relevant GetYourGuide products with affiliate-tracked booking links

  Scenario: Klook products are surfaced via affiliate links
    Given a destination page is rendered
    When the system queries Klook affiliate data for that destination
    Then the page must display relevant Klook products with affiliate-tracked booking links
    And Klook products must be surfaced for APAC-origin travellers and Australian domestic destinations

  Scenario: Affiliate link parameters are validated before display
    Given a product is being rendered on the platform
    When the system builds the affiliate link
    Then the affiliate tracking ID and any required parameters must be present in the link
    And the link must resolve to the correct product on the OTA site
```

## Related
- NFR: NFR-007 (Affiliate link auditability)
- Depends on: FR-004 (Mixed Free and Paid Content Display)
