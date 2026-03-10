# L1 Architecture Review — RoadTrip Experiences Platform

## Summary

Review of `specs/design-l1.md` against the constitution standards and requirements lock.

**Reviewer criteria (from constitution):**
- L1 architecture must cover: data ingestion pipeline, geospatial query, user profile, and affiliate/monetisation
- Schema design must accommodate diverse product variants
- Architecture docs must include a `## Components` section with interface contracts
- Every schema design must consider extensibility for Phase 2 direct-connect and Phase 3 aggregator

### Requirements Coverage

All 11 FRs are addressed:

| FR | Coverage |
|----|---------|
| FR-001 Road-trip itinerary builder | Route Generation Service with Google Maps + PostGIS described |
| FR-002 Stopover intelligence | Stopover sampling algorithm with demographic filtering in Route Service |
| FR-003 User profile and preferences | User & Auth Module; `users`, `user_preferences` tables |
| FR-004 Mixed free/paid content | StopoverCard component; products table with `is_free` on attractions |
| FR-005 POI indexing | POI Data Layer with adapter pattern; BullMQ ingestion jobs |
| FR-006 OTA affiliate integration | Affiliate Module; GetYourGuide, Viator, Klook supported |
| FR-007 Destination/attraction content pages | Content & SEO Module; SSR/ISR pages |
| FR-008 Demographic filtering | Route Service with demographic tag filtering on attractions |
| FR-009 Itinerary save/share | UserService.saveItinerary; public `/itinerary/[id]` pages |
| FR-010 Display advertising | Not explicitly designed but mentioned in Revenue layer; deferred to implementation |
| FR-011 Social sharing/UGC | OG tags in Content Module; FR-009 shares itinerary pages |

All 11 NFRs are covered with explicit mechanisms in the NFR Coverage table.

### Mandatory Sections Check

- [x] `## Overview` — present and complete
- [x] `## Architecture` — present with system context diagram and data flows
- [x] `## Components` — present with interface contracts for all 6 components

### Architecture Quality Assessment

**Strengths:**
1. Adapter pattern for POI sources directly implements NFR-004 (vendor independence) — well-designed
2. PostGIS geography type explicitly called out for NFR-002 (accuracy) — correct approach
3. Insert-only `affiliate_clicks` table for NFR-007 auditability — correct
4. HMAC-signed affiliate redirect tokens — good security design
5. Modular monolith rationale is sound for Phase 1 scale
6. Phase 2/3 extensibility is addressed: `variants jsonb`, adapter pattern, module boundaries

**Minor gaps (non-blocking):**
1. FR-010 (display advertising) is underspecified — ad network integration is mentioned but no component defined. Acceptable at L1; detail in L2.
2. NFR-011 (POI quality scoring) mentions `quality_score float` but no quality calculation algorithm. Acceptable at L1.
3. Meilisearch geo-filtering capability should be validated against PostGIS for correctness. Both are present which provides redundancy.

**Open decisions resolved:** All 5 open decisions from requirements are resolved by this architecture.

## Decision

**decision: GO**

The L1 architecture document is approved. All mandatory constitution criteria are met:

- Data ingestion pipeline: defined (POI Data Layer + BullMQ worker)
- Geospatial query: defined (PostGIS + Route Generation Service)
- User profile: defined (User & Auth Module)
- Affiliate/monetisation: defined (Affiliate Module + insert-only audit log)
- Product variant schema: extensible (`variants jsonb`, Phase 2 supplier tables)
- Interface contracts: present for all 6 components

Minor gaps in FR-010 and NFR-011 are acceptable at L1 and should be addressed in L2 component design.

**Proceed to L2 component design.**
