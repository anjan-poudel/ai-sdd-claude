# L2 Component Design — RoadTrip Experiences Platform

## Overview

This document provides detailed component design for the RoadTrip Experiences Platform, expanding on the L1 architecture (`specs/design-l1.md`). Each component section covers: detailed interfaces and data contracts, database schema, error handling, observability, and performance/security implementation.

**Stack:** Next.js 14 + TypeScript + PostgreSQL 16 + PostGIS + Meilisearch + Redis + BullMQ.

**Module structure:**
```
apps/
  web/                  Next.js application (SSR + API routes)
services/
  route/                Route generation + stopover intelligence
  poi/                  POI data layer + adapters
  affiliate/            Affiliate link generation + click logging
  user/                 Auth + user profile + itinerary persistence
  content/              SEO content + structured data
workers/
  poi-ingest/           BullMQ worker for POI ingestion jobs
packages/
  db/                   Prisma schema + migrations + client
  types/                Shared TypeScript types
  config/               Environment config schema (Zod)
```

## Components

### 1. Database Schema (`packages/db`)

**ORM:** Prisma v5 with `@prisma/client`. All migrations versioned.

**Complete schema (key tables):**

```prisma
model Destination {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  lat         Float
  lon         Float
  region      String   // e.g. "Queensland", "Victoria"
  description String?
  seoMeta     Json?    // { title, description, ogImage }
  attractions Attraction[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Attraction {
  id              String   @id @default(cuid())
  source          String   // "national_parks_au" | "osm" | "govt_rest_area"
  sourceId        String   // external ID from source
  slug            String   @unique
  name            String
  lat             Float
  lon             Float
  categories      String[] // ["playground","rest_area","national_park","attraction"]
  openingHours    Json?    // { mon: "08:00-17:00", ... } or null
  isFree          Boolean  @default(true)
  demographicTags Json     // {family:bool, children:bool, toilet:bool, parking:bool,
                           //  playground:bool, parentRoom:bool, accessibility:bool}
  description     String?
  qualityScore    Float    @default(0) // 0.0-1.0 NFR-011
  lastIngestedAt  DateTime?
  destinationId   String?
  destination     Destination? @relation(fields:[destinationId], references:[id])
  products        Product[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([source, sourceId])       // deduplication key
  @@index([lat, lon])                // spatial queries (covered by PostGIS separately)
}

model Product {
  id               String   @id @default(cuid())
  attractionId     String?
  attraction       Attraction? @relation(fields:[attractionId], references:[id])
  partner          String   // "viator" | "getyourguide" | "klook"
  partnerProductId String
  title            String
  description      String?
  priceFromAud     Decimal?
  variants         Json     // [{name,price,availability}] — extensible for Phase 2
  affiliateUrlTemplate String // template with {ref} placeholder
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([partner, partnerProductId])
}

model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String?
  authProvider   String   // "google" | "apple" | "credentials"
  authProviderId String
  preferences    UserPreferences?
  itineraries    SavedItinerary[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([authProvider, authProviderId])
}

model UserPreferences {
  userId        String  @id
  user          User    @relation(fields:[userId], references:[id], onDelete:Cascade)
  partyType     String  // "family" | "couple" | "solo" | "group"
  childrenAges  Int[]   // array of ages
  preferences   Json    // {preferFree:bool, maxDetourKm:int, ...}
  updatedAt     DateTime @updatedAt
}

model SavedItinerary {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields:[userId], references:[id], onDelete:Cascade)
  title           String
  origin          String   // "Sydney, NSW"
  destination     String   // "Brisbane, QLD"
  routeGeometry   Json     // GeoJSON LineString
  stops           Json     // StopoverSlot[]
  isPublic        Boolean  @default(false)
  shareSlug       String?  @unique // for public share URLs
  ogImageUrl      String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model AffiliateClick {
  id        String   @id @default(cuid())
  userId    String?  // nullable for anonymous clicks
  productId String
  partner   String
  refToken  String   // HMAC-signed opaque token
  clickedAt DateTime @default(now())
  ipHash    String   // SHA-256 of client IP — not PII

  @@index([clickedAt])
  @@index([partner, clickedAt])
  // No UPDATE or DELETE operations permitted on this table
}
```

**PostGIS spatial index** (raw SQL migration, applied after Prisma baseline):
```sql
ALTER TABLE "Attraction" ADD COLUMN geom geometry(Point, 4326);
CREATE INDEX attractions_geom_idx ON "Attraction" USING GIST (geom);
-- On insert/update, populate geom:
-- UPDATE "Attraction" SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326);
```

**Quality score calculation (NFR-011):**
```typescript
function computeQualityScore(a: RawAttraction): number {
  const required = ['name','lat','lon','description'] as const;
  const enrichment = ['openingHours','demographicTags.toilet','demographicTags.parking',
                      'demographicTags.accessibility'] as const;
  const reqScore = required.filter(f => !!a[f]).length / required.length;
  const enrichScore = enrichment.filter(f => getPath(a,f)).length / enrichment.length;
  return reqScore * 0.6 + enrichScore * 0.4;
}
```

### 2. Route Generation Service (`services/route`)

**Detailed interface:**

```typescript
// services/route/types.ts
export interface ItineraryRequest {
  origin: { lat: number; lon: number; label: string };
  destination: { lat: number; lon: number; label: string };
  party: {
    type: 'family' | 'couple' | 'solo' | 'group';
    adults: number;
    children?: { age: number }[];
  };
  preferences?: {
    maxDetourKm?: number;   // default: 20
    preferFree?: boolean;   // default: false
  };
}

export interface StopoverSlot {
  index: number;
  point: { lat: number; lon: number };
  driveTimeFromPrevious: number;  // minutes
  distanceFromPrevious: number;   // km
  nearbyTown?: string;
  pois: RankedPOI[];
}

export interface RankedPOI {
  attraction: Attraction;
  score: number;          // 0-1 ranking score
  distanceKm: number;
  products: Product[];    // available bookable products
}

export interface ItineraryPlan {
  id: string;
  origin: string;
  destination: string;
  totalDistanceKm: number;
  totalDriveHours: number;
  routePolyline: string;  // encoded polyline
  stops: StopoverSlot[];
  generatedAt: Date;
}
```

**Route generation algorithm:**

```typescript
class RouteGenerationService {
  async generateItinerary(req: ItineraryRequest): Promise<ItineraryPlan> {
    // 1. Check cache
    const cacheKey = this.buildCacheKey(req);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // 2. Fetch route geometry from Google Maps
    const route = await this.mapsClient.directions({
      origin: req.origin, destination: req.destination, mode: 'driving'
    });

    // 3. Sample stopover points every ~120min drive time
    const stopsPoints = sampleByDriveTime(route.polyline, route.legs, 120);

    // 4. For each stop: fetch nearby POIs via PostGIS
    const stops = await Promise.all(stopsPoints.map(async (point, i) => {
      const radius = req.preferences?.maxDetourKm ?? 20;
      const pois = await this.db.$queryRaw`
        SELECT a.*, ST_Distance(
          a.geom::geography,
          ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography
        ) as distance_m
        FROM "Attraction" a
        WHERE ST_DWithin(
          a.geom::geography,
          ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography,
          ${radius * 1000}
        )
        ORDER BY distance_m
        LIMIT 50
      `;

      // 5. Apply demographic filter
      const filtered = applyDemographicFilter(pois, req.party);

      // 6. Score and rank
      const ranked = filtered.map(poi => ({
        attraction: poi,
        score: scoreAttractionForParty(poi, req.party),
        distanceKm: poi.distance_m / 1000,
        products: [] // enriched separately
      })).sort((a,b) => b.score - a.score).slice(0, 5);

      return { index: i, point, driveTimeFromPrevious: 120, ...ranked };
    }));

    // 7. Cache and return
    const plan: ItineraryPlan = { ...route, stops, generatedAt: new Date() };
    await this.redis.setex(cacheKey, 3600, JSON.stringify(plan));
    return plan;
  }
}
```

**Demographic scoring function:**
```typescript
function scoreAttractionForParty(poi: Attraction, party: Party): number {
  let score = poi.qualityScore * 0.4;  // base quality

  if (party.type === 'family' && party.children?.length) {
    if (poi.demographicTags.playground) score += 0.3;
    if (poi.demographicTags.toilet) score += 0.15;
    if (poi.demographicTags.parentRoom) score += 0.15;
  }
  if (party.type === 'couple' || party.type === 'solo') {
    if (!poi.isFree && poi.products.length) score += 0.2;  // prefer bookable
  }
  if (poi.isFree) score += 0.1;  // slight boost for free content (mixed display)

  return Math.min(score, 1.0);
}
```

**Error handling:**
- Google Maps API timeout (>5s): return cached fallback or `504 Route generation unavailable`
- PostGIS query timeout (>3s): return empty stops array, flag in response
- Redis unavailable: bypass cache, log warning, proceed

### 3. POI Data Layer (`services/poi`)

**Adapter interface:**
```typescript
// services/poi/adapter.ts
export interface POISourceAdapter {
  name: string;
  version: string;
  schedule: string;  // cron expression
  fetchUpdates(since?: Date): AsyncGenerator<RawPOI>;
  normalise(raw: RawPOI): NormalisedAttraction;
  validate(normalised: NormalisedAttraction): ValidationResult;
}

export interface NormalisedAttraction {
  source: string;
  sourceId: string;
  name: string;
  lat: number;
  lon: number;
  categories: string[];
  openingHours?: Record<string, string>;
  isFree: boolean;
  demographicTags: DemographicTags;
  description?: string;
}
```

**Phase 1 adapters:**

```typescript
// services/poi/adapters/national-parks-au.ts
class NationalParksAUAdapter implements POISourceAdapter {
  name = 'national_parks_au';
  schedule = '0 3 * * *'; // daily 3am AEST

  async *fetchUpdates(since?: Date): AsyncGenerator<RawPOI> {
    // Fetches GeoJSON from data.gov.au national parks API
    // Yields one RawPOI per park feature
  }

  normalise(raw: RawPOI): NormalisedAttraction {
    return {
      source: this.name,
      sourceId: raw.properties.id,
      name: raw.properties.park_name,
      lat: raw.geometry.coordinates[1],
      lon: raw.geometry.coordinates[0],
      categories: ['national_park', 'attraction'],
      isFree: false,  // some parks charge entry
      demographicTags: {
        family: true,
        children: true,
        toilet: raw.properties.has_toilets ?? false,
        parking: raw.properties.has_parking ?? false,
        accessibility: raw.properties.wheelchair_accessible ?? false,
      }
    };
  }
}
```

**Ingestion pipeline:**
```typescript
// workers/poi-ingest/index.ts
async function runIngestionJob(adapter: POISourceAdapter) {
  const since = await getLastRunTime(adapter.name);
  let upserted = 0, failed = 0;

  for await (const raw of adapter.fetchUpdates(since)) {
    try {
      const normalised = adapter.normalise(raw);
      const quality = computeQualityScore(normalised);

      await db.attraction.upsert({
        where: { source_sourceId: { source: normalised.source, sourceId: normalised.sourceId } },
        update: { ...normalised, qualityScore: quality, lastIngestedAt: new Date() },
        create: { ...normalised, qualityScore: quality, lastIngestedAt: new Date() }
      });

      // Queue Meilisearch sync
      await meilisearchSyncQueue.add({ attractionId: normalised.sourceId });
      upserted++;
    } catch (err) {
      logger.error({ adapter: adapter.name, raw, err }, 'POI normalisation failed');
      failed++;
    }
  }

  await updateLastRunTime(adapter.name, new Date());
  return { upserted, failed };
}
```

### 4. Affiliate Module (`services/affiliate`)

**Link generation:**
```typescript
// services/affiliate/index.ts
const AFFILIATE_CONFIGS = {
  viator: {
    urlTemplate: 'https://www.viator.com/tours/{productId}?pid={pid}&mcid={mcid}',
    pid: process.env.VIATOR_PID,
    mcid: process.env.VIATOR_MCID,
  },
  getyourguide: {
    urlTemplate: 'https://www.getyourguide.com/-{productId}/?partner_id={partnerId}',
    partnerId: process.env.GYG_PARTNER_ID,
  },
  klook: {
    urlTemplate: 'https://www.klook.com/activity/{productId}/?aid={aid}',
    aid: process.env.KLOOK_AID,
  }
} as const;

class AffiliateService {
  generateLink(params: { partner: AffiliatePartner; productId: string; userId?: string }): string {
    const config = AFFILIATE_CONFIGS[params.partner];
    const partnerUrl = buildPartnerUrl(config, params.productId);

    // Create HMAC-signed ref token
    const payload = JSON.stringify({
      p: params.partner,
      pid: params.productId,
      uid: params.userId ?? null,
      exp: Date.now() + 86400000, // 24h expiry
    });
    const ref = signPayload(payload, process.env.AFFILIATE_SECRET!);
    const encodedUrl = encodeURIComponent(partnerUrl);

    return `/api/affiliate/redirect?ref=${ref}&dest=${encodedUrl}`;
  }

  async logClick(req: Request, productId: string, partner: string, ref: string): Promise<void> {
    const ipHash = hashIp(req.headers.get('x-forwarded-for') ?? '');
    await db.affiliateClick.create({
      data: {
        userId: getSessionUserId(req),
        productId,
        partner,
        refToken: ref,
        ipHash,
      }
    });
  }
}
```

**Redirect API route:**
```typescript
// apps/web/app/api/affiliate/redirect/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ref = searchParams.get('ref');
  const dest = searchParams.get('dest');

  if (!ref || !dest) return new Response('Bad Request', { status: 400 });

  // Validate HMAC signature and expiry
  const payload = verifyPayload(ref, process.env.AFFILIATE_SECRET!);
  if (!payload || payload.exp < Date.now()) {
    return new Response('Invalid or expired link', { status: 410 });
  }

  // Log click (fire-and-forget to avoid latency)
  affiliateService.logClick(request, payload.pid, payload.p, ref).catch(logger.error);

  const destination = decodeURIComponent(dest);
  // Safety check: must be a known affiliate domain
  if (!isAllowedAffiliateHost(new URL(destination).hostname)) {
    return new Response('Forbidden', { status: 403 });
  }

  return Response.redirect(destination, 302);
}
```

### 5. User & Auth Module (`services/user`)

**NextAuth.js configuration:**
```typescript
// apps/web/auth.ts
export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    // Apple, Facebook: add as COULD providers
  ],
  adapter: PrismaAdapter(db),
  session: { strategy: 'jwt', maxAge: 30 * 24 * 3600 },  // 30 day JWT
  callbacks: {
    async session({ session, token }) {
      session.user.id = token.sub!;
      return session;
    },
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
};
```

**User service:**
```typescript
class UserService {
  async getProfile(userId: string): Promise<UserProfile | null> {
    return db.user.findUnique({
      where: { id: userId },
      include: { preferences: true }
    });
  }

  async updatePreferences(userId: string, prefs: Partial<UserPreferences>): Promise<void> {
    await db.userPreferences.upsert({
      where: { userId },
      update: { ...prefs, updatedAt: new Date() },
      create: { userId, ...prefs }
    });
  }

  async saveItinerary(userId: string, plan: ItineraryPlan, title: string): Promise<string> {
    const shareSlug = nanoid(10);
    const saved = await db.savedItinerary.create({
      data: {
        userId,
        title,
        origin: plan.origin,
        destination: plan.destination,
        routeGeometry: plan.routePolyline as any,
        stops: plan.stops as any,
        isPublic: false,
        shareSlug,
      }
    });
    return saved.id;
  }

  async deleteUser(userId: string): Promise<void> {
    // Privacy Act 1988 / GDPR-like right to erasure
    // Affiliate clicks: anonymise rather than delete (audit requirement)
    await db.$transaction([
      db.affiliateClick.updateMany({
        where: { userId },
        data: { userId: null }
      }),
      db.user.delete({ where: { id: userId } })
      // Cascade: savedItineraries, preferences deleted via Prisma cascades
    ]);
  }
}
```

### 6. Content & SEO Module (`services/content`)

**Page generation with ISR:**
```typescript
// apps/web/app/destination/[slug]/page.tsx
export const revalidate = 3600; // ISR: revalidate every hour

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const dest = await contentService.getDestination(params.slug);
  return {
    title: `${dest.name} Road Trip Guide | RoadTrip Experiences`,
    description: dest.seoMeta?.description,
    openGraph: {
      images: [dest.seoMeta?.ogImage],
      type: 'website',
    },
    alternates: { canonical: `https://roadtripexperiences.com.au/destination/${params.slug}` },
  };
}

export default async function DestinationPage({ params }) {
  const dest = await contentService.getDestination(params.slug);
  const nearbyAttractions = await contentService.getNearbyAttractions(dest);
  const affiliateProducts = await contentService.getAffiliateProducts(dest);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{__html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "TouristDestination",
          "name": dest.name,
          "geo": { "@type": "GeoCoordinates", "latitude": dest.lat, "longitude": dest.lon }
        })}}
      />
      {/* Page content */}
    </>
  );
}
```

**Display advertising (FR-010):**
```typescript
// Placeholder AdSlot component — wired to Google AdSense script
// In <head>: <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js">
// AdSlot: <ins class="adsbygoogle" data-ad-slot="SLOT_ID" />
// Revenue tracking: AdSense dashboard (no custom tracking needed at Phase 1)
```

### 7. Background Job Worker (`workers`)

**BullMQ queues:**
```typescript
// workers/queues.ts
export const poiIngestQueue = new Queue('poi-ingest', { connection: redis });
export const meilisearchSyncQueue = new Queue('meilisearch-sync', { connection: redis });
export const affiliateReportQueue = new Queue('affiliate-report', { connection: redis });

// Recurring jobs (registered at startup)
await poiIngestQueue.add('daily-ingest', {}, {
  repeat: { cron: '0 3 * * *' },  // 3am AEST daily
  removeOnComplete: 100,
  removeOnFail: 50,
});
```

**Meilisearch sync worker:**
```typescript
meilisearchSyncWorker.process(async (job) => {
  const attraction = await db.attraction.findUnique({ where: { id: job.data.attractionId } });
  if (!attraction) return;

  await meiliIndex.addDocuments([{
    id: attraction.id,
    name: attraction.name,
    description: attraction.description,
    categories: attraction.categories,
    _geo: { lat: attraction.lat, lng: attraction.lon },
    isFree: attraction.isFree,
    qualityScore: attraction.qualityScore,
    demographicTags: attraction.demographicTags,
  }]);
});
```

## Interfaces

### API Route Summary (Next.js App Router)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/itinerary/generate` | optional | Generate road-trip itinerary |
| POST | `/api/itinerary/save` | required | Save itinerary to user account |
| GET | `/api/itinerary/[id]` | optional | Load saved itinerary |
| GET | `/api/poi/search` | none | Search POIs by location/category |
| GET | `/api/affiliate/redirect` | none | Tracked affiliate redirect |
| GET | `/api/user/profile` | required | Get user profile + preferences |
| PATCH | `/api/user/preferences` | required | Update party preferences |
| DELETE | `/api/user` | required | Delete account (Privacy Act) |
| GET | `/api/admin/jobs` | admin | BullMQ job status dashboard |

### Environment Variables

```typescript
// packages/config/env.ts (Zod-validated at startup)
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MEILISEARCH_URL: z.string().url(),
  MEILISEARCH_KEY: z.string(),
  GOOGLE_MAPS_API_KEY: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url(),
  AFFILIATE_SECRET: z.string().min(32),  // HMAC signing key
  VIATOR_PID: z.string().optional(),
  VIATOR_MCID: z.string().optional(),
  GYG_PARTNER_ID: z.string().optional(),
  KLOOK_AID: z.string().optional(),
  NEXT_PUBLIC_ADSENSE_ID: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']),
});
```

### Error Handling Strategy

| Error Class | HTTP Status | Behaviour |
|-------------|-------------|-----------|
| Validation error (Zod) | 422 | Return field-level errors |
| Auth required | 401 | Redirect to `/auth/signin` |
| Not found | 404 | Next.js notFound() |
| Google Maps timeout | 504 | Return cached fallback; log |
| DB connection failure | 503 | Retry 3x with backoff; log critical |
| PostGIS query timeout | 200 | Return empty stops; flag `partial: true` |
| Affiliate link invalid | 410 | Return "Link expired" page |
| Secret in query param | 400 | Reject; log security event |

### Observability

**Logging:** Pino JSON logger. Fields: `{ level, time, msg, traceId, userId?, task? }`.

**Metrics (Phase 1 — application-level):**
- `itinerary_generation_duration_ms` — histogram
- `poi_ingest_count` — counter (upserted, failed)
- `affiliate_clicks_total` — counter by partner
- `page_lcp_ms` — via Vercel Analytics or self-hosted Prometheus + Grafana

**Trace ID:** Injected via `x-trace-id` header or `crypto.randomUUID()` at request boundary. Propagated to all log lines in the same request.

**Health endpoints:**
- `GET /api/health` — liveness (returns `{status:"ok"}`)
- `GET /api/health/ready` — readiness (checks DB + Redis + Meilisearch connectivity)

## Technical Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Google Maps API quota exhaustion | Medium | High | Cache route geometry in Redis (TTL 24h); implement backoff |
| OSM Overpass API rate limiting | Medium | Medium | Adaptive fetch delay; run overnight; cache raw responses |
| PostGIS spatial query performance at scale | Low | High | GIST index on geom; query with bbox pre-filter before radius |
| Meilisearch index out of sync | Low | Medium | Hourly sync job + manual re-index CLI command |
| Affiliate link token leakage | Low | High | HMAC validation; 24h expiry; referer check |
| Privacy Act non-compliance | Low | High | IP hashing; `deleteUser` API; no PII in logs |
| Phase 2 schema migration | Low | Medium | `variants jsonb` allows Phase 2 extension without breaking Phase 1 |
