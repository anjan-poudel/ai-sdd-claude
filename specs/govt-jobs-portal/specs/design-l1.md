# GovJobs Portal — L1 System Architecture

## Overview

GovJobs Portal is a purpose-built Australian government job aggregation platform. It ingests job listings from government REST APIs and web scraping, indexes them in ElasticSearch for fast search and discovery, delivers fine-grained job alerts via email and push, and surfaces preparation content and agency reviews alongside listings.

The system is architecturally divided into three isolation zones:

1. **Scraping Infrastructure** — async, queue-driven scrapers completely isolated from the web API
2. **Core Platform** — web API, search, notifications, user accounts, and CMS
3. **Batch Workers** — vector embedding computation and search index sync (not on ingest hot path)

This isolation enforces FR-001's "scraping workload must not block or degrade web API response times" and the constitution's architecture constraint that "scraping infrastructure must be isolated from the web API (separate ECS services)."

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AWS Cloud (ECS Fargate)                     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Scraping Zone (separate ECS service cluster)               │   │
│  │                                                             │   │
│  │  ┌─────────────┐    ┌────────────────┐  ┌──────────────┐  │   │
│  │  │  Scheduler  │───▶│  Bull/BullMQ   │─▶│  Scraper     │  │   │
│  │  │  (Cron+DB   │    │  (Redis AOF)   │  │  Workers     │  │   │
│  │  │   config)   │    │                │  │  (Playwright)│  │   │
│  │  └─────────────┘    └────────────────┘  └──────┬───────┘  │   │
│  │                                                 │          │   │
│  └─────────────────────────────────────────────────┼──────────┘   │
│                                                     │              │
│  ┌──────────────────────────────────────────────────▼──────────┐  │
│  │  Core Platform Zone                                          │  │
│  │                                                              │  │
│  │  ┌────────────┐   ┌────────────┐   ┌─────────────────────┐ │  │
│  │  │  Web API   │   │  MongoDB   │   │   ElasticSearch      │ │  │
│  │  │  (Node.js/ │──▶│  (Atlas /  │   │   (AWS OpenSearch)   │ │  │
│  │  │  Express)  │   │   DocDB)   │   │                     │ │  │
│  │  └─────┬──────┘   └─────┬──────┘   └──────────▲──────────┘ │  │
│  │        │                │                      │            │  │
│  │        │          ┌─────▼──────┐        ┌──────┴──────────┐ │  │
│  │        │          │  Ingest    │        │  Sync Worker    │ │  │
│  │        │          │  Service   │        │  (ES indexer)   │ │  │
│  │        │          └────────────┘        └─────────────────┘ │  │
│  │        │                                                      │  │
│  │  ┌─────▼──────┐   ┌────────────────┐   ┌─────────────────┐ │  │
│  │  │  Auth      │   │  Notification  │   │  Vector Worker  │ │  │
│  │  │  Service   │   │  Worker        │   │  (Embeddings    │ │  │
│  │  │ (JWT+OAuth)│   │ (SES + FCM)   │   │   Weaviate/     │ │  │
│  │  └────────────┘   └────────────────┘   │   Pinecone)     │ │  │
│  │                                         └─────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Frontend Zone (Vercel / CloudFront)                        │    │
│  │  Next.js SSR + CSR  ←──────  CDN / Edge Cache              │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Scraper Scheduler

**Responsibility:** Reads scraper source configurations from MongoDB, determines which sources are due based on their stored cron expression (FR-001: "configurable per-source scrape schedules"), and enqueues jobs into Bull/BullMQ.

**Key design decisions:**
- Polls MongoDB every 5 minutes to detect config changes (FR-001, FR-008: schedule changes active within 5 minutes, no redeployment)
- Computes per-source next-run using `cron-parser` against the stored cron expression
- Manages expiry-tracking: enqueues high-frequency re-scan jobs for records within the 72h pre-expiry and 48h post-expiry windows (FR-001)
- Does not run scraping code directly — only enqueues

**Error handling:** Scheduler failures are logged; individual source evaluation errors do not abort the cycle (NFR-003: per-source isolation).

**Config:** `SOURCE_POLL_INTERVAL_SECONDS` (default: 300); `EXPIRY_PRESCAN_HOURS` (default: 72); `EXPIRY_POSTSCAN_HOURS` (default: 48).

---

### 2. Scraper Workers (ECS Service: `scraper-worker`)

**Responsibility:** Process Bull/BullMQ jobs, fetch job listings from source APIs or web pages, and write canonical job records to the Ingest Service.

**Key design decisions:**
- Deployed as a separate ECS Fargate service — never shares compute with the web API (architecture constraint)
- Uses Playwright with stealth plugins for browser-based boards; `node-fetch` for REST API sources
- Before each request: fetches and parses `robots.txt`; aborts if path is disallowed (NFR-005)
- Enforces minimum inter-request delay: `Crawl-delay` from `robots.txt` if present, otherwise 2 seconds default (NFR-005)
- User-Agent identifies the bot (NFR-005: "scraper User-Agent must identify the bot")
- Retry: up to 3 times with exponential backoff (starting 30s, doubling) before marking job failed (NFR-003)
- Horizontal scaling: multiple ECS tasks consume from the shared BullMQ queue; BullMQ locks prevent double-processing (NFR-002)

**Concurrency:** Each ECS task processes one job at a time per Playwright browser instance; concurrency controlled at queue level.

**Error paths:**
- `robots.txt` disallowed → log reason, mark job skipped (not failed)
- HTTP 4xx from source → log, mark failed (no retry)
- HTTP 5xx / network timeout → retry with backoff
- Playwright crash → task restarts via ECS health check

---

### 3. Ingest Service

**Responsibility:** Receives parsed job data from Scraper Workers and writes canonical job records to MongoDB. Performs deduplication before write.

**Key design decisions:**
- Deduplication: matching by composite key (agency name + job title + location + classification); fuzzy matching for near-duplicates; accuracy target >99% (FR-001)
- Canonical record: single document in MongoDB `jobs` collection; `sources` array accumulates all source URLs (FR-001: "source attribution list")
- After write: publishes a `job.upserted` event to an internal event bus (or BullMQ topic) for downstream consumers (Search Sync Worker, Notification Worker)
- All writes use MongoDB transactions to ensure atomicity of the upsert + source attribution update

**Data model (canonical job record, abbreviated):**

```
{
  _id: ObjectId,
  title: string,
  agency: string,
  location: string,
  classification: string,
  salary_band: { min: number, max: number },
  description: string,
  expiry_date: Date | null,
  status: "active" | "expired",
  sources: [{ url: string, type: "api" | "scrape", name: string, last_seen: Date }],
  created_at: Date,
  updated_at: Date
}
```

---

### 4. Web API (ECS Service: `api`)

**Responsibility:** Serves the Next.js frontend and external clients. Handles job search, user accounts, saved jobs, saved searches, alert subscriptions, CMS admin, and notification preferences.

**Technology:** Node.js (TypeScript), Express (or Fastify). REST endpoints; GraphQL adoption deferred (open decision from requirements).

**REST API surface (top-level paths):**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs/search` | Keyword + faceted search via ElasticSearch |
| GET | `/api/jobs/:id` | Job detail (from MongoDB or ES) |
| GET | `/api/agencies/:id` | Agency profile + reviews |
| POST | `/api/auth/register` | Email/password registration |
| POST | `/api/auth/login` | Email/password login → JWT |
| POST | `/api/auth/oauth/google` | Google OAuth2 callback |
| POST | `/api/auth/oauth/linkedin` | LinkedIn OAuth2 callback |
| POST | `/api/auth/refresh` | Refresh JWT access token |
| GET/POST/DELETE | `/api/users/me/saved-jobs` | Saved jobs CRUD |
| GET/POST/DELETE | `/api/users/me/saved-searches` | Saved searches CRUD |
| GET/POST/PATCH/DELETE | `/api/users/me/alerts` | Alert subscriptions CRUD |
| PATCH | `/api/users/me/preferences` | Notification preferences |
| DELETE | `/api/users/me` | Account + PII deletion (30-day SLA) |
| GET/POST/PATCH/DELETE | `/api/admin/sources` | Scraper source config (admin only) |
| GET/POST/PATCH/DELETE | `/api/admin/content` | CMS content (admin only) |
| GET | `/api/admin/health` | Scraper health dashboard data |
| GET/PATCH | `/api/admin/reviews` | Review moderation queue (admin only) |

**Auth:** JWT access token (15-minute lifetime); refresh token (30-day lifetime, HTTP-only cookie). RBAC: `user` and `admin` roles; enforced via Express middleware on every route (NFR-004).

**Error paths:**
- Expired JWT → 401 Unauthorized
- Admin endpoint accessed by non-admin → 403 Forbidden
- ElasticSearch unavailable → 503 with user-friendly message (NFR-003: graceful degraded mode)
- PII fields beyond permitted set stripped in request validation layer; never stored or logged (NFR-004)

**Concurrency:** Stateless; multiple ECS tasks behind ALB. Session state held in JWT (no server-side session store needed).

**Timeouts:** `API_REQUEST_TIMEOUT_MS` (default: 5000); configurable via environment.

---

### 5. Auth Service (module within Web API)

**Responsibility:** Handles registration, login, OAuth2 flows, JWT issuance, token refresh, and password hashing.

**Key design decisions:**
- Passwords hashed with bcrypt (cost 12) or argon2id — never stored plain text (FR-007, NFR-004)
- OAuth2: Google and LinkedIn; user record links `provider` + `provider_id`; creates account on first sign-in
- JWT access tokens: RS256 signed; 15-minute lifetime; transmitted in the `Authorization: Bearer <jwt>` HTTP header (NFR-004)
- Refresh tokens: stored as a hashed value in MongoDB `refresh_tokens` collection; 30-day expiry; rotated on use
- PII stored: email (required for notifications), display name (optional), OAuth identifiers, notification preferences (NFR-004)

---

### 6. ElasticSearch Sync Worker (ECS Service: `es-sync-worker`)

**Responsibility:** Consumes `job.upserted` events and syncs changes to the ElasticSearch (AWS OpenSearch) index within 60 seconds of MongoDB write (FR-002, NFR-001).

**Key design decisions:**
- ElasticSearch is the read model; MongoDB is the source of truth (architecture constraint)
- Index mappings are versioned; migrations are reversible (quality standard)
- Mapping version tracked in a dedicated `es_schema_versions` MongoDB collection
- Bulk indexing where possible to meet throughput targets

**Error paths:**
- ES unavailable: events accumulate in BullMQ; retry with backoff; dead-letter after 3 failures
- Mapping conflict: migration script must be run; worker emits alert metric

---

### 7. Vector Embedding Worker (ECS Service: `vector-worker`)

**Responsibility:** Computes vector embeddings for job descriptions and upserts them into the vector database (Weaviate or Pinecone). Runs as a separate batch worker — never on the ingestion hot path (FR-002, architecture constraint).

**Key design decisions:**
- Triggered by `job.upserted` events (deduplicated with a 5-minute debounce window to batch updates)
- Embeddings model: configurable via `EMBEDDING_MODEL` env var (default: OpenAI `text-embedding-3-small`)
- Vector DB: abstract interface — concrete implementation selectable via `VECTOR_DB_PROVIDER` config
- Semantic search queries routed via Web API: API calls Vector DB for top-K similar job IDs, then fetches those records from ElasticSearch for full document enrichment

---

### 8. Notification Worker (ECS Service: `notification-worker`)

**Responsibility:** Processes notification tasks enqueued after job ingestion, matches against user alert subscriptions, and dispatches email (AWS SES) and push (FCM) notifications within 15 minutes of ingestion (FR-003, NFR-001).

**Key design decisions:**
- Alert matching runs against MongoDB `alerts` collection using indexed query on subscription criteria fields
- Notification tasks are deduplicated per (alert_id, job_id) to prevent duplicate sends
- Delivery retry: up to 3 attempts with exponential backoff; dead-letter queue for permanent failures (NFR-003)
- Asynchronous: all delivery is queue-driven; Web API never blocks on notification send (FR-003)
- Throughput target: 10,000 emails per hour (NFR-002); horizontal scaling via additional ECS tasks
- Expiry reminder scheduler: daily job scans MongoDB for saved jobs expiring in ≤48h; enqueues reminder tasks

**Error paths:**
- SES delivery failure → retry; after 3 failures → dead-letter queue; do not retry indefinitely
- FCM token expired → remove token from user record; no further push for that device
- Alert not found (deleted between enqueue and process) → skip silently, no error

---

### 9. Frontend (Next.js — Vercel / CloudFront)

**Responsibility:** Server-side rendered (SSR) + client-side rendered (CSR) web portal. Job search, listing detail, agency profiles, user account pages, preparation content, and admin CMS UI.

**Key design decisions:**
- SSR for job listing and search pages (SEO critical; FCP target <2s on 4G — NFR-001)
- CSR for account management, saved jobs, alerts, and admin pages
- Ad units (Google AdSense) loaded asynchronously; no blocking render (FR-006, NFR-001)
- Privacy Policy link in every page footer (NFR-005)
- No PII stored client-side beyond JWT in-memory and refresh token in HTTP-only cookie

---

### 10. Admin CMS (integrated into Frontend + Web API)

**Responsibility:** Provides admin-only UI for scraper source management, content publishing, review moderation, and health dashboards (FR-008).

**Key design decisions:**
- Separate Next.js route namespace `/admin/*`; all routes guarded by admin RBAC check
- Health dashboard polls `/api/admin/health` every 60 seconds; data must be ≤5 minutes stale (FR-008)
- Scraper config changes effective within 5 minutes via Scheduler's MongoDB polling cycle (FR-001, FR-008)
- No code deployment required for any admin action (FR-008 constraint)

---

### 11. MongoDB (AWS DocumentDB or Atlas)

**Responsibility:** Source of truth for all persistent data.

**Collections:**

| Collection | Description |
|------------|-------------|
| `jobs` | Canonical job records |
| `sources` | Scraper source configurations (including cron schedule) |
| `users` | User accounts, roles, OAuth identities |
| `refresh_tokens` | Hashed refresh tokens (TTL index: 30 days) |
| `saved_jobs` | User ↔ job many-to-many |
| `saved_searches` | User saved search criteria |
| `alerts` | User alert subscriptions |
| `notifications` | Notification history (TTL index: 90 days) |
| `content` | CMS articles / preparation guides |
| `agency_reviews` | Internal user-submitted reviews (status: pending/approved/rejected) |
| `es_schema_versions` | ElasticSearch mapping version tracking |
| `scraper_runs` | Per-source run history (for health dashboard) |

**Reliability:** 3-node replica set; primary election within 30 seconds of node failure; no data loss on single-node failure (NFR-003).

**PII fields:** `email`, `display_name` (optional), `oauth_provider`, `oauth_id`, `notification_preferences`. No further PII stored (NFR-004, NFR-005).

---

### 12. Redis (AWS ElastiCache)

**Responsibility:** Bull/BullMQ job queue backing store; scheduler lock mechanism.

**Key design decisions:**
- AOF persistence enabled (NFR-003: "BullMQ jobs persisted with Redis AOF")
- Dedicated Redis instance separate from any application caching
- Scraper jobs, notification tasks, and ES sync events are separate BullMQ queues with separate concurrency settings

---

## Infrastructure Topology (Docker / ECS Services)

| ECS Service | Image | Scaling | Notes |
|-------------|-------|---------|-------|
| `api` | `gobjobs-api` | Horizontal (ALB) | Stateless; min 2 tasks |
| `scraper-worker` | `gobjobs-scraper` | Horizontal (queue depth) | Isolated from API |
| `es-sync-worker` | `gobjobs-es-sync` | Horizontal | Triggered by job events |
| `vector-worker` | `gobjobs-vector` | Horizontal (batch) | Low-priority, burstable |
| `notification-worker` | `gobjobs-notify` | Horizontal | min 2 tasks for HA |
| `scheduler` | `gobjobs-scheduler` | Single task (leader election) | Runs cron + expiry logic |
| `frontend` | Vercel / CloudFront | CDN-managed | Next.js |

All backend services deployed to AWS ECS Fargate. Container images in AWS ECR. Secrets stored in AWS Secrets Manager — never in environment files or logs (NFR-004).

---

## Auth Strategy

- **Registration:** Email + password (bcrypt/argon2id, cost ≥12). Email verification required.
- **Social sign-in:** OAuth2 via Google and LinkedIn (FR-007).
- **Token model:** JWT RS256 access token (15 min) + HTTP-only refresh token cookie (30 days) (NFR-004).
- **RBAC:** `user` and `admin` roles enforced at API middleware layer. Role is embedded in JWT; admin endpoints double-check against MongoDB to prevent stale-token privilege escalation (NFR-004).
- **PII stored:** email, display name (optional), OAuth identifiers, notification preferences. All other fields rejected at API input validation (NFR-004).
- **Account deletion:** Triggers async job to remove email, display name, saved jobs, saved searches, alerts, and reviews within 30 days (NFR-005).

---

## Key Architectural Decisions

### ADR-001: Scraper isolation via separate ECS service
**Decision:** Scraper workers run in a dedicated ECS Fargate service cluster, sharing no compute with the web API.
**Rationale:** FR-001 acceptance criteria explicitly require scraper load not to degrade API response times. Separate services enforce this at the infrastructure level, independent of application code.

### ADR-002: ElasticSearch as read model, MongoDB as source of truth
**Decision:** All job mutations go to MongoDB first; ElasticSearch is populated asynchronously by the ES Sync Worker.
**Rationale:** This is an explicit architecture constraint from the constitution. It allows MongoDB to provide strong consistency guarantees while ElasticSearch provides query performance. The 60-second sync SLA (NFR-001, FR-002) is achievable via BullMQ event-driven sync.

### ADR-003: Vector embeddings are batch-only (not on ingest hot path)
**Decision:** The Vector Worker is a separate ECS service that consumes events asynchronously; no embedding computation occurs during job ingestion.
**Rationale:** FR-002 explicitly states "Vector embeddings must be computed by a separate batch worker and must not run on the ingestion hot path." Semantic search is best-effort and latency-tolerant; it does not affect ingestion throughput.

### ADR-004: Queue-driven notification delivery
**Decision:** All notifications (job alerts, expiry reminders) go through BullMQ before delivery via SES/FCM.
**Rationale:** FR-003 requires asynchronous, queue-driven delivery. BullMQ provides retry semantics, dead-letter queues (NFR-003), and throughput scalability to 10,000 emails/hour (NFR-002).

### ADR-005: DB-driven scraper configuration
**Decision:** All scraper source configs (URL, type, cron schedule) are stored in MongoDB; the Scheduler polls every 5 minutes.
**Rationale:** FR-001 and FR-008 require schedule changes to take effect without code redeployment. The 5-minute polling interval satisfies both FRs' "within 5 minutes" requirement.

### ADR-006: robots.txt checked before every scrape
**Decision:** Scraper Workers fetch and parse `robots.txt` before making any request to a target domain. Disallowed paths are skipped and logged; no content is stored.
**Rationale:** NFR-005 compliance requirement; also protects against legal and ToS risk (requirements open decision on LinkedIn/Glassdoor).

### ADR-007: Graceful degraded mode when ElasticSearch is unavailable
**Decision:** If the ES client throws a connection error, the Web API returns HTTP 503 with a user-friendly message rather than a 500 or blank page.
**Rationale:** NFR-003 explicitly requires this behaviour. MongoDB is not queried as a search fallback because it cannot meet the p95 500ms search SLA.

### ADR-008: LinkedIn and Glassdoor scraping deferred to runtime configuration
**Decision:** LinkedIn and Glassdoor are modelled as configurable scraper sources with an `enabled` flag; they are disabled by default pending legal/ToS review.
**Rationale:** Open decisions #2 and #3 from requirements. The architecture must support them but must not activate them until ToS compliance is confirmed. The `robots.txt` check (ADR-006) and the `enabled` flag in source config are the enforcement mechanisms.

---

## Component Interaction Diagram (Ingest Flow)

```
Scheduler
    │ enqueue(source_id, url)
    ▼
BullMQ (scrape-queue)
    │ dequeue
    ▼
Scraper Worker
    │ robots.txt OK?  ──No──▶  skip + log
    │ Yes
    │ fetch/scrape page
    │ parse listings
    │ POST /internal/ingest (list of raw jobs)
    ▼
Ingest Service
    │ deduplicate (composite key + fuzzy match)
    │ upsert MongoDB jobs collection
    │ publish job.upserted events
    ├──▶ BullMQ (es-sync-queue)
    │        │
    │        ▼
    │   ES Sync Worker ──▶ ElasticSearch (OpenSearch)
    │
    ├──▶ BullMQ (notification-queue)
    │        │
    │        ▼
    │   Notification Worker
    │        │ match alerts
    │        ├──▶ AWS SES (email)
    │        └──▶ FCM (push)
    │
    └──▶ BullMQ (vector-queue)
             │
             ▼
        Vector Worker ──▶ Weaviate / Pinecone
```

---

## Observability

- **Structured JSON logs** from all services: `timestamp`, `service`, `level`, `trace_id`, `message` (NFR-006). No PII in log fields.
- **Per-source scraper metrics** emitted after each run: `source_name`, `run_start`, `run_end`, `listings_discovered`, `listings_new`, `listings_updated`, `status` (NFR-006).
- **Web API latency metrics** per endpoint: p50/p95/p99 recorded via middleware; exported to CloudWatch (NFR-006).
- **Automated CloudWatch alarms:**
  - Scraper failure rate >20% in any 1-hour window
  - API 5xx rate >1% over 5 minutes
  - Notification queue depth >10,000
  - MongoDB replication lag >10 seconds
- **Operations dashboard:** CloudWatch dashboard surfacing all the above; also accessible via Admin CMS health page (FR-008).
- **`trace_id`** propagated across service calls via HTTP header `X-Trace-ID` for request tracing.

---

## Out of Scope (Phase 1)

Consistent with requirements:
- Government department self-publish / paid tier (Phase 2)
- Subscription billing
- Mobile native apps (iOS/Android)
- Resume/CV storage or ATS integration
- GDPR compliance for EU residents
- Automated interview scheduling
- Salary benchmarking analytics
- GraphQL API (deferred open decision)
