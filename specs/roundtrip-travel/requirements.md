# Requirements — RoadTrip Experiences Platform

## Summary

A road-trip-first travel experiences platform that disrupts the OTA market by providing a genuine one-stop-shop for travellers — rich free content, demographic-tailored local attractions, and bookable products via affiliate links from Viator and GetYourGuide.

- **Functional requirements:** 10
- **Non-functional requirements:** 10
- **Areas covered:** Itinerary Planning, User Management, Content & Monetisation, Data Ingestion, Content Management, Discovery & Personalisation, Performance, Availability, Security, Privacy, Compliance, SEO

---

## Functional Requirements

### FR-001: Road Trip Itinerary Builder
**Area:** Itinerary Planning | **Priority:** MUST

The system must allow a user to enter an origin, destination, and travel party composition, and generate a recommended road trip route with suggested stopover locations spaced approximately every 2 hours of driving time.

**Gherkin:**
```gherkin
Feature: Road Trip Itinerary Builder

  Scenario: User generates a road trip itinerary
    Given a user has specified an origin location, a destination, and a travel party
    When the user requests a road trip itinerary
    Then the system must return a route with stopover suggestions spaced approximately 2 hours apart
    And each stopover must include at least one suggested attraction or rest area
    And the route must be driveable via standard road network

  Scenario: Itinerary cannot be generated due to invalid origin or destination
    Given a user has entered an unrecognisable or out-of-range location
    When the user requests a road trip itinerary
    Then the system must display a clear error message explaining the issue
    And must prompt the user to correct the input
```

---

### FR-002: Stopover Intelligence
**Area:** Itinerary Planning | **Priority:** MUST

The system must surface contextually relevant stopover options calibrated to the travel party's demographics. For families with children, stopovers must include locations with playgrounds, toilets, and parent/baby rooms. For all parties, stopovers must include towns, natural attractions, and rest areas.

**Gherkin:**
```gherkin
Feature: Stopover Intelligence

  Scenario: Family with young children requests stopover suggestions
    Given a road trip itinerary is being generated for a party including children under 12
    When the system generates stopover options
    Then each suggested stopover must include at least one location tagged with playground or toilet facilities
    And stopovers must be spaced no more than 2 hours driving time apart

  Scenario: Adult-only party requests stopover suggestions
    Given a road trip itinerary is being generated for an adult-only party
    When the system generates stopover options
    Then the system must return stopovers with towns, natural attractions, and rest areas
    And playground-specific filtering must not be applied unless requested

  Scenario: Travel party demographic changes after itinerary generation
    Given a user has an existing itinerary for an adult-only party
    When the user updates the party to include children
    Then the system must regenerate stopover suggestions appropriate for families
```

---

### FR-003: User Profile and Preferences
**Area:** User Management | **Priority:** MUST

The system must allow users to create and maintain a profile that stores their travel party demographics, preferences, and past itineraries. The profile must be used to personalise content recommendations and reduce repeated data entry across sessions.

**Gherkin:**
```gherkin
Feature: User Profile and Preferences

  Scenario: User creates a profile
    Given an anonymous user accesses the platform
    When the user registers and provides demographic information (party size, age groups, interests)
    Then the system must persist this profile
    And subsequent itinerary requests must default to the saved party configuration

  Scenario: User views past itineraries from their profile
    Given a logged-in user with one or more previously saved itineraries
    When the user navigates to their profile
    Then the system must display a list of past itineraries
    And each itinerary must be accessible for viewing and re-use

  Scenario: Profile preferences influence content surfacing
    Given a user profile that records a preference for family-friendly attractions
    When the user browses destination or attraction pages
    Then family-friendly content must be ranked or highlighted above non-family content
```

---

### FR-004: Mixed Free and Paid Content Display
**Area:** Content & Monetisation | **Priority:** MUST

The system must display both free attractions and bookable paid products in a unified view. Paid products must be sourced via affiliate links from Viator and GetYourGuide, and the system must surface the cheapest or best-value option available.

**Gherkin:**
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

---

### FR-005: POI Indexing and Data Ingestion
**Area:** Data Ingestion | **Priority:** MUST

The system must maintain a continuously updated index of Points of Interest (POIs) aggregated from multiple sources: government datasets (national parks, rest areas, playgrounds), open data consortia (OpenStreetMap, Google Places), and scraped sources. The data layer must be replaceable without vendor lock-in.

**Gherkin:**
```gherkin
Feature: POI Indexing

  Scenario: Government POI data is ingested
    Given a government data source provides a feed of rest areas and national parks
    When the ingestion pipeline runs
    Then all POIs from the feed must be indexed in the system
    And each POI must be tagged with its source and category

  Scenario: Open data source POI is deduplicated against existing records
    Given the same physical location exists in both OpenStreetMap and a government dataset
    When both datasets are ingested
    Then the system must create a single deduplicated POI record
    And the record must reference both source identifiers

  Scenario: Scraped POI data is ingested with error handling
    Given a scraping job for a third-party source runs
    When the scraper encounters malformed or partial data
    Then the ingestion pipeline must log the error and skip the malformed record
    And the successfully scraped records must still be indexed
```

---

### FR-006: OTA Affiliate Integration (Viator and GetYourGuide)
**Area:** Content & Monetisation | **Priority:** MUST

The system must integrate with Viator and GetYourGuide via affiliate link mechanisms to surface bookable products and generate commission revenue. For Viator specifically, the system must support API-based product lookup (using the existing partner account).

**Gherkin:**
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

  Scenario: Affiliate link parameters are validated before display
    Given a product is being rendered on the platform
    When the system builds the affiliate link
    Then the affiliate tracking ID and any required parameters must be present in the link
    And the link must resolve to the correct product on the OTA site
```

---

### FR-007: Destination and Attraction Content Pages
**Area:** Content Management | **Priority:** MUST

The system must provide rich, SEO-optimised content pages for Destinations and Attractions. Each page must display curated content including contextual information, highlights, opening hours, accessibility features, and relevant demographic tags.

**Gherkin:**
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

---

### FR-008: Demographic-Based Filtering
**Area:** Discovery & Personalisation | **Priority:** MUST

The system must allow users to filter all attraction and content listings by demographic criteria, including: family with children (with sub-options for age ranges), singles, adults-only, accessibility needs, and age group. Filters must be persistable within the user's profile.

**Gherkin:**
```gherkin
Feature: Demographic-Based Filtering

  Scenario: User filters by family with young children
    Given a user is browsing an attraction list for a destination
    When the user selects "Family — children under 5" as their demographic filter
    Then the system must return only attractions tagged as suitable for children under 5
    And must highlight facilities such as playgrounds, baby change rooms, and enclosed areas

  Scenario: User saves demographic filter to profile
    Given a logged-in user has set a demographic filter to "Family — children aged 5-12"
    When the user returns to the platform in a new session
    Then the saved demographic filter must be pre-applied to their browsing

  Scenario: No matching attractions for demographic filter
    Given a user has applied a highly specific demographic filter
    When no attractions match the selected criteria
    Then the system must display a "no results" message with an option to broaden the filter
```

---

### FR-009: Itinerary Save and Share
**Area:** Itinerary Planning | **Priority:** SHOULD

The system must allow authenticated users to save generated itineraries to their profile and share itineraries via a public link.

**Gherkin:**
```gherkin
Feature: Itinerary Save and Share

  Scenario: Logged-in user saves a generated itinerary
    Given a user has generated a road trip itinerary
    When the user clicks "Save to my trips"
    Then the itinerary must be saved to the user's profile
    And it must be accessible from their saved itineraries list

  Scenario: User shares an itinerary via a public link
    Given a user has a saved itinerary
    When the user clicks "Share"
    Then the system must generate a unique, shareable URL for the itinerary
    And a non-logged-in user who visits the link must be able to view the itinerary
    And the non-logged-in user must not be able to edit or delete the itinerary

  Scenario: User deletes a saved itinerary
    Given a user has a saved itinerary
    When the user deletes the itinerary
    Then the itinerary must be removed from their profile
    And the shared link must return a "not found" response
```

---

### FR-010: Display Advertising
**Area:** Content & Monetisation | **Priority:** SHOULD

The system must support display advertising placements on content pages. Advertising placements must be configurable and must not interfere with core user journeys.

**Gherkin:**
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

---

## Non-Functional Requirements

### NFR-001: Route Generation Latency
**Category:** Performance | **Priority:** MUST

The system must generate a complete road trip itinerary and return results within 5 seconds for routes up to 1,000 km under normal load (up to 100 concurrent users).

### NFR-002: Geospatial Accuracy
**Category:** Reliability | **Priority:** MUST

POI locations must have position accuracy within 100 metres of actual location. Route segment driving times must be accurate to within ±15% of real-world driving time under normal traffic conditions.

### NFR-003: System Availability
**Category:** Availability | **Priority:** MUST

The platform must maintain at least 99.5% uptime on a rolling 30-day basis. Planned maintenance must not exceed 2 hours per month and must be scheduled outside 6am–10pm local time.

### NFR-004: POI Data Vendor Independence
**Category:** Reliability | **Priority:** MUST

The POI data ingestion layer must use an abstracted adapter interface so any data source can be replaced without changes to core platform code.

### NFR-005: Data Privacy
**Category:** Privacy | **Priority:** MUST

The system must comply with the Australian Privacy Act 1988. User PII must be stored encrypted at rest and in transit. Users must be able to request deletion of all personal data within 30 days.

### NFR-006: Authentication Security
**Category:** Security | **Priority:** MUST

Authentication must support email/password and at least one social login (Google). Passwords must use bcrypt or Argon2. Session tokens must expire after 30 days of inactivity. MFA must be available as an optional setting.

### NFR-007: Affiliate Link Auditability
**Category:** Compliance | **Priority:** MUST

Every affiliate link click must be logged with timestamp, product ID, affiliate network, and anonymised user ID. Logs must be retained for 24 months and queryable for revenue reconciliation.

### NFR-008: POI Data Freshness
**Category:** Reliability | **Priority:** SHOULD

The POI index must be refreshed at least once every 7 days. Government daily feeds must be ingested within 24 hours of publication.

### NFR-009: SEO Indexability
**Category:** Accessibility | **Priority:** MUST

All public pages must be server-side rendered or statically generated. Each page must include unique meta title, meta description, and JSON-LD structured data (Schema.org).

### NFR-010: Page Load Performance
**Category:** Performance | **Priority:** MUST

All public-facing pages must achieve LCP under 2.5 seconds and TBT under 300 milliseconds (Lighthouse, mid-tier mobile, 4G). Images must be served in WebP with lazy loading.

---

## Open Decisions

1. **Technology stack** — Phase 1 stack not yet determined; delegated to architecture task. Constraint: no vendor lock-in for POI data layer.
2. **Geographic market scope** — Primary market assumed to be Australia. Confirm to align compliance and data defaults.
3. **Viator API tier** — Existing partner account API tier (Affiliate vs Content API) needs confirmation to determine product data retrieval capability.
4. **Social login providers** — Google confirmed as required; other providers (Apple, Facebook) to be confirmed before architecture.
5. **Product schema extensibility** — Schema must accommodate day tours, multi-day tours, transfers, attraction tickets, and equipment rentals. Detailed schema design delegated to architecture.

## Out of Scope (Phase 1)
- Direct API connectivity with suppliers (Phase 2)
- White-label / third-party API access (Phase 3)
- ML-powered deduplication (Phase 3)
- Native mobile application
- Multi-language / localisation beyond English
- Dynamic real-time pricing or inventory management
