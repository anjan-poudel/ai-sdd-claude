# FR-011: Itinerary Social Sharing and UGC

## Metadata
- **Area:** Discovery & Personalisation
- **Priority:** SHOULD
- **Source:** Market research (OTA State 2026) — social commerce identified as a structural differentiation vector. Klook's social commerce integrations cited by Arival as a key growth driver. UGC (photo/rating) on POIs seeds the social flywheel and differentiates from pure-SEO OTAs.

## Description
The system should allow users to share itineraries publicly via a shareable link that renders a social-preview-optimised page (Open Graph tags, map thumbnail). Users should also be able to contribute a photo and a rating to any POI they have visited, creating a lightweight UGC layer for the platform.

This is scope-limited for Phase 1: no social login sharing (post to Facebook/Instagram), no comments. The goal is to seed the social data loop — shareable links that travel through messaging apps and social networks, and POI ratings that improve discovery rankings over time.

## Acceptance criteria

```gherkin
Feature: Itinerary Social Sharing and UGC

  Scenario: User shares an itinerary via a social-preview link
    Given a user has a saved itinerary
    When the user clicks "Share"
    Then the system must generate a unique, shareable URL
    And the URL's Open Graph metadata must include a title, description, and map thumbnail image
    And a non-logged-in visitor must be able to view the full itinerary at the shared URL

  Scenario: User submits a photo and rating for a POI
    Given an authenticated user has an itinerary containing a POI
    When the user submits a photo and a 1–5 star rating for that POI
    Then the photo must be stored and associated with that POI
    And the rating must be recorded and factored into that POI's aggregate score

  Scenario: POI aggregate score updates after new ratings
    Given a POI has received one or more user ratings
    When the POI detail page is rendered
    Then the page must display the current aggregate rating and review count

  Scenario: Shared itinerary link becomes inactive after deletion
    Given a user has shared an itinerary
    When the user deletes the itinerary
    Then the shared URL must return a "not found" response
```

## Related
- NFR: NFR-005 (Data privacy — UGC photo moderation policy required)
- NFR: NFR-009 (SEO indexability — shared itinerary pages must be indexable)
- Depends on: FR-001 (Road Trip Itinerary Builder), FR-003 (User Profile), FR-009 (Itinerary Save and Share)
