# TG-06: Content, Reviews and Admin

> **Jira Epic:** Content, Reviews and Admin

## Description

Implements the CMS for preparation content (blog posts, hiring guides, selection criteria guides), the internal agency review submission and moderation workflow, and the admin operations dashboard with scraper health data. All admin endpoints require the admin RBAC middleware from T-011. No code deployment is required for any admin action (FR-008).

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| T-028 | Implement content CMS API (CRUD for blog posts and guides) | M | T-011, T-002 | LOW |
| T-029 | Implement agency review submission, moderation, and rating API | M | T-011, T-002 | LOW |
| T-030 | Implement admin operations dashboard and scraper health endpoint | M | T-011, T-002 | MEDIUM |

---

## T-028: Implement content CMS API (CRUD for blog posts and guides)

**Design-l2 reference:** Section 2.9 (`content` collection), Section 1.4 (admin routes), FR-004 (Content and Preparation Resources)

### Description

Implement the CMS content API: public read endpoints for published content, admin CRUD for all content, and slug-based retrieval. `POST /api/admin/content` creates a new article (admin only). `PATCH /api/admin/content/:id` updates it (admin only). Public endpoints: `GET /api/content` (list published), `GET /api/content/:slug` (single article by slug). Content body is HTML sanitised on save.

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/content` | None | List published content; filter by `category`, `associatedAgency` |
| GET | `/api/content/:slug` | None | Single content article by slug |
| POST | `/api/admin/content` | Admin | Create new content article |
| PATCH | `/api/admin/content/:id` | Admin | Update existing article |
| DELETE | `/api/admin/content/:id` | Admin | Soft-delete (set status to "unpublished") |

### Acceptance criteria

- `POST /api/admin/content` creates a new `ContentDocument` with `status: "draft"` by default; `publishedAt` is set when `status` is set to `"published"`.
- `PATCH /api/admin/content/:id` with `{ status: "published" }` sets `publishedAt = now` if not already set.
- `PATCH /api/admin/content/:id` with `{ status: "unpublished" }` sets `unpublishedAt = now`; the article is immediately excluded from public listing endpoints.
- `GET /api/content` returns only `status: "published"` documents sorted by `publishedAt` descending.
- `GET /api/content?associatedAgency=ATO` returns published articles where `associatedAgencies` contains `"ATO"`.
- `GET /api/content/:slug` returns 404 for non-published articles when called by an unauthenticated visitor.
- The `slug` is auto-generated from `title` using `slugify` (lowercase, hyphens, no special chars) if not provided.
- The `slug` is unique (enforced by MongoDB unique index from T-002); if the generated slug conflicts, append `-2`, `-3`, etc.
- HTML `body` is sanitised using the same `sanitize-html` config as the Ingest Service (allow basic formatting, block scripts).
- A non-admin user calling `POST /api/admin/content` returns `HTTP 403`.

### Implementation notes

- File: `services/api/src/routes/admin/content.ts` and `services/api/src/routes/content.ts`.
- `slugify` npm package with options `{ lower: true, strict: true }`.
- Slug uniqueness: catch MongoError 11000 on insert, append counter suffix, retry up to 5 times.
- `authorId`: set to `req.user.userId` from the JWT (admin user's MongoDB _id).
- Contextual surfacing (for job detail, T-021): `GET /api/content?associatedAgency=:agency` is the API used by the job detail endpoint to fetch `preparationResources`.
- `GET /api/admin/content` (admin only) lists all content including drafts, sorted by `updated_at` descending.

### Test requirements

- Integration test: `POST /api/admin/content` with valid body creates document with `status: "draft"` and auto-generated slug.
- Integration test: `PATCH` to `status: "published"` sets `publishedAt`; article appears in public `GET /api/content`.
- Integration test: `PATCH` to `status: "unpublished"` — article no longer in public listing.
- Integration test: `GET /api/content?associatedAgency=ATO` returns only articles with ATO in `associatedAgencies`.
- Unit test: `generateUniqueSlug("Hello World! 2024")` returns `"hello-world-2024"`.
- Integration test: slug collision — second article with same title gets slug suffix `-2`.
- Integration test: non-admin user POST to admin content endpoint returns 403.
- Unit test: body with `<script>alert('xss')</script>` is stripped from stored `body`.

### Estimated complexity: M

---

## T-029: Implement agency review submission, moderation, and rating API

**Design-l2 reference:** Section 2.10 (`agency_reviews` collection), FR-005 (Agency Reviews and Ratings)

### Description

Implement the agency review workflow: authenticated users submit reviews (stored as `status: "pending"`); admins approve or reject via the moderation queue; public endpoints display approved reviews and aggregate ratings. Enforce the one-pending-or-approved review per `(userId, agencyName)` constraint at the API layer.

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/agencies/:agencyName/reviews` | None | Public: approved reviews + aggregate rating |
| POST | `/api/agencies/:agencyName/reviews` | User | Submit a new review (status: pending) |
| GET | `/api/admin/reviews` | Admin | Moderation queue: list pending reviews |
| PATCH | `/api/admin/reviews/:id` | Admin | Approve or reject a review |

### Acceptance criteria

- `POST /api/agencies/:agencyName/reviews` with valid `rating` (1–5) and `body` (20–2000 chars) creates an `AgencyReviewDocument` with `status: "pending"`.
- A user who already has a `status: "pending"` or `status: "approved"` review for the same agency receives `HTTP 409` on a second submission.
- `GET /api/agencies/:agencyName/reviews` returns only `status: "approved"` reviews with aggregate `averageRating`, sorted by `created_at` descending.
- `GET /api/admin/reviews` returns all `status: "pending"` reviews with their full `body` and `rating` (admin only).
- `PATCH /api/admin/reviews/:id` with `{ action: "approve" }` sets `status: "approved"`, `moderatedAt = now`, `moderatedBy = req.user.userId`.
- `PATCH /api/admin/reviews/:id` with `{ action: "reject", note: "..." }` sets `status: "rejected"`, `moderationNote` is stored internally (never returned to public API).
- The `moderationNote` field is NOT included in any public API response.
- Unauthenticated POST to review endpoint returns `HTTP 401`.
- Approved review appears in `GET /api/agencies/:agencyName/reviews` within one subsequent GET (no caching delay).
- `averageRating` is computed as the mean of all approved ratings (rounded to 1 decimal place).

### Implementation notes

- File: `services/api/src/routes/agencies/reviews.ts` and `services/api/src/routes/admin/reviews.ts`.
- One-per-user-per-agency constraint: `AgencyReview.findOne({ userId, agencyName, status: { $in: ['pending', 'approved'] } })` before insert.
- `agencyName` normalisation: `agencyName.trim()` only — do not lowercase in the URL path (agency names are case-sensitive in MongoDB queries).
- `averageRating` aggregation: `AgencyReview.aggregate([{ $match: { agencyName, status: 'approved' } }, { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }])`.
- Admin moderation queue default sort: `{ created_at: -1 }` (newest first).
- `PATCH /api/admin/reviews/:id` accepted `action` values: `"approve"` or `"reject"` (Zod enum).
- A user can resubmit a rejected review (the constraint only blocks pending/approved, not rejected).

### Test requirements

- Integration test: submit review, confirm `status: "pending"` in DB.
- Integration test: second review submission for same `(userId, agencyName)` with existing pending returns 409.
- Integration test: user can submit after their previous review was rejected.
- Integration test: admin approves review → appears in public GET with correct `averageRating`.
- Integration test: `moderationNote` not present in public GET response.
- Integration test: unauthenticated POST returns 401.
- Unit test: `computeAverageRating([4, 5, 3])` returns `4.0`.

### Estimated complexity: M

---

## T-030: Implement admin operations dashboard and scraper health endpoint

**Design-l2 reference:** Section 2.12 (`scraper_runs` collection), Section 1.4 (`GET /api/admin/health`), FR-008 (Admin CMS and Operations), NFR-006 (Observability)

### Description

Implement `GET /api/admin/health` which returns scraper health data: for each configured source, the last run time, last run status, listings discovered/new/updated, and next scheduled run time. Data must be no more than 5 minutes stale (sourced directly from `scraper_runs` collection). Implement admin-only source management endpoints for CRUD of scraper source configurations.

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/health` | Admin | Scraper health dashboard: recent runs per source |
| GET | `/api/admin/sources` | Admin | List all scraper source configurations |
| POST | `/api/admin/sources` | Admin | Add a new scraper source |
| PATCH | `/api/admin/sources/:id` | Admin | Update a source (enable/disable, cron, URL) |
| DELETE | `/api/admin/sources/:id` | Admin | Soft-delete source (sets `enabled: false`) |

### Health dashboard response shape

```typescript
interface HealthDashboardResponse {
  data: {
    sources: SourceHealthSummary[];
    queueDepths: { scrapeQueue: number; esSyncQueue: number; notificationQueue: number; vectorQueue: number };
    alarmsActive: boolean;  // true if any CloudWatch alarm in ALARM state
  };
  meta: { generatedAt: string; dataAgeSeconds: number };
}

interface SourceHealthSummary {
  sourceId: string;
  sourceName: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: "success" | "partial" | "failed" | "skipped" | null;
  lastRunListingsDiscovered: number | null;
  lastRunListingsNew: number | null;
  lastRunDurationMs: number | null;
  nextRunAt: string | null;
  failureRatePercent: number;  // % of runs in last 1h that failed
  recentErrors: { errorCode: string; count: number }[];
}
```

### Acceptance criteria

- `GET /api/admin/health` returns a `HealthDashboardResponse` for all configured sources including the most recent `ScraperRunDocument` for each.
- `failureRatePercent` is computed as `(failed runs in last 1h / total runs in last 1h) * 100`; rounded to 1 decimal.
- `queueDepths` are retrieved from BullMQ `queue.getJobCounts()` for each of the 4 queues.
- `dataAgeSeconds` reflects how old the most recent `scraper_runs` record is for the slowest-updated source.
- `POST /api/admin/sources` with a valid `SourceDocument` (name, url, type, cronExpression, pluginId) creates the source; the scheduler picks it up within 5 minutes (FR-008).
- `PATCH /api/admin/sources/:id` with `{ enabled: false }` immediately prevents further scheduling of that source.
- `PATCH /api/admin/sources/:id` with `{ cronExpression: "0 */12 * * *" }` updates the expression; Zod validates the cron string using `cron-parser`.
- `POST /api/admin/sources` with an invalid `cronExpression` returns `HTTP 422`.
- Non-admin access to any admin endpoint returns `HTTP 403`.
- `queueDepths.notificationQueue > 10000` sets `alarmsActive: true` (simple threshold check; CloudWatch is wired separately in NFR-006 observability).

### Implementation notes

- File: `services/api/src/routes/admin/health.ts` and `services/api/src/routes/admin/sources.ts`.
- Health query: `ScraperRun.aggregate([{ $sort: { startedAt: -1 } }, { $group: { _id: '$sourceId', lastRun: { $first: '$$ROOT' } } }])`.
- Failure rate query: `ScraperRun.aggregate([{ $match: { startedAt: { $gte: oneHourAgo } } }, { $group: { _id: '$sourceId', total: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } }])`.
- Queue depths: `await Promise.all([scrapeQueue.getJobCounts(), esSyncQueue.getJobCounts(), notificationQueue.getJobCounts(), vectorQueue.getJobCounts()])`.
- Source cron validation: `try { CronExpressionParser.parse(cronExpression) } catch { return 422 }`.
- Response `meta.dataAgeSeconds`: `Math.floor((now - lastScraperRunTimestamp) / 1000)`.
- Admin sources list: `Source.find({}).sort({ name: 1 })`.
- Source PATCH validation: if `cronExpression` is provided, validate with `cron-parser`. Other fields: `name` max 100 chars, `url` valid URL format.
- CloudWatch alarm check: optional for MVP; stub returns `alarmsActive: false` if `AWS_CLOUDWATCH_ALARM_NAMES` env var is not set.

### Test requirements

- Integration test: seed 2 sources with 3 scraper runs each (1 failed, 2 success in the last hour); `GET /api/admin/health` returns `failureRatePercent: 33.3` for each source.
- Integration test: `POST /api/admin/sources` creates a new source with correct defaults; source appears in `GET /api/admin/sources`.
- Unit test: `POST /api/admin/sources` with `cronExpression: "not-a-cron"` returns 422.
- Integration test: `PATCH /api/admin/sources/:id` with `{ enabled: false }` — subsequent `GET /api/admin/sources/:id` shows `enabled: false`.
- Integration test: non-admin user calls `GET /api/admin/health` — returns 403.
- Integration test: `queueDepths` in health response reflects actual BullMQ job counts (mock queue with 5 waiting jobs).

### Estimated complexity: M
