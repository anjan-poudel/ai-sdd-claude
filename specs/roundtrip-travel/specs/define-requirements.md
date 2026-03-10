# Requirements — RoadTrip Experiences Platform

## Summary
- Functional requirements: 11 (amended from 10 — FR-011 added; FR-006 expanded)
- Non-functional requirements: 11 (amended from 10 — NFR-011 added)
- Areas covered: Itinerary Planning, User Management, Content & Monetisation, Data Ingestion, Content Management, Discovery & Personalisation, Performance, Availability, Security, Privacy, Compliance, SEO, Content Quality

## Contents
- [FR/index.md](FR/index.md) — functional requirements
- [NFR/index.md](NFR/index.md) — non-functional requirements

## Amendment notes (v2 — stakeholder review)
Based on OTA markh maj(SHOULD)**: Itinerary social sharing with Open Graph previews + lightweight UGC (POI photo/rating). Social commerce identified as structural differentiator; seeds platform flywheel.
3. **NFR-011 added (SHOULD)**: POI content quality standard — required fields (name, coordinates, hours, description) and enrichment fields (toilets, playground, parking, accessibility, family suitability).
4. **Competitive landscape note added**: Experience Oz and BookMe identified as direct Oceanian regional competitors.

## Open decisions

1. **Technology stack** — Phase 1 stack not yet determined. Architecture task will define the web framework and geospatial database. Key constraint: no vendor lock-in for the POI data layer.

2. **Geographic market scope** — The primary market is assumed to be Australia. This should be confirmed and may affect geolocation defaults, currency, and compliance requirements.

3. **Viator API tier** — The existing Viator partner account needs to be assessed for API access tier (Affiliate vs Content API vs Supply API) as this determines what product data can be retrieved programmatically vs link-only.

4. **User profile authentication provider** — A social login provider (Google) is assumed to be required. The list of supported providers (Apple, Facebook, etc.) should be confirmed before architecture.

5. **Product schema extensibility for Phase 2** — The product and variant schema must be designed with direct supplier connectivity in mind. The detailed schema design is delegated to the architecture task but must accommodate: day tours, multi-day tours, transfers, attraction tickets, and equipment rentals.

## Competitive landscape (Oceania)
Key regional competitors to monitor and differentiate against:
- **Experience Oz** (`experienceoz.com.au`) — Australian/NZ activities OTA; ranked by Arival as an adventure/outdoor regional OTA
- **BookMe** (`bookme.co.nz`) — NZ/AU deal-led activities; Arival regional OTA listing

Neither competitor offers a road-trip itinerary builder or demographic-calibrated stopover engine — this remains the primary differentiation.

## Out of scope (Phase 1)
- Direct API connectivity with suppliers or reservation platforms (Phase 2)
- White-label or third-party API access to the platform (Phase 3)
- ML-powered product deduplication and clustering (Phase 3)
- Native mobile application (web-first for Phase 1)
- Multi-language / localisation beyond English
- Dynamic real-time pricing (affiliate links only; no OTA inventory management)
