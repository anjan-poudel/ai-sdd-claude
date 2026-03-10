# Task Breakdown — RoadTrip Experiences Platform

## Summary
- Task groups: 7 (Jira Epics)
- Total tasks: 28 (+ 6 subtasks)
- Estimated effort: 18–24 days (3 developers, partial parallel) / 48–60 days (sequential)
- Critical path: T-001 → T-004 → T-005 → T-010 → T-011 → T-013 → T-020 → T-021

## Contents
- [tasks/index.md](tasks/index.md) — all task groups

## Critical path

The longest chain runs through infrastructure, POI ingestion, route generation, and the web frontend:

1. **T-001** (project setup, DB schema) — everything depends on this
2. **T-004** (PostGIS spatial index) — required by route generation
3. **T-005** (national parks adapter) — first POI data needed by route generation
4. **T-010** (route generation service) — core differentiator
5. **T-011** (stopover intelligence + demographic scoring) — extends route service
6. **T-013** (itinerary builder UI) — first user-visible feature
7. **T-020** (destination SSR pages) — SEO foundation
8. **T-021** (sitemap + structured data) — SEO completeness

Total critical path: approximately 18–22 developer-days with 3 developers.

## Key risks

1. **HIGH — T-010**: Google Maps API quota management. If rate limits hit in production, itinerary generation fails. Mitigation: aggressive Redis caching + backoff.
2. **HIGH — T-005, T-006, T-007**: OpenStreetMap/Overpass API reliability. If source data is unavailable, ingestion fails silently. Mitigation: retry + staleness alerts.
3. **MEDIUM — T-024**: Affiliate click audit log must never lose data. Single point of failure for revenue tracking. Mitigation: insert-only table, transaction wrapping.
4. **MEDIUM — T-016**: NextAuth.js OAuth PKCE implementation. Auth bugs can cause session leaks. Mitigation: NextAuth defaults + E2E auth flow tests.
5. **LOW — T-028**: Performance under load. Meilisearch geo-filter correctness vs PostGIS — validate both agree. Mitigation: integration test with known fixtures.

## Security blockers

None (no security design review was produced in this workflow run). Security requirements addressed inline in task implementation notes (NFR-005, NFR-006, NFR-007).
