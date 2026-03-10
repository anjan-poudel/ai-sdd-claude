# L2 Component Design Review — RoadTrip Experiences Platform

## Summary

Review of `specs/design-l2.md` against the L1 architecture (`specs/design-l1.md`), requirements lock, and constitution standards.

### Alignment with L1 Architecture

**All 7 L1 components present in L2:**

| L1 Component | L2 Coverage |
|---|---|
| Web Application | Apps/web structure, API routes, ISR pages, AdSense |
| Route Generation Service | Full algorithm with PostGIS spatial query, scoring, caching |
| POI Data Layer | Adapter interface, 3 Phase 1 adapters, ingestion pipeline |
| Affiliate Module | Link generation with HMAC signing, click logging, redirect route |
| User & Auth Module | NextAuth.js config, UserService with full CRUD, deleteUser |
| Content & SEO Module | Destination pages with ISR, schema.org structured data |
| Background Job Worker | BullMQ queues, 3 job definitions, Meilisearch sync worker |

### Data Model Review

**All entities from L1 present and correctly specified:**
- `Destination`, `Attraction`, `Product`, `User`, `UserPreferences`, `SavedItinerary`, `AffiliateClick` — all present
- PostGIS geom column defined with GIST index — correct for NFR-002 accuracy
- `@@unique([source, sourceId])` deduplication key — implements NFR-004 vendor independence
- `AffiliateClick` insert-only comment — implements NFR-007 auditability
- `qualityScore` float on Attraction — implements NFR-011
- `variants jsonb` on Product — implements Phase 2 extensibility requirement

### Interface Contracts Review

**API routes:** 9 routes defined covering all functional requirements. Auth correctly applied (itinerary save = required, redirect = none, POI search = none).

**Environment variables:** Zod schema validated at startup — implements fail-fast on missing config. Affiliate credentials correctly optional (graceful degradation if not set).

**Error handling table:** All error classes addressed with appropriate HTTP codes and behaviours.

### Security Review

- HMAC-signed affiliate tokens with 24h expiry — correct
- Referer/hostname allow-list on redirect route — correct
- IP hashing (not raw IP) for audit log — correct NFR-005 privacy handling
- `deleteUser` with affiliate click anonymisation (not deletion) — correct balance of audit (NFR-007) vs privacy (NFR-005)
- No PII in logs — listed in observability section

### NFR Coverage Review

All 11 NFRs addressed:
- NFR-001: Redis cache 1h TTL + PostGIS spatial index ✓
- NFR-002: `ST_SetSRID(MakePoint, 4326)` geography type ✓
- NFR-003: Health endpoints `/api/health` and `/api/health/ready` ✓
- NFR-004: Adapter pattern with `@@unique([source, sourceId])` ✓
- NFR-005: IP hashing, `deleteUser`, no PII in logs ✓
- NFR-006: NextAuth.js JWT, CSRF, PKCE, HTTP-only cookies ✓
- NFR-007: Insert-only `AffiliateClick` table, HMAC-signed tokens ✓
- NFR-008: Daily cron + `lastIngestedAt` per attraction ✓
- NFR-009: ISR pages, schema.org JSON-LD, canonical links ✓
- NFR-010: ISR + Cloudflare CDN + Next.js image optimisation ✓
- NFR-011: `qualityScore` float + `computeQualityScore` function ✓

### Minor Observations (non-blocking)

1. `sampleByDriveTime` function is referenced but not specified — acceptable at L2 (implementation detail for dev).
2. Meilisearch document structure defined but index configuration (searchable/filterable attributes) not specified — acceptable at L2.
3. Google AdSense setup is noted as a placeholder component — acceptable, no complex design needed.
4. `hashIp` function referenced but not specified — acceptable implementation detail.

All are implementation-level details appropriate for L3/dev phase.

## Decision

**decision: GO**

The L2 component design is approved. All L1 components are fully designed with:
- Detailed TypeScript interfaces and Prisma schema
- PostGIS spatial query implementation
- HMAC-secured affiliate module
- Privacy-compliant user deletion
- Full NFR coverage with concrete mechanisms
- Observability (Pino logging, health endpoints, metrics)
- Technical risks documented with mitigations

**Proceed to L3 task planning.**
