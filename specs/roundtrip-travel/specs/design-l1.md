# L1 System Architecture — RoadTrip Experiences Platform

## Summary

This document defines the L1 system architecture for the RoadTrip Experiences Platform. Architecture amended from v1 to adopt **Kotlin (Spring Boot)** for the backend API and workers, with **Next.js** retained for the frontend only.

## Overview

The platform is a web-first system combining:

1. **Road-trip itinerary builder** — geospatial route planning with demographic-aware stopover intelligence
2. **POI aggregation** — ingestion from government data (national parks, rest areas), open data (OpenStreetMap), and scraped sources
3. **Mixed content platform** — free attractions displayed alongside affiliate-linked bookable products
4. **User personalisation** — profile-driven demographic filtering and itinerary persistence
5. **Revenue layer** — OTA affiliate links (GetYourGuide, Viator, Klook) + display advertising

**Primary market:** Australia (English, AUD, Australian Privacy Act 1988 compliance).

**Architecture style:** Modular monolith (Phase 1) — Spring Boot application with clean domain package boundaries to facilitate service extraction in Phase 2.

## Key Technology Decisions

| Concern | Choice | Rationale |
|---|---|---|
| Frontend | Next.js 14 (React/TypeScript) | SSR/ISR for SEO (NFR-009); App Router; retained from v1 |
| Backend API | Kotlin + Spring Boot 3 | Strong null-safety; JVM performance for geospatial scoring; coroutines for async I/O; Spring ecosystem for Phase 2 integrations |
| Auth (frontend) | NextAuth.js | Google OAuth in Next.js; issues JWT passed to Spring backend |
| Auth (backend) | Spring Security + JWT validation | Validates NextAuth JWTs; secures API routes |
| Database | PostgreSQL 16 + PostGIS | Native geospatial indexing (FR-001, FR-002, NFR-002) |
| ORM | Spring Data JPA + Hibernate Spatial | First-class PostGIS geometry type support |
| Search | Meilisearch (self-hosted) | Lightweight, geo-filtering, vendor-independent (NFR-004). **Alternative:** OpenSearch via Spring Data Elasticsearch if full-text aggregations needed in Phase 2 |
| Background jobs | Spring Batch + Spring Scheduler | Structured ETL pipeline for POI ingestion (restart/retry/skip built-in); replaces BullMQ entirely — no separate job queue infra |
| Cache | Redis | Route generation caching (NFR-001); Spring Cache abstraction |
| Geospatial compute | JTS (Java Topology Suite) + PostGIS | JTS for in-process geometry operations; PostGIS for persistence/spatial queries |
| Infrastructure | Docker Compose (Phase 1) → Kubernetes-ready | Single-host dev/staging |
| CDN | Cloudflare | Static assets + page caching; Australian PoP |

### Why Spring Batch over BullMQ

BullMQ is a Node.js Redis-backed job queue — not applicable in a Kotlin stack. Spring Batch is the right replacement:
- Built-in **restart/retry/skip** logic for ETL jobs (critical for POI ingestion where partial failures must not abort the run)
- **ItemReader → ItemProcessor → ItemWriter** pipeline maps directly to: fetch raw POI → normalise + score → write to DB + Meilisearch
- **Job repository** persists execution history in PostgreSQL (no separate queue infra)
- **Spring Scheduler** handles cron triggers — no Redis dependency for scheduling

### Why Meilisearch (retained)

Meilisearch is kept because:
- Native geo-filtering with `_geoRadius` — exactly what POI proximity search needs
- Self-hosted (NFR-004 vendor independence) — no Algolia/Elasticsearch licence costs at Phase 1 scale
- Simple HTTP API — straightforward to call from Spring via RestTemplate/WebClient
- **Phase 2 migration path:** Spring Data Elasticsearch + OpenSearch if richer aggregations are needed

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────┐
│                     External Actors                          │
│  Traveller (Browser)    Googlebot / Crawlers                 │
│  Viator / GYG / Klook   (affiliate redirect targets)        │
│  Google Maps API        (route geometry + directions)        │
│  OpenStreetMap / Overpass API  (POI raw data)               │
│  Government data sources (national parks, rest areas CSV)   │
│  Ad Network (Google AdSense)                                 │
└─────────────────────────────────────────────────────────────┘
          │                             │
          ▼                             ▼
┌──────────────────┐         ┌──────────────────────────┐
│  Next.js App     │  REST   │  Spring Boot API          │
│  (SSR/ISR pages) │◄───────►│  :8080                   │
│  :3000           │  JWT    │  Domain logic, services   │
└──────────────────┘         └──────────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
          ┌──────────────────┐  ┌────────────┐  ┌──────────────┐
          │ PostgreSQL 16    │  │   Redis    │  │ Meilisearch  │
          │ + PostGIS        │  │   Cache    │  │ POI search   │
          │ Primary store    │  └────────────┘  └──────────────┘
          └──────────────────┘
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
┌──────────────────┐  ┌──────────────────────────┐
│  Spring Batch    │  │  Spring Scheduler         │
│  POI ingestion   │  │  Cron triggers (daily,    │
│  jobs            │  │  hourly)                  │
└──────────────────┘  └──────────────────────────┘
```

### Data Flow: Road-Trip Itinerary Generation (FR-001, FR-002)

```
User submits form: Origin → Destination + Party demographics
    │ (Next.js frontend → POST /api/itinerary/generate)
    ▼
ItineraryService (Spring Boot)
  1. Call Google Maps Directions API → encoded polyline + legs
  2. Decode polyline → sample candidate stopover points every ~2h drive-time
     (JTS geometry operations on decoded LatLng sequence)
  3. For each stopover point:
     PostGIS ST_DWithin(point, radius=20km) → candidate attractions
  4. DemographicScoringService:
       family/children → boost has_playground, has_toilets, has_parent_room
       adults-only     → boost adventure/natural categories
  5. Score POIs:
       score = (content_quality_score * 0.4
               + bookable_product_available * 0.3
               + (1 - normalised_distance) * 0.3)
  6. Return ranked ItineraryPlan: route segments + StopoverSlot[]
    │
    ▼
Cache in Redis (key: hash(origin+destination+party), TTL: 1h)
Return to Next.js client
```

### Data Flow: POI Ingestion Pipeline (FR-005)

```
Spring Scheduler triggers daily at 03:00 AEST
    │
    ▼
Spring Batch Job: PoiIngestionJob
  ├── Step 1: NationalParksAUStep
  │     Reader:    NationalParksItemReader (GeoJSON HTTP fetch)
  │     Processor: PoiNormalisationProcessor (→ Attraction entity)
  │     Writer:    PoiJpaItemWriter (upsert on source+source_id)
  │
  ├── Step 2: OpenStreetMapStep
  │     Reader:    OverpassApiItemReader (paged Overpass QL query)
  │     Processor: OsmPoiNormalisationProcessor
  │     Writer:    PoiJpaItemWriter
  │
  └── Step 3: MeilisearchSyncStep
        Reader:    StalePoiReader (last_indexed_at < now - 1h)
        Writer:    MeilisearchItemWriter (HTTP PUT to Meilisearch)

On processor: apply NFR-011 quality scoring (required fields populated? → quality_score)
On failure: skip malformed records (Skip policy), log to batch_job_execution_context
```

### Data Flow: Affiliate Link Click (FR-006, NFR-007)

```
User clicks affiliate product link on Next.js page
    │ GET /api/affiliate/redirect?partner=viator&ref=<hmac-token>
    ▼
AffiliateController (Spring Boot)
  1. Validate HMAC signature on ref token → extract productId + userId
  2. Persist AffiliateClickRecord (INSERT ONLY — no update/delete)
  3. HTTP 302 → partner deep-link URL with affiliate tracking params

affiliate_clicks: insert-only table. No PII in URL params (ip_hash stored, not raw IP).
```

## Components

### 1. Next.js Frontend (`/apps/web`)

**Responsibility:** Server-side rendered and statically generated UI. Calls Spring Boot REST API. No domain logic.

**Key modules:**
- `app/(public)/` — SEO content pages: destinations, attractions (FR-007). SSR + ISR via `revalidate`.
- `app/(planner)/` — Road-trip itinerary builder UI (FR-001, FR-002, FR-008). Client-interactive.
- `app/(auth)/` — NextAuth.js Google OAuth flows (FR-003).
- `lib/api/` — Typed fetch wrappers calling Spring Boot `/api/*` endpoints.
- `components/StopoverCard/` — Renders POI with free/paid mixed display (FR-004).

**Auth flow:**
NextAuth.js handles the Google OAuth callback and issues a session JWT. The JWT is forwarded as `Authorization: Bearer <token>` to the Spring Boot API on authenticated requests. Spring Security validates the JWT using the shared secret.

### 2. Spring Boot API (`/backend`)

**Package structure:**
```
com.roadtrip
  ├── itinerary/          # FR-001, FR-002 — route generation domain
  ├── poi/                # FR-005 — POI data layer + adapter pattern
  ├── affiliate/          # FR-006 — affiliate link generation + click logging
  ├── user/               # FR-003 — user profile + saved itineraries
  ├── content/            # FR-007 — destination/attraction metadata
  ├── search/             # Meilisearch integration
  ├── batch/              # Spring Batch job configurations
  └── security/           # JWT validation filter, CORS config
```

**Key REST endpoints:**
```
GET  /api/itinerary/generate
     ?origin=lat,lon&destination=lat,lon&partyType=FAMILY&childAges=3,7
     → ItineraryPlanDto

GET  /api/poi/search
     ?lat=&lon=&radiusKm=&categories=&demographics=
     → List<AttractionDto>

POST /api/user/itinerary          (Bearer JWT)
     body: ItineraryPlanDto
     → { id: UUID }

GET  /api/affiliate/redirect      (public)
     ?partner=viator&ref=<hmac>
     → HTTP 302

DELETE /api/user/account          (Bearer JWT — Privacy Act, NFR-005)
```

### 3. ItineraryService

**Responsibility:** Route geometry, stopover sampling, demographic scoring.

**Interface:**
```kotlin
interface ItineraryService {
    suspend fun generateItinerary(request: ItineraryRequest): ItineraryPlan
}

data class ItineraryRequest(
    val origin: LatLng,
    val destination: LatLng,
    val party: PartyProfile  // type, adults, children, childAges
)

data class StopoverSlot(
    val point: LatLng,
    val driveTimeFromPreviousMinutes: Int,
    val pois: List<Attraction>  // ranked, demographic-filtered
)
```

**Dependencies:** Google Maps Directions API (WebClient), PostGIS (JPA repository), Redis (Spring Cache).

### 4. POI Data Layer

**Responsibility:** Unified abstraction over POI sources. Adapter pattern for vendor independence (NFR-004).

**Interface:**
```kotlin
interface PoiSourceAdapter {
    val name: String
    fun fetchUpdates(since: Instant? = null): Flow<RawPoi>
    fun normalise(raw: RawPoi): Attraction
}
```

**Registered adapters (Phase 1):**
- `NationalParksAuAdapter` — GeoJSON feed
- `OpenStreetMapAdapter` — Overpass API (playgrounds, rest areas, natural attractions)
- `GovernmentRestAreaAdapter` — state REST area CSVs

**Spring Batch integration:** Each adapter is wrapped as a `ItemReader<RawPoi>` for use in `PoiIngestionJob` steps.

### 5. Affiliate Module

**Interface:**
```kotlin
interface AffiliateService {
    fun generateLink(partner: AffiliatePartner, productId: String, userId: UUID?): String
    fun logClick(click: AffiliateClickRecord)
}

enum class AffiliatePartner { GETYOURGUIDE, VIATOR, KLOOK }
```

**Auditability (NFR-007):** `affiliate_clicks` table has a DB-level trigger preventing UPDATE/DELETE. HMAC tokens signed with `AES-256-HMAC-SHA256`.

### 6. Background Workers

**Spring Batch jobs** (configured in `/backend/src/main/kotlin/com/roadtrip/batch/`):

| Job | Trigger | Steps |
|---|---|---|
| `PoiIngestionJob` | Daily 03:00 AEST | NationalParks → OSM → MeilisearchSync |
| `AffiliateReportJob` | Daily 06:00 AEST | Aggregate previous day clicks by partner |

**Spring Scheduler** triggers jobs via `@Scheduled(cron = "...")`. No Redis dependency for job coordination — Spring Batch uses PostgreSQL as its job repository (reuses existing DB).

## Data Model (Key Entities)

```sql
-- Managed via Flyway migrations

CREATE TABLE destinations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    region TEXT,
    description TEXT,
    seo_meta JSONB
);

CREATE TABLE attractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    UNIQUE (source, source_id),                   -- deduplication key
    slug TEXT UNIQUE,
    name TEXT NOT NULL,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    categories TEXT[],                             -- 'playground','rest_area',...
    opening_hours JSONB,
    is_free BOOLEAN NOT NULL DEFAULT true,
    has_toilets BOOLEAN,                           -- NFR-011 enrichment fields
    has_playground BOOLEAN,
    has_parking BOOLEAN,
    accessibility_notes TEXT,
    family_suitability JSONB,                      -- {toddler, 5_12, teen, all}
    demographic_tags JSONB,
    quality_score FLOAT NOT NULL DEFAULT 0,
    last_ingested_at TIMESTAMPTZ
);
CREATE INDEX attractions_location_idx ON attractions USING GIST (location);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attraction_id UUID REFERENCES attractions(id),
    partner TEXT NOT NULL,                         -- 'viator','getyourguide','klook'
    partner_product_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    price_from_aud NUMERIC(10,2),
    variants JSONB,                                -- extensible for Phase 2 direct connect
    affiliate_url_template TEXT NOT NULL
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    auth_provider TEXT NOT NULL,
    auth_provider_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ                         -- soft delete for Privacy Act NFR-005
);

CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    party_type TEXT,
    children_ages INT[],
    demographic_tags JSONB
);

CREATE TABLE saved_itineraries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    origin GEOGRAPHY(POINT, 4326),
    destination GEOGRAPHY(POINT, 4326),
    route_geometry JSONB,
    stops JSONB NOT NULL,
    share_token TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE affiliate_clicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,                                  -- nullable (anonymous)
    product_id UUID REFERENCES products(id),
    partner TEXT NOT NULL,
    ref_token TEXT NOT NULL,
    clicked_at TIMESTAMPTZ DEFAULT now(),
    ip_hash TEXT NOT NULL
    -- DB-level trigger: BEFORE UPDATE OR DELETE → RAISE EXCEPTION (insert-only)
);
```

**Schema migrations:** Flyway (replaces Prisma from v1 spec).

## NFR Coverage

| NFR | Mechanism |
|-----|-----------|
| NFR-001 Route latency ≤5s | Spring Cache + Redis (TTL 1h) for identical route+party combos; PostGIS spatial index |
| NFR-002 Geospatial accuracy | PostGIS `geography` type (spherical distance, not planar); JTS for polyline operations |
| NFR-003 Availability 99.5% | Docker health checks; Cloudflare proxy; HikariCP connection pool |
| NFR-004 POI vendor independence | `PoiSourceAdapter` interface; Meilisearch self-hosted; `(source, source_id)` dedup |
| NFR-005 Data privacy | Soft-delete on users; no PII in cache or URL params; IP hashed; Privacy Act deletion flow |
| NFR-006 Auth security | NextAuth.js OAuth PKCE; Spring Security JWT validation; HTTP-only cookies |
| NFR-007 Affiliate auditability | Insert-only `affiliate_clicks` (DB trigger); HMAC-signed ref tokens |
| NFR-008 POI data freshness | Spring Scheduler daily cron; `last_ingested_at` per record; Spring Batch skip-and-log |
| NFR-009 SEO indexability | Next.js SSR/ISR; schema.org JSON-LD; canonical URLs; sitemap |
| NFR-010 Page load ≤2.5s LCP | Next.js ISR for content pages; Cloudflare CDN; image optimisation |
| NFR-011 POI quality standard | `quality_score` on attractions; enrichment fields: toilets, playground, accessibility |

## Key Architectural Decisions

1. **Kotlin + Spring Boot backend, Next.js frontend only**: Next.js handles SSR/SEO and OAuth UI. Spring Boot owns all domain logic. Clean separation — frontend is a stateless presentation tier.

2. **Spring Batch replaces BullMQ**: No Redis-based job queue needed. Spring Batch uses PostgreSQL as its job repository (one less infra dependency). Built-in restart/retry/skip is better suited to ETL ingestion than a transient job queue.

3. **Flyway replaces Prisma**: Flyway is the standard migration tool for JVM/Spring stacks. SQL-first migrations are more explicit and work natively with PostGIS geometry types.

4. **Meilisearch retained**: Self-hosted, vendor-independent (NFR-004), native geo-filtering. Upgrade path: replace with OpenSearch if Phase 2 requires richer search aggregations — Spring Data Elasticsearch makes this straightforward.

5. **Modular monolith**: Domain packages (`itinerary/`, `poi/`, `affiliate/`, `user/`) have clean interfaces. Phase 2 can extract packages into independent services without schema migration.

6. **PostGIS geography type**: Uses `GEOGRAPHY` (spherical) not `GEOMETRY` (planar) for distance calculations — critical for accuracy across Australia's large distances (NFR-002).

## Open Decisions Resolved

| Decision | Resolution |
|---|---|
| Technology stack | **Frontend:** Next.js 14 + TypeScript. **Backend:** Kotlin + Spring Boot 3 + Spring Batch + Flyway |
| Geographic market | Australia primary; geo-agnostic implementation (PostGIS, no AU-hardcoding in logic) |
| Viator API tier | Phase 1: affiliate link only |
| Auth providers | NextAuth.js: Google MUST; Apple/Facebook COULD (NextAuth extensible) |
| Product schema for Phase 2 | `variants JSONB` + `(source, source_id)` dedup; direct supplier tables added in Phase 2 |
| Job queue | Spring Batch + Spring Scheduler (not BullMQ — Node.js only) |
| Search | Meilisearch self-hosted (not Algolia/Elasticsearch) |
