# GovJobs Portal — L2 Component Design

## Summary

This document specifies the detailed component interfaces, data models, queue designs, and implementation contracts for the GovJobs Portal. It is derived from the L1 architecture (GO decision) and resolves the two advisory items from the L1 review: the Scheduler leader election mechanism (A1) and the expiry reminder polling cadence (A2). Developer agents implement directly from this specification.

## Contents

1. [Component Interfaces](#1-component-interfaces)
2. [Data Models — MongoDB Schemas](#2-data-models--mongodb-schemas)
3. [ElasticSearch Index Mapping](#3-elasticsearch-index-mapping)
4. [BullMQ Queue Design](#4-bullmq-queue-design)
5. [Scraper Plugin Interface](#5-scraper-plugin-interface)
6. [Notification Matching Logic](#6-notification-matching-logic)
7. [Auth Flow Detail](#7-auth-flow-detail)
8. [Vector Search Integration](#8-vector-search-integration)
9. [API Request/Response Contracts](#9-api-requestresponse-contracts)
10. [Configuration and Environment Variables](#10-configuration-and-environment-variables)

---

## 1. Component Interfaces

Each component section defines: the public interface (REST endpoints or internal function signatures), key data contracts (TypeScript interfaces), and error return types. Error types follow a discriminated union pattern; no component returns `any` or `unknown` for error fields.

### 1.1 Scraper Scheduler

**Internal process — no HTTP interface.** Exposes a typed configuration interface.

```typescript
// Error types
type SchedulerError =
  | { code: "LOCK_ACQUIRE_FAILED"; ttlMs: number; lockKey: string }
  | { code: "SOURCE_POLL_FAILED"; cause: Error }
  | { code: "ENQUEUE_FAILED"; sourceId: string; cause: Error }
  | { code: "CRON_PARSE_ERROR"; sourceId: string; expression: string; cause: Error };

interface SchedulerResult {
  sourcesEvaluated: number;
  jobsEnqueued: number;
  sourcesSkipped: number;  // disabled or robots-blocked
  errors: SchedulerError[];
  cycleStartedAt: Date;
  cycleCompletedAt: Date;
}

interface SchedulerService {
  // Start the polling loop; acquires Redis leader lock before each cycle.
  // timeout: SCHEDULER_CYCLE_TIMEOUT_MS (default 60000)
  start(): Promise<void>;

  // Gracefully stop: finish the current cycle, release the leader lock.
  stop(): Promise<void>;

  // Run one scheduling cycle synchronously (used in tests and manual triggers).
  // Returns SchedulerError[] for per-source failures; never throws for individual source errors.
  runCycle(): Promise<SchedulerResult>;
}
```

**Leader election** (resolves A1): The Scheduler acquires a Redis distributed lock using `SET NX EX` before executing each cycle. The lock key is `scheduler:leader-lock`. The TTL is `SCHEDULER_LOCK_TTL_MS` (default: 90000 ms — 90 seconds). A heartbeat goroutine (every 30 seconds) extends the TTL via `PEXPIRE` while the cycle is running. If lock acquisition fails (another Scheduler instance holds it), the current instance skips the cycle and logs at INFO level. On graceful shutdown, the lock is explicitly deleted via `DEL scheduler:leader-lock`. If the process crashes without releasing the lock, Redis TTL expiry (90s) ensures the next instance can acquire it within `SCHEDULER_LOCK_TTL_MS`.

```typescript
interface SchedulerLeaderLock {
  lockKey: string;           // "scheduler:leader-lock"
  lockValue: string;         // unique instance UUID (set at startup, prevents foreign DEL)
  ttlMs: number;             // SCHEDULER_LOCK_TTL_MS default 90000
  heartbeatIntervalMs: number; // SCHEDULER_LOCK_HEARTBEAT_INTERVAL_MS default 30000
}
```

**Expiry re-scan enqueue logic:**

```typescript
interface ExpiryRescanJob {
  sourceId: string;
  jobId: string;             // MongoDB job _id
  sourceUrl: string;
  phase: "pre-expiry" | "post-expiry";
  expiryDate: Date;
}

// Jobs with expiry_date within EXPIRY_PRESCAN_HOURS (72h) are enqueued every
// EXPIRY_RESCAN_INTERVAL_HOURS (12h) — satisfying FR-001 "at least once every 12 hours".
// Jobs with expiry_date up to EXPIRY_POSTSCAN_HOURS (48h) past are also enqueued.
```

---

### 1.2 Scraper Workers

**Internal consumer of BullMQ `scrape-queue`.** Exposes a plugin interface (see Section 5). The worker process itself has no HTTP server; it communicates outbound only.

```typescript
type ScraperWorkerError =
  | { code: "ROBOTS_DISALLOWED"; url: string; userAgent: string }
  | { code: "HTTP_4XX"; url: string; statusCode: number }
  | { code: "HTTP_5XX"; url: string; statusCode: number; attempt: number }
  | { code: "NETWORK_TIMEOUT"; url: string; attempt: number; timeoutMs: number }
  | { code: "PLAYWRIGHT_CRASH"; browserVersion: string; cause: Error }
  | { code: "PARSE_ERROR"; url: string; cause: Error }
  | { code: "INGEST_REJECTED"; statusCode: number; body: string }
  | { code: "RATE_LIMIT_EXCEEDED"; url: string; retryAfterMs: number };

interface ScraperWorkerResult {
  sourceId: string;
  sourceUrl: string;
  listingsDiscovered: number;
  listingsSubmitted: number;  // sent to Ingest Service
  error: ScraperWorkerError | null;
  startedAt: Date;
  completedAt: Date;
}
```

**robots.txt cache:** Each worker instance maintains an in-memory LRU cache (max 500 entries, TTL `ROBOTS_CACHE_TTL_SECONDS` default 3600). Cache key is the domain (scheme + host).

---

### 1.3 Ingest Service

**Internal HTTP server** — not exposed on the public ALB. Accessible only from within the ECS VPC.

```
POST /internal/ingest
```

Request: `IngestRequest`
Response (200): `IngestResponse`
Response (400): `IngestErrorResponse` — validation failure
Response (422): `IngestErrorResponse` — schema mismatch
Response (500): `IngestErrorResponse` — storage failure

```typescript
interface RawJobInput {
  sourceId: string;           // MongoDB ObjectId string of the source
  sourceUrl: string;          // canonical URL of the individual listing
  sourceType: "api" | "scrape";
  sourceName: string;         // human-readable source name

  title: string;              // required
  agency: string;             // required
  location: string;           // required; comma-separated if multiple
  classification: string;     // APS classification string or equivalent
  salaryBand: {
    min: number | null;
    max: number | null;
    currency: "AUD";
  };
  description: string;        // full text; may contain HTML (sanitised on ingest)
  expiryDate: string | null;  // ISO 8601 date or null
  applyUrl: string;           // URL to original apply/view page
  metadata: Record<string, string>; // source-specific extras; stored but not indexed
}

interface IngestRequest {
  jobs: RawJobInput[];        // max 500 per batch (MAX_INGEST_BATCH_SIZE)
  scraperRunId: string;       // links to scraper_runs collection
}

interface IngestResponseItem {
  inputIndex: number;
  action: "created" | "updated" | "duplicate_skipped";
  jobId: string;              // MongoDB _id of the canonical job record
}

interface IngestResponse {
  processed: number;
  created: number;
  updated: number;
  duplicatesSkipped: number;
  items: IngestResponseItem[];
  durationMs: number;
}

type IngestErrorCode =
  | "VALIDATION_FAILED"
  | "BATCH_TOO_LARGE"
  | "SCRAPER_RUN_NOT_FOUND"
  | "STORAGE_ERROR"
  | "TRANSACTION_FAILED";

interface IngestErrorResponse {
  error: IngestErrorCode;
  message: string;
  fields?: Record<string, string>;  // field-level validation errors
}
```

**Deduplication key:** `sha256(normalise(agency) + "|" + normalise(title) + "|" + normalise(location) + "|" + normalise(classification))` where `normalise` lowercases, trims, and collapses whitespace. Secondary fuzzy match uses Levenshtein distance ≤ 2 on the key components for near-duplicates (implemented via a MongoDB text index lookup before write).

**After successful upsert:** Publishes three BullMQ jobs atomically within the same operation:
- `es-sync-queue` job with `jobId` and changed fields
- `notification-queue` job with `jobId` and `isNew` flag
- `vector-queue` job with `jobId` (only when `isNew === true` or `description` changed)

---

### 1.4 Web API

Express router. All routes are prefixed `/api/`. Full request/response contracts for the five highest-traffic endpoints are in Section 9.

```typescript
type ApiError =
  | { code: "UNAUTHORIZED"; message: string }               // 401
  | { code: "FORBIDDEN"; message: string }                  // 403
  | { code: "NOT_FOUND"; resource: string }                 // 404
  | { code: "VALIDATION_ERROR"; fields: Record<string, string> } // 422
  | { code: "SEARCH_UNAVAILABLE"; message: string }         // 503 — ES down
  | { code: "RATE_LIMITED"; retryAfterSeconds: number }     // 429
  | { code: "INTERNAL_ERROR"; traceId: string }             // 500

// Standard API response envelope (success)
interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

// Standard API error envelope
interface ApiErrorResponse {
  error: ApiError;
  traceId: string;
}
```

**Middleware stack order (applied to every request):**
1. `X-Trace-ID` propagation (generate UUID if absent)
2. Request logger (structured JSON; masks Authorization header value)
3. TLS redirect enforcer (HTTP → HTTPS 301)
4. Rate limiter: `API_RATE_LIMIT_REQUESTS` per `API_RATE_LIMIT_WINDOW_MS` per IP (defaults: 300 / 60000)
5. Body size limiter: `API_MAX_BODY_SIZE_BYTES` (default 102400)
6. Input sanitiser (PII field rejection — phone, national ID, etc.)
7. JWT authentication (sets `req.user` if valid token; allows unauthenticated to continue to public routes)
8. RBAC middleware (blocks admin routes for non-admin users)
9. Route handler
10. Response logger (duration, status code, no body logging)
11. Error handler (maps typed errors to HTTP status; strips stack traces in production)

**Timeout:** `API_REQUEST_TIMEOUT_MS` (default: 5000). Configured in Express via `request.setTimeout()`.

---

### 1.5 Auth Service (module within Web API)

```typescript
type AuthError =
  | { code: "INVALID_CREDENTIALS"; message: string }
  | { code: "EMAIL_NOT_VERIFIED"; message: string }
  | { code: "EMAIL_ALREADY_REGISTERED"; message: string }
  | { code: "OAUTH_PROVIDER_ERROR"; provider: "google" | "linkedin"; cause: string }
  | { code: "REFRESH_TOKEN_INVALID"; message: string }
  | { code: "REFRESH_TOKEN_EXPIRED"; message: string }
  | { code: "REFRESH_TOKEN_REUSE_DETECTED"; message: string }  // triggers rotation + revocation
  | { code: "ACCOUNT_DELETED"; message: string }
  | { code: "RATE_LIMITED"; retryAfterSeconds: number };

interface AuthService {
  register(input: RegisterInput): Promise<{ userId: string } | AuthError>;
  login(input: LoginInput): Promise<TokenPair | AuthError>;
  oauthCallback(provider: "google" | "linkedin", code: string, redirectUri: string): Promise<TokenPair | AuthError>;
  refreshTokens(refreshToken: string): Promise<TokenPair | AuthError>;
  revokeRefreshToken(refreshToken: string): Promise<void | AuthError>;
  sendVerificationEmail(userId: string): Promise<void | AuthError>;
  verifyEmail(token: string): Promise<void | AuthError>;
}

interface TokenPair {
  accessToken: string;         // JWT RS256; 15-minute expiry
  refreshToken: string;        // opaque random token; 30-day expiry
  expiresIn: number;           // access token TTL in seconds (900)
}

interface RegisterInput {
  email: string;               // max 254 chars; must match RFC 5321
  password: string;            // min 10 chars; max 128 chars
}

interface LoginInput {
  email: string;
  password: string;
}
```

**JWT claims structure:**

```typescript
interface JwtPayload {
  sub: string;          // MongoDB user _id
  email: string;        // included for display; not used for auth decisions
  role: "user" | "admin";
  iat: number;
  exp: number;          // iat + 900
  jti: string;          // unique token ID for potential future blocklist
}
```

**Admin role double-check:** Admin routes extract `userId` from the verified JWT, then query `users` collection to confirm `role === "admin"`. This prevents privilege escalation via a stale token (NFR-004). Timeout for this DB check: `AUTH_ADMIN_CHECK_TIMEOUT_MS` (default: 2000).

---

### 1.6 ElasticSearch Sync Worker

**Internal consumer of BullMQ `es-sync-queue`.**

```typescript
type EsSyncError =
  | { code: "ES_UNAVAILABLE"; cause: Error; attempt: number }
  | { code: "MAPPING_CONFLICT"; index: string; field: string }
  | { code: "DOCUMENT_NOT_FOUND"; jobId: string }          // job deleted before sync
  | { code: "BULK_PARTIAL_FAILURE"; failedCount: number; errors: EsBulkItemError[] };

interface EsBulkItemError {
  jobId: string;
  esErrorType: string;
  esErrorReason: string;
}

interface EsSyncWorkerInterface {
  // Process a single es-sync-queue job. Returns error or null on success.
  // timeout: ES_SYNC_TIMEOUT_MS (default 10000)
  processJob(job: EsSyncQueueJob): Promise<EsSyncError | null>;

  // Flush a batch of pending sync jobs in a single ES bulk request.
  // timeout: ES_BULK_TIMEOUT_MS (default 30000)
  flushBatch(jobs: EsSyncQueueJob[]): Promise<EsSyncError | null>;
}
```

**Index alias strategy (resolves L1 review recommendation 5):** The ES index is named `jobs_v{N}` (e.g. `jobs_v1`). The alias `jobs` always points to the current version. Migrations create `jobs_v{N+1}`, reindex via the ES Reindex API, then atomically swap the alias (`jobs_v1 → jobs_v2`). The `es_schema_versions` collection records: version number, created_at, status (`active | migrating | deprecated`). Workers read from the `jobs` alias; they never address a versioned index directly.

---

### 1.7 Vector Embedding Worker

**Internal consumer of BullMQ `vector-queue`.**

```typescript
type VectorWorkerError =
  | { code: "EMBEDDING_API_ERROR"; model: string; cause: string }
  | { code: "VECTOR_DB_UNAVAILABLE"; provider: string; cause: Error }
  | { code: "JOB_NOT_FOUND"; jobId: string }
  | { code: "EMBEDDING_TIMEOUT"; jobId: string; timeoutMs: number };

interface VectorWorkerInterface {
  // Process a single vector-queue job.
  // timeout: VECTOR_EMBED_TIMEOUT_MS (default 30000)
  processJob(job: VectorQueueJob): Promise<VectorWorkerError | null>;
}

// Abstract vector DB interface (implemented by Weaviate and Pinecone adapters)
interface VectorDbAdapter {
  upsert(id: string, vector: number[], metadata: VectorMetadata): Promise<void | VectorWorkerError>;
  delete(id: string): Promise<void | VectorWorkerError>;
  querySimilar(vector: number[], topK: number, filter?: VectorFilter): Promise<VectorSearchResult[] | VectorWorkerError>;
}

interface VectorMetadata {
  jobId: string;
  title: string;
  agency: string;
  classification: string;
  location: string;
}

interface VectorFilter {
  status?: "active" | "expired";
  classification?: string;
  location?: string;
}

interface VectorSearchResult {
  jobId: string;
  score: number;             // cosine similarity 0–1
}
```

---

### 1.8 Notification Worker

**Internal consumer of BullMQ `notification-queue` and `expiry-reminder-queue`.**

```typescript
type NotificationWorkerError =
  | { code: "SES_SEND_FAILED"; userId: string; attempt: number; cause: string }
  | { code: "FCM_SEND_FAILED"; userId: string; token: string; attempt: number; cause: string }
  | { code: "FCM_TOKEN_INVALID"; userId: string; token: string }  // token must be removed
  | { code: "ALERT_NOT_FOUND"; alertId: string }                  // deleted between enqueue and process
  | { code: "USER_NOT_FOUND"; userId: string }
  | { code: "DEDUP_CHECK_FAILED"; deduplicationKey: string; cause: Error };

interface NotificationWorkerInterface {
  processAlertJob(job: NotificationQueueJob): Promise<NotificationWorkerError | null>;
  processExpiryReminderJob(job: ExpiryReminderQueueJob): Promise<NotificationWorkerError | null>;
}
```

**Push dispatch:** For each `push` channel notification, the Notification Worker reads `users.fcmTokens` (see Section 2.3) and fans out to all registered device tokens for that user (up to `MAX_FCM_TOKENS_PER_USER = 10`). After a successful send, the worker updates `fcmTokens[i].lastUsedAt`. If FCM returns a token-invalid error (`FCM_TOKEN_INVALID`), the worker removes that specific token from the `users.fcmTokens` array via an atomic `$pull` update. Stale tokens (where `lastUsedAt` is more than 90 days ago) are pruned by the Notification Worker before dispatching.

---

## 2. Data Models — MongoDB Schemas

All collection names are lowercase plural. All documents include `_id: ObjectId`, `created_at: Date`, and `updated_at: Date` unless noted. Indexes are defined after each schema. `updated_at` is set on every write via a Mongoose pre-save hook.

### 2.1 `jobs` Collection

```typescript
interface JobDocument {
  _id: ObjectId;
  title: string;                    // required; max 500 chars
  titleNormalised: string;          // lowercased, whitespace-collapsed; for dedup
  agency: string;                   // required; max 200 chars
  agencyNormalised: string;         // for dedup
  location: string;                 // required; comma-separated if multiple
  locationNormalised: string;       // for dedup
  classification: string;           // required; e.g. "APS 6", "EL1", "SES 1"
  classificationNormalised: string; // for dedup
  salaryBand: {
    min: number | null;
    max: number | null;
    currency: "AUD";
  };
  description: string;              // HTML-sanitised; required
  descriptionText: string;          // plain-text strip of description; for text search
  applyUrl: string;                 // direct application URL
  sources: JobSource[];             // min 1 entry
  status: "active" | "expired" | "admin_expired";
  expiryDate: Date | null;
  expiryReminderSentAt: Date | null; // set when expiry reminder notification is sent
  lastSeenAt: Date;                 // last time any source confirmed the job live
  deduplicationKey: string;         // sha256 hash of normalised composite key
  governmentLevel: "federal" | "state" | "territory" | "council" | "statutory" | "unknown";
  state: AustralianState | null;    // e.g. "NSW", "VIC", "QLD"
  embeddingStatus: "pending" | "computed" | "failed";
  embeddingComputedAt: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface JobSource {
  sourceId: ObjectId;               // ref: sources._id
  sourceName: string;               // denormalised for display
  sourceType: "api" | "scrape";
  sourceUrl: string;                // URL of this specific listing on the source
  lastSeenAt: Date;
  firstSeenAt: Date;
}

type AustralianState = "ACT" | "NSW" | "NT" | "QLD" | "SA" | "TAS" | "VIC" | "WA";
```

**Indexes:**

```javascript
// Primary dedup lookup
{ deduplicationKey: 1 }                     // unique: true

// Core search / filter indexes
{ status: 1, expiryDate: 1 }               // filter active jobs by expiry
{ status: 1, agency: 1 }                   // agency filter
{ status: 1, classification: 1 }           // classification filter
{ status: 1, governmentLevel: 1 }          // level filter
{ status: 1, state: 1 }                    // state/location filter
{ "sources.sourceId": 1 }                  // lookup jobs by source

// Expiry tracking (scheduler query)
{ status: 1, expiryDate: 1, lastSeenAt: 1 } // compound for expiry scanner

// Text search (fallback; primary search via ES)
{ descriptionText: "text", title: "text", agency: "text" }  // weights: title 10, agency 5, description 1

// Embedding backfill
{ embeddingStatus: 1, status: 1 }          // sparse

// Sort performance
{ created_at: -1 }
{ updated_at: -1 }
```

**Validation:**
- `title`: required, minLength 2, maxLength 500
- `agency`: required, minLength 2, maxLength 200
- `location`: required, minLength 2, maxLength 500
- `classification`: required, minLength 1, maxLength 100
- `status`: enum `["active", "expired", "admin_expired"]`
- `governmentLevel`: enum `["federal", "state", "territory", "council", "statutory", "unknown"]`
- `sources`: minItems 1
- `salaryBand.currency`: must be `"AUD"` if present

---

### 2.2 `sources` Collection

```typescript
interface SourceDocument {
  _id: ObjectId;
  name: string;                     // required; unique; human-readable (e.g. "APSJobs")
  url: string;                      // base URL of the source
  type: "api" | "scrape";
  pluginId: string;                 // identifies which scraper plugin to use
  cronExpression: string;           // e.g. "0 */6 * * *"; validated against cron-parser
  enabled: boolean;                 // false = scheduler skips this source
  governmentLevel: "federal" | "state" | "territory" | "council" | "statutory";
  state: AustralianState | null;    // null for federal/multi-state
  pluginConfig: Record<string, unknown>; // plugin-specific config (selectors, API keys ref, etc.)
  lastRunAt: Date | null;
  lastRunStatus: "success" | "partial" | "failed" | "skipped" | null;
  nextRunAt: Date | null;           // computed by scheduler after each enqueue
  rateLimit: {
    minIntervalMs: number;          // minimum ms between requests; default 2000
    source: "robots_txt" | "config" | "default";
  };
  robotsTxtDisallowed: boolean;     // last-known robots.txt status
  robotsTxtCheckedAt: Date | null;
  created_at: Date;
  updated_at: Date;
}
```

**Indexes:**

```javascript
{ name: 1 }                         // unique: true
{ enabled: 1, nextRunAt: 1 }       // scheduler query: find due sources
{ type: 1 }
{ governmentLevel: 1 }
```

**Validation:**
- `name`: required, unique, maxLength 100
- `cronExpression`: must parse without error via `cron-parser`
- `type`: enum `["api", "scrape"]`
- `pluginId`: required, non-empty string
- `rateLimit.minIntervalMs`: min 0, default 2000

---

### 2.3 `users` Collection

```typescript
// Per-user FCM push token device limit
const MAX_FCM_TOKENS_PER_USER = 10;

interface FcmToken {
  token: string;        // FCM registration token
  deviceId: string;     // client-supplied device identifier
  registeredAt: Date;   // when the token was first registered
  lastUsedAt: Date;     // updated each time a push is dispatched to this token
}

interface UserDocument {
  _id: ObjectId;
  email: string;                    // required; unique; lowercase; max 254 chars
  emailVerified: boolean;
  emailVerificationToken: string | null;     // SHA-256 hex hash of the token; cleared on verify
  emailVerificationTokenExpiresAt: Date | null;
  passwordHash: string | null;      // argon2id hash; null for OAuth-only accounts
  role: "user" | "admin";
  displayName: string | null;       // optional; max 100 chars
  oauthIdentities: OAuthIdentity[];
  notificationPreferences: NotificationPreferences;
  fcmTokens: FcmToken[];            // push registration tokens; capped at MAX_FCM_TOKENS_PER_USER
  deletionRequestedAt: Date | null; // set when user requests account deletion
  deletionScheduledFor: Date | null; // deletionRequestedAt + 30 days
  created_at: Date;
  updated_at: Date;
}

interface OAuthIdentity {
  provider: "google" | "linkedin";
  providerId: string;               // opaque provider-assigned ID
  linkedAt: Date;
}

interface NotificationPreferences {
  emailEnabled: boolean;            // default: true
  pushEnabled: boolean;             // default: false
  alertEmailFrequency: "immediate" | "daily_digest"; // default: "immediate"
  expiryReminderEnabled: boolean;   // default: true
}
```

**Indexes:**

```javascript
{ email: 1 }                        // unique: true
{ "oauthIdentities.provider": 1, "oauthIdentities.providerId": 1 } // unique: true, sparse: true
{ deletionScheduledFor: 1 }         // TTL-like: deletion worker query
{ emailVerificationToken: 1 }       // sparse: true — lookup during verify
{ "fcmTokens.token": 1 }            // sparse: true — FCM token lookup and dedup
```

**Validation:**
- `email`: required, unique, maxLength 254, format validation
- `role`: enum `["user", "admin"]`; cannot be set by user input
- `displayName`: maxLength 100; optional
- `notificationPreferences.alertEmailFrequency`: enum `["immediate", "daily_digest"]`

**PII fields:** `email`, `displayName`, `oauthIdentities[].providerId`. No phone, national ID, address, or date of birth stored.

---

### 2.4 `refresh_tokens` Collection

```typescript
interface RefreshTokenDocument {
  _id: ObjectId;
  userId: ObjectId;                 // ref: users._id
  tokenHash: string;                // sha256 of the raw token value; never store raw
  expiresAt: Date;                  // issued_at + 30 days
  usedAt: Date | null;              // set on first use; used tokens are single-use
  revokedAt: Date | null;           // set on logout or reuse detection
  userAgent: string | null;         // from User-Agent header at issuance; for display
  ipAddress: string | null;         // masked to /24 (IPv4) or /48 (IPv6) for display
  created_at: Date;
}
```

**Indexes:**

```javascript
{ tokenHash: 1 }                    // unique: true
{ userId: 1 }                       // list all tokens for a user (logout-all)
{ expiresAt: 1 }                    // TTL index — MongoDB auto-deletes expired tokens
                                    // TTL: expireAfterSeconds: 0 (uses expiresAt field value)
```

**TTL:** MongoDB TTL index on `expiresAt` with `expireAfterSeconds: 0` automatically purges expired tokens. This is supplementary to the application-level expiry check.

---

### 2.5 `saved_jobs` Collection

```typescript
interface SavedJobDocument {
  _id: ObjectId;
  userId: ObjectId;                 // ref: users._id
  jobId: ObjectId;                  // ref: jobs._id
  savedAt: Date;
  notes: string | null;             // user-supplied notes; max 1000 chars
  created_at: Date;
}
```

**Indexes:**

```javascript
{ userId: 1, jobId: 1 }            // unique: true (prevent duplicate saves)
{ userId: 1, savedAt: -1 }         // list saved jobs for a user, sorted by recency
{ jobId: 1 }                        // lookup all users who saved a job (for deletion cascade)
```

---

### 2.6 `saved_searches` Collection

```typescript
interface SavedSearchDocument {
  _id: ObjectId;
  userId: ObjectId;                 // ref: users._id
  name: string;                     // required; max 100 chars
  criteria: SearchCriteria;
  lastExecutedAt: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface SearchCriteria {
  query: string | null;             // free-text keyword
  agencies: string[];               // filter by agency name
  classifications: string[];        // filter by classification
  locations: string[];              // filter by location
  governmentLevels: ("federal" | "state" | "territory" | "council" | "statutory")[];
  states: AustralianState[];
  salaryBandMin: number | null;
  salaryBandMax: number | null;
  statusFilter: "active" | "all";   // default: "active"
}
```

**Indexes:**

```javascript
{ userId: 1, created_at: -1 }      // list saved searches for user
```

**Limits:** Max `SAVED_SEARCHES_PER_USER` (default: 20) saved searches per user. Enforced at API layer.

---

### 2.7 `alerts` Collection

```typescript
interface AlertDocument {
  _id: ObjectId;
  userId: ObjectId;                 // ref: users._id
  name: string;                     // required; max 100 chars
  criteria: SearchCriteria;         // reuses SearchCriteria from saved_searches
  status: "active" | "paused" | "deleted";
  channels: NotificationChannel[];  // must have at least one
  lastTriggeredAt: Date | null;
  lastMatchedJobId: ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

type NotificationChannel = "email" | "push";
```

**Indexes:**

```javascript
{ userId: 1, status: 1 }           // list alerts for a user
{ status: 1 }                       // notification worker: query all active alerts
{ status: 1, governmentLevel: 1, state: 1 }  // alert matching pre-filter (used when ALERT_MATCH_USE_INDEXED_QUERY=true)
// Note: alert matching queries run against this collection with status:"active" filter.
// Individual criteria fields are NOT individually indexed here because the matching
// algorithm fetches all active alerts and applies in-memory scoring for flexibility.
// The compound index above pre-filters by governmentLevel and state before in-memory scoring.
// Activated via ALERT_MATCH_USE_INDEXED_QUERY=true when alert count exceeds ALERT_MATCH_INDEX_THRESHOLD (default: 10000).
```

**Limits:** Max `ALERTS_PER_USER` (default: 10) active + paused alerts per user. Enforced at API layer.

---

### 2.8 `notifications` Collection

```typescript
interface NotificationDocument {
  _id: ObjectId;
  userId: ObjectId;                 // ref: users._id
  alertId: ObjectId | null;         // ref: alerts._id; null for system notifications
  jobId: ObjectId | null;           // ref: jobs._id; null for non-job notifications
  type: "alert_match" | "expiry_reminder" | "system";
  channel: "email" | "push";
  status: "pending" | "sent" | "failed" | "deduped";
  deduplicationKey: string;         // see Section 6
  sentAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  attemptCount: number;             // 0-indexed
  subject: string | null;           // email subject
  bodySnippet: string | null;       // first 200 chars of message (for history display)
  created_at: Date;
  updated_at: Date;
}
```

**Indexes:**

```javascript
{ deduplicationKey: 1 }             // unique: true — prevents duplicate sends
{ userId: 1, created_at: -1 }      // notification history for user
{ status: 1, created_at: 1 }       // worker: find pending notifications
{ created_at: 1 }                   // TTL index: expireAfterSeconds: 7776000 (90 days)
```

---

### 2.9 `content` Collection

```typescript
interface ContentDocument {
  _id: ObjectId;
  title: string;                    // required; max 200 chars
  slug: string;                     // URL-friendly; unique; auto-generated from title
  category: ContentCategory;
  status: "draft" | "published" | "unpublished";
  body: string;                     // HTML; sanitised on save
  excerpt: string;                  // max 300 chars; plain text summary
  associatedAgencies: string[];     // agency names for contextual surfacing
  tags: string[];                   // max 10 tags; each max 50 chars
  authorId: ObjectId;               // ref: users._id (admin who published)
  publishedAt: Date | null;
  unpublishedAt: Date | null;
  seoTitle: string | null;          // max 70 chars
  seoDescription: string | null;    // max 160 chars
  created_at: Date;
  updated_at: Date;
}

type ContentCategory =
  | "blog"
  | "hiring_guide"
  | "selection_criteria"
  | "interview_prep"
  | "agency_profile";
```

**Indexes:**

```javascript
{ slug: 1 }                         // unique: true
{ status: 1, publishedAt: -1 }     // list published content
{ associatedAgencies: 1, status: 1 } // lookup guides for an agency
{ category: 1, status: 1 }         // filter by category
{ title: "text", body: "text", tags: "text" } // text search for CMS
```

---

### 2.10 `agency_reviews` Collection

```typescript
interface AgencyReviewDocument {
  _id: ObjectId;
  agencyName: string;               // required; normalised to match jobs.agency
  userId: ObjectId;                 // ref: users._id; required
  rating: number;                   // integer 1–5
  body: string;                     // required; min 20 chars; max 2000 chars
  status: "pending" | "approved" | "rejected";
  moderatedAt: Date | null;
  moderatedBy: ObjectId | null;     // ref: users._id (admin)
  moderationNote: string | null;    // internal only; never returned to public API
  created_at: Date;
  updated_at: Date;
}
```

**Indexes:**

```javascript
{ agencyName: 1, status: 1 }       // agency profile: fetch approved reviews
{ userId: 1 }                       // user's submitted reviews
{ status: 1, created_at: -1 }      // admin moderation queue
```

**Constraints:**
- One pending or approved review per `(userId, agencyName)` pair (enforced at API layer, not DB-unique to allow rejected reviews to be resubmitted).
- Rating: integer, min 1, max 5.

---

### 2.11 `es_schema_versions` Collection

```typescript
interface EsSchemaVersionDocument {
  _id: ObjectId;
  version: number;                  // monotonically increasing integer; starts at 1
  indexName: string;                // e.g. "jobs_v1"
  aliasName: string;                // e.g. "jobs"
  status: "active" | "migrating" | "deprecated";
  mappingHash: string;              // sha256 of the mapping JSON; for change detection
  activatedAt: Date | null;
  deprecatedAt: Date | null;
  migrationNotes: string | null;
  created_at: Date;
}
```

**Indexes:**

```javascript
{ version: -1 }                     // unique: true; get latest version
{ status: 1 }                       // find active version
```

---

### 2.12 `scraper_runs` Collection

```typescript
interface ScraperRunDocument {
  _id: ObjectId;
  sourceId: ObjectId;               // ref: sources._id
  sourceName: string;               // denormalised for dashboard queries
  queueJobId: string;               // BullMQ job ID
  runType: "scheduled" | "manual" | "expiry_rescan";
  status: "running" | "success" | "partial" | "failed" | "skipped";
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  listingsDiscovered: number;
  listingsNew: number;
  listingsUpdated: number;
  listingsFailed: number;
  errorCode: string | null;         // ScraperWorkerError.code
  errorMessage: string | null;      // human-readable; no PII
  workerInstanceId: string | null;  // ECS task ID for debugging
  created_at: Date;
}
```

**Indexes:**

```javascript
{ sourceId: 1, startedAt: -1 }     // health dashboard: recent runs per source
{ status: 1, startedAt: -1 }       // failure rate calculation
{ startedAt: -1 }                   // overall recent runs
{ startedAt: 1 }                    // TTL: expireAfterSeconds: 7776000 (90 days)
```

---

## 3. ElasticSearch Index Mapping

### 3.1 Index Configuration

Index name: `jobs_v{N}` (e.g. `jobs_v1`). Live alias: `jobs`. Write alias: `jobs_write` (points to the same index under normal operation; during migration points to both old and new indexes to enable dual-write if needed).

**Settings:**

```json
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "australian_english": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "australian_stop", "snowball_english", "asciifolding"]
        },
        "classification_keyword": {
          "type": "custom",
          "tokenizer": "keyword",
          "filter": ["lowercase", "trim"]
        },
        "agency_autocomplete": {
          "type": "custom",
          "tokenizer": "edge_ngram_tokenizer",
          "filter": ["lowercase"]
        },
        "agency_search": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase"]
        }
      },
      "filter": {
        "australian_stop": {
          "type": "stop",
          "stopwords": "_english_"
        },
        "snowball_english": {
          "type": "snowball",
          "language": "English"
        }
      },
      "tokenizer": {
        "edge_ngram_tokenizer": {
          "type": "edge_ngram",
          "min_gram": 2,
          "max_gram": 20,
          "token_chars": ["letter", "digit"]
        }
      }
    },
    "index.mapping.total_fields.limit": 200
  }
}
```

### 3.2 Field Mapping

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "_mongo_id": { "type": "keyword" },

      "title": {
        "type": "text",
        "analyzer": "australian_english",
        "fields": {
          "keyword": { "type": "keyword", "ignore_above": 512 },
          "suggest": { "type": "completion" }
        }
      },

      "agency": {
        "type": "text",
        "analyzer": "agency_autocomplete",
        "search_analyzer": "agency_search",
        "fields": {
          "keyword": { "type": "keyword", "ignore_above": 256 }
        }
      },

      "location": {
        "type": "text",
        "analyzer": "australian_english",
        "fields": {
          "keyword": { "type": "keyword", "ignore_above": 256 }
        }
      },

      "classification": {
        "type": "text",
        "analyzer": "classification_keyword",
        "fields": {
          "keyword": { "type": "keyword", "ignore_above": 100 }
        }
      },

      "governmentLevel": { "type": "keyword" },
      "state": { "type": "keyword" },

      "salaryBand": {
        "type": "object",
        "properties": {
          "min": { "type": "integer" },
          "max": { "type": "integer" },
          "currency": { "type": "keyword" }
        }
      },

      "descriptionText": {
        "type": "text",
        "analyzer": "australian_english"
      },

      "applyUrl": { "type": "keyword", "index": false },

      "status": { "type": "keyword" },

      "expiryDate": { "type": "date", "format": "strict_date_optional_time" },
      "lastSeenAt": { "type": "date", "format": "strict_date_optional_time" },
      "created_at": { "type": "date", "format": "strict_date_optional_time" },
      "updated_at": { "type": "date", "format": "strict_date_optional_time" },

      "sources": {
        "type": "nested",
        "properties": {
          "sourceId": { "type": "keyword" },
          "sourceName": { "type": "keyword" },
          "sourceType": { "type": "keyword" }
        }
      }
    }
  }
}
```

### 3.3 Search Query Pattern

The standard search query combines `bool` must (keyword match) with `filter` (faceted). Faceted fields (`governmentLevel`, `state`, `classification.keyword`, `agency.keyword`, `status`) use `term`/`terms` filters (cached). Keyword match uses `multi_match` across `title^3`, `agency^2`, `descriptionText^1`.

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "<<user_query>>",
            "fields": ["title^3", "agency^2", "classification^1.5", "descriptionText^1"],
            "type": "best_fields",
            "fuzziness": "AUTO:4,8"
          }
        }
      ],
      "filter": [
        { "term": { "status": "active" } },
        { "terms": { "governmentLevel": ["<<level>>"] } },
        { "terms": { "state": ["<<state>>"] } },
        { "range": { "salaryBand.min": { "gte": "<<min>>" } } }
      ]
    }
  },
  "sort": [{ "_score": "desc" }, { "expiryDate": "asc" }],
  "from": 0,
  "size": 20,
  "track_total_hits": true
}
```

### 3.4 Versioning Strategy

- Each schema change increments the version number in `es_schema_versions`.
- **Non-breaking changes** (adding new optional fields): add to mapping, no reindex.
- **Breaking changes** (field type change, analyser change): create `jobs_v{N+1}` index, run `_reindex` API, swap alias atomically.
- Migration script: `scripts/es-migrate.ts`; requires `ES_MIGRATION_TIMEOUT_MS` (default: 3600000).
- Zero-downtime: the `jobs` alias continues to serve the old index while reindex runs. Alias swap is a single atomic operation.

---

## 4. BullMQ Queue Design

### 4.1 Queue Inventory

| Queue Name | Consumer Service | Concurrency | Retry | Dead-Letter TTL |
|---|---|---|---|---|
| `scrape-queue` | `scraper-worker` | `SCRAPE_QUEUE_CONCURRENCY` (default: 5 per ECS task) | 3 attempts, exponential backoff from 30s | 7 days |
| `es-sync-queue` | `es-sync-worker` | `ES_SYNC_CONCURRENCY` (default: 10 per ECS task) | 5 attempts, exponential backoff from 5s | 7 days |
| `notification-queue` | `notification-worker` | `NOTIFICATION_CONCURRENCY` (default: 20 per ECS task) | 3 attempts, exponential backoff from 10s | 3 days |
| `expiry-reminder-queue` | `notification-worker` | shares `NOTIFICATION_CONCURRENCY` | 3 attempts, exponential backoff from 10s | 1 day |
| `vector-queue` | `vector-worker` | `VECTOR_CONCURRENCY` (default: 3 per ECS task) | 3 attempts, exponential backoff from 60s | 14 days |
| `deletion-queue` | `account-worker` (dedicated ECS service — see note) | 2 | 5 attempts, exponential backoff from 60s | 30 days |

All queues use a shared Redis instance (`REDIS_URL`). BullMQ job deduplication (job ID as dedup key) is described per queue below.

> **Note on `deletion-queue` consumer:** Account deletion is an asynchronous, long-running operation (cascades across `saved_jobs`, `saved_searches`, `alerts`, `notifications`, refresh tokens, and the user document). It MUST run in a dedicated `account-worker` ECS service rather than inside the stateless `api` service to avoid holding open HTTP connections and to allow independent scaling and restart policies. The `account-worker` registers a BullMQ worker for `deletion-queue` only. It shares the same `MONGODB_URI` and `REDIS_URL` as other services.

### 4.2 `scrape-queue` Job Payload

```typescript
interface ScrapeQueueJob {
  jobId: string;              // BullMQ job ID = dedup key = "scrape:<<sourceId>>:<<scheduledFor>>"
                              // Rounded to 15-minute bucket to prevent near-duplicate enqueues.
  sourceId: string;           // MongoDB sources._id
  sourceName: string;
  sourceUrl: string;
  sourceType: "api" | "scrape";
  pluginId: string;
  pluginConfig: Record<string, unknown>;
  scraperRunId: string;       // MongoDB scraper_runs._id (pre-created by scheduler)
  scheduledFor: Date;
  runType: "scheduled" | "manual" | "expiry_rescan";
  expiryRescanJobId?: string; // present when runType === "expiry_rescan"
}
```

**Deduplication (resolves A1):** BullMQ's `jobId` option is set to `"scrape:${sourceId}:${bucketedScheduledFor}"` where `bucketedScheduledFor` is the scheduled time rounded down to the nearest 15-minute boundary. BullMQ will silently reject a job with the same ID if one already exists in the queue (in `waiting`, `delayed`, or `active` state). This prevents the Scheduler leader election edge case where two Scheduler instances both acquire the lock momentarily and enqueue the same source. The Redis distributed lock (Section 1.1) is the primary prevention; BullMQ dedup key is the secondary safety net.

**Retry policy:**

```typescript
const scrapeJobOptions: BullMQ.JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30000 },  // 30s, 60s, 120s
  removeOnComplete: { count: 1000 },                // keep last 1000 for dashboard
  removeOnFail: false,                              // retain failed for DLQ inspection
};
```

### 4.3 `es-sync-queue` Job Payload

```typescript
interface EsSyncQueueJob {
  jobId: string;              // BullMQ job ID = "es-sync:<<mongoJobId>>"
                              // BullMQ dedup: if same mongoJobId already queued,
                              // the later enqueue is rejected (at-least-once sync is fine;
                              // the sync worker always fetches fresh from MongoDB).
  mongoJobId: string;         // MongoDB jobs._id
  changedFields: string[];    // hint for sync worker; always fetches full doc
  enqueuedAt: Date;
}
```

### 4.4 `notification-queue` Job Payload

```typescript
interface NotificationQueueJob {
  jobId: string;              // BullMQ job ID = "notify:<<alertId>>:<<mongoJobId>>"
                              // Dedup: prevents double-enqueue if ingest service retries
  alertId: string;            // MongoDB alerts._id
  mongoJobId: string;         // MongoDB jobs._id
  userId: string;             // denormalised for fast lookup
  isNew: boolean;             // true = newly ingested; false = update
  enqueuedAt: Date;
}
```

### 4.5 `expiry-reminder-queue` Job Payload

```typescript
interface ExpiryReminderQueueJob {
  jobId: string;              // BullMQ job ID = "expiry-reminder:<<savedJobId>>:<<reminderWindowKey>>"
                              // reminderWindowKey is the date truncated to 6-hour bucket (addresses A2)
  savedJobId: string;         // MongoDB saved_jobs._id
  userId: string;
  mongoJobId: string;         // MongoDB jobs._id
  jobTitle: string;           // denormalised for email subject
  expiryDate: Date;
  enqueuedAt: Date;
}
```

### 4.6 `vector-queue` Job Payload

```typescript
interface VectorQueueJob {
  jobId: string;              // BullMQ job ID = "vector:<<mongoJobId>>"
                              // Dedup: one pending embedding job per MongoDB job
  mongoJobId: string;
  descriptionChanged: boolean;
  enqueuedAt: Date;
}
```

### 4.7 Dead-Letter Queue Pattern

BullMQ does not have a native dead-letter queue. Failed jobs that exhaust retries remain in the queue's `failed` set. A dedicated `DLQ Inspector` cron job (runs every 6 hours) queries each queue's `failed` set, logs structured JSON with `source_queue`, `job_id`, `failure_reason`, `attempt_count`, and optionally moves jobs to a `dlq-archive` queue for human inspection. CloudWatch alarm: `notification-queue` failed count > 100.

---

## 5. Scraper Plugin Interface

### 5.1 Plugin Interface

Every scraper plugin is a TypeScript module that exports a single class implementing `ScraperPlugin`. Plugins are loaded by the Scraper Worker at startup via a registry keyed on `pluginId`.

```typescript
interface ScraperPlugin {
  readonly pluginId: string;          // unique identifier; matches sources.pluginId
  readonly displayName: string;       // human-readable name

  // Fetch all current job listings from the source.
  // config is the parsed pluginConfig from the sources document.
  // Must resolve within SCRAPER_FETCH_TIMEOUT_MS (default: 60000).
  // Returns RawJobInput[] on success, or ScraperWorkerError on failure.
  fetchJobs(
    config: SourcePluginConfig,
    context: ScraperPluginContext
  ): Promise<RawJobInput[] | ScraperWorkerError>;

  // Called before fetchJobs to validate the plugin config.
  // Returns null on success, or a string describing the validation error.
  validateConfig(config: SourcePluginConfig): string | null;
}

interface SourcePluginConfig {
  sourceId: string;
  sourceUrl: string;
  pluginConfig: Record<string, unknown>;  // plugin-specific; validated by validateConfig()
}

interface ScraperPluginContext {
  sourceId: string;
  scraperRunId: string;
  logger: StructuredLogger;             // structured logger with trace_id pre-populated
  rateLimiter: RateLimiter;             // enforces minIntervalMs between requests
  robotsChecker: RobotsChecker;         // checks robots.txt before any HTTP request
  httpClient: HttpClient;               // pre-configured with User-Agent; timeout aware
  browser: PlaywrightBrowserContext | null;  // null for API-type sources
}

interface RateLimiter {
  // Waits if necessary to respect the minimum interval between requests to a domain.
  // timeout: RATE_LIMITER_WAIT_TIMEOUT_MS (default: 30000)
  waitForSlot(domain: string): Promise<void>;
}

interface RobotsChecker {
  // Returns { allowed: boolean } if the check succeeds, or ScraperWorkerError if
  // the robots.txt fetch itself fails. Timeout: ROBOTS_FETCH_TIMEOUT_MS (default: 5000)
  isAllowed(url: string, userAgent: string): Promise<{ allowed: boolean } | ScraperWorkerError>;
}

interface StructuredLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
```

### 5.2 robots.txt Integration

The `RobotsChecker` is injected into every plugin context. Plugins MUST call `robotsChecker.isAllowed(url, userAgent)` before each HTTP request. If the result is `{ allowed: false }`, the plugin MUST:
1. NOT make the request.
2. Return a `ScraperWorkerError` with `code: "ROBOTS_DISALLOWED"`.
3. Log the disallow reason via the context logger.

The `User-Agent` for all requests is `SCRAPER_USER_AGENT` (default: `"GovJobsPortalBot/1.0 (+https://govjobs.com.au/bot)"`). This satisfies NFR-004 and NFR-005.

### 5.3 Rate Limiting Implementation

The `RateLimiter` uses a per-domain token bucket stored in the worker process memory (not Redis, because rate limiting is per-worker-instance). The minimum interval between requests to the same domain is read from `sources.rateLimit.minIntervalMs`. If `sources.rateLimit.source === "robots_txt"`, the interval was parsed from the `Crawl-delay` directive. If `sources.rateLimit.source === "default"`, the value is `SCRAPER_DEFAULT_CRAWL_DELAY_MS` (default: 2000).

The worker records `lastRequestTime[domain]` in memory. Before each request, it computes `waitMs = minInterval - (now - lastRequestTime[domain])` and sleeps for `Math.max(0, waitMs)` before proceeding.

### 5.4 Built-in Plugin Registry

| pluginId | Source Type | Technology |
|---|---|---|
| `apsjobs-api` | api | REST JSON |
| `nsw-public-service-api` | api | REST JSON |
| `vic-careers-scrape` | scrape | Playwright |
| `qld-smartjobs-scrape` | scrape | Playwright |
| `seek-government-scrape` | scrape | Playwright |
| `linkedin-jobs-scrape` | scrape | Playwright (disabled by default) |
| `glassdoor-reviews-scrape` | scrape | Playwright (disabled by default) |
| `generic-html-scrape` | scrape | Playwright (configurable CSS selectors) |
| `generic-json-api` | api | REST JSON (configurable endpoint + field mapping) |

---

## 6. Notification Matching Logic

### 6.1 Alert Subscription Schema

The `alerts` collection `criteria` field uses `SearchCriteria` (Section 2.6). An alert fires when a job matches ALL specified criteria (AND logic across criteria types, OR within a single criterion list).

Formal matching rules:
- If `criteria.query` is set: job `title + " " + agency + " " + descriptionText` must contain the query (case-insensitive substring, not ES-scored).
- If `criteria.agencies` is non-empty: `job.agency` (normalised) must be in the list.
- If `criteria.classifications` is non-empty: `job.classification` (normalised) must match at least one (prefix match allowed, e.g. "APS 5" matches "APS 5-6").
- If `criteria.locations` is non-empty: `job.location` must contain at least one listed location.
- If `criteria.governmentLevels` is non-empty: `job.governmentLevel` must be in the list.
- If `criteria.states` is non-empty: `job.state` must be in the list.
- If `criteria.salaryBandMin` is set: `job.salaryBand.max >= criteria.salaryBandMin` (or salary not specified).
- If `criteria.salaryBandMax` is set: `job.salaryBand.min <= criteria.salaryBandMax` (or salary not specified).

A criterion with an empty list or null value is treated as a wildcard (no restriction).

### 6.2 Matching Algorithm Pseudocode

```
function matchAlertsForJob(job: JobDocument): AlertDocument[] {
  // 1. Fetch all active alerts from MongoDB.
  //    At scale, pre-filter by governmentLevel if index is present.
  //    Timeout: ALERT_MATCH_QUERY_TIMEOUT_MS (default: 5000)
  const activeAlerts = db.alerts.find({ status: "active" });

  // 2. In-memory filter
  const matched = [];
  for (const alert of activeAlerts) {
    if (matchesCriteria(alert.criteria, job)) {
      matched.push(alert);
    }
  }
  return matched;
}

function matchesCriteria(criteria: SearchCriteria, job: JobDocument): boolean {
  if (criteria.query) {
    const haystack = `${job.title} ${job.agency} ${job.descriptionText}`.toLowerCase();
    if (!haystack.includes(criteria.query.toLowerCase())) return false;
  }
  if (criteria.agencies.length > 0) {
    if (!criteria.agencies.map(normalise).includes(normalise(job.agency))) return false;
  }
  if (criteria.classifications.length > 0) {
    const norm = normalise(job.classification);
    if (!criteria.classifications.some(c => norm.startsWith(normalise(c)))) return false;
  }
  if (criteria.locations.length > 0) {
    const jobLoc = normalise(job.location);
    if (!criteria.locations.some(l => jobLoc.includes(normalise(l)))) return false;
  }
  if (criteria.governmentLevels.length > 0) {
    if (!criteria.governmentLevels.includes(job.governmentLevel)) return false;
  }
  if (criteria.states.length > 0) {
    if (job.state === null || !criteria.states.includes(job.state)) return false;
  }
  if (criteria.salaryBandMin !== null && job.salaryBand.max !== null) {
    if (job.salaryBand.max < criteria.salaryBandMin) return false;
  }
  if (criteria.salaryBandMax !== null && job.salaryBand.min !== null) {
    if (job.salaryBand.min > criteria.salaryBandMax) return false;
  }
  return true;
}
```

**Scalability note:** At 100k active alerts, full in-memory iteration is not acceptable. When `ALERT_MATCH_USE_INDEXED_QUERY` is set to `true` (default: false until alert count > 10,000), the matcher queries MongoDB with a compound filter on `governmentLevel` and `state` first, then applies the full in-memory filter on the reduced set. Transition threshold: `ALERT_MATCH_INDEX_THRESHOLD` (default: 10000).

### 6.3 Deduplication Key Scheme

Every notification has a `deduplicationKey` set before insert. A unique MongoDB index on this field prevents duplicate notification records (and therefore duplicate sends).

| Notification Type | Deduplication Key Format |
|---|---|
| Alert match — email | `alert:email:<<alertId>>:<<mongoJobId>>` |
| Alert match — push | `alert:push:<<alertId>>:<<mongoJobId>>` |
| Expiry reminder — email | `expiry:email:<<savedJobId>>:<<reminderWindowKey>>` |
| Expiry reminder — push | `expiry:push:<<savedJobId>>:<<reminderWindowKey>>` |

`reminderWindowKey` is the expiry date truncated to the 6-hour reminder bucket: `YYYY-MM-DD-HH` where HH is rounded down to the nearest multiple of 6 (i.e. 00, 06, 12, 18). This means at most one reminder per saved job per 6-hour window.

If the insert fails with a duplicate-key error, the notification worker logs at DEBUG level and marks the BullMQ job as complete (not failed) — it was a legitimate dedup.

### 6.4 Expiry Reminder Polling Cadence (resolves A2)

FR-003 requires a reminder when a job has a closing date 2 days from now. The L1 architecture used a daily polling cadence, which was identified in review advisory A2 as insufficient (edge case: job saved at 11pm, daily run at midnight, next run 24h later when job already closed).

**Resolution:** The expiry reminder scheduler runs as a BullMQ cron job every **6 hours** (`EXPIRY_REMINDER_CRON`, default: `"0 */6 * * *"`). It queries the `saved_jobs` collection for jobs where:
- `jobs.expiryDate` is between `now + EXPIRY_REMINDER_MIN_HOURS` and `now + EXPIRY_REMINDER_MAX_HOURS` (defaults: 24h and 72h)
- `jobs.expiryReminderSentAt` is null (no reminder sent yet)
- `jobs.status === "active"`

**Why 6 hours:** A 6-hour cadence guarantees that even a job saved at the worst possible time (1 second before the reminder window closes) will be caught by the next run at most 6 hours later, still within the 2-day window. This satisfies FR-003's acceptance criteria reliably.

**No double-send:** The `deduplicationKey` scheme (Section 6.3) ensures that even if the scheduler enqueues a reminder multiple times for the same saved job in the same 6-hour window, only one notification document is created and only one notification is sent.

---

## 7. Auth Flow Detail

### 7.1 Registration Flow

```
Client                    Web API / Auth Service           MongoDB             SES
  |                              |                            |                  |
  |  POST /api/auth/register     |                            |                  |
  |  { email, password }         |                            |                  |
  |----------------------------->|                            |                  |
  |                              | 1. Validate input          |                  |
  |                              |    (email format, pw len)  |                  |
  |                              | 2. Check email unique      |                  |
  |                              |------------------------->  |                  |
  |                              | 3. Hash password           |                  |
  |                              |    (argon2id, cost 12)     |                  |
  |                              | 4. Generate verify token   |                  |
  |                              |    (32-byte random hex)    |                  |
  |                              | 5. Hash verify token       |                  |
  |                              |    (SHA-256 for storage)   |                  |
  |                              | 6. Insert user document    |                  |
  |                              |    emailVerified: false    |                  |
  |                              |    tokenExpiresAt: +24h    |                  |
  |                              |------------------------->  |                  |
  |                              | 7. Send verification email |                  |
  |                              |    (async; do not block)   |                  |
  |                              |------------------------------------------->  |
  |  HTTP 201 { userId }         |                            |                  |
  |<-----------------------------|                            |                  |
```

**Email verification:**
- Token: 32-byte cryptographically random hex, delivered in the email as a URL query parameter.
- Token hash: SHA-256 hex hash stored in `users.emailVerificationToken`.
- Expiry: 24 hours (`EMAIL_VERIFY_TOKEN_EXPIRY_HOURS` default: 24).
- Endpoint: `GET /api/auth/verify-email?token=<<hex>>`
- On verify: sets `emailVerified: true`, clears `emailVerificationToken` and `emailVerificationTokenExpiresAt`.
- Resend: `POST /api/auth/resend-verification` (rate-limited to 3 per hour per email).

### 7.2 Email/Password Login Flow

```
Client                    Web API / Auth Service           MongoDB
  |                              |                            |
  |  POST /api/auth/login        |                            |
  |  { email, password }         |                            |
  |----------------------------->|                            |
  |                              | 1. Look up user by email   |
  |                              |------------------------->  |
  |                              | 2. Verify emailVerified    |
  |                              | 3. Verify password hash    |
  |                              |    (argon2id verify)       |
  |                              | 4. Issue JWT access token  |
  |                              |    (RS256, 15 min)         |
  |                              | 5. Generate refresh token  |
  |                              |    (32-byte random hex)    |
  |                              | 6. Hash refresh token      |
  |                              |    (sha256)                |
  |                              | 7. Insert refresh_token doc|
  |                              |------------------------->  |
  |  HTTP 200                    |                            |
  |  { accessToken, expiresIn }  |                            |
  |  Set-Cookie: refreshToken=   |                            |
  |    <<raw>>; HttpOnly;        |                            |
  |    Secure; SameSite=Strict;  |                            |
  |    Path=/api/auth/refresh;   |                            |
  |    Max-Age=2592000           |                            |
  |<-----------------------------|                            |
```

**Failed login handling:** After 5 consecutive failed login attempts within 15 minutes for the same email, the account is temporarily locked for `LOGIN_LOCKOUT_DURATION_MS` (default: 900000 — 15 minutes). Lockout state is stored in Redis with a TTL key `login:lockout:<<email_hash>>`.

### 7.3 OAuth2 Flow (Google and LinkedIn)

```
Client                 Web API              OAuth Provider         MongoDB
  |                       |                      |                    |
  | GET /api/auth/oauth/  |                      |                    |
  |   <<provider>>        |                      |                    |
  |---------------------->|                      |                    |
  |  302 redirect to      |                      |                    |
  |  provider auth URL    |                      |                    |
  |  (state=<<CSRF nonce>>|                      |                    |
  |<----------------------|                      |                    |
  |                       |                      |                    |
  | (user authenticates at provider)             |                    |
  |                       |                      |                    |
  | GET /api/auth/oauth/  |                      |                    |
  |   <<provider>>/callback?code=&state=         |                    |
  |---------------------->|                      |                    |
  |                       | 1. Verify state nonce|                    |
  |                       |    (anti-CSRF)       |                    |
  |                       | 2. Exchange code for |                    |
  |                       |    tokens            |                    |
  |                       |--------------------->|                    |
  |                       | 3. Fetch user profile|                    |
  |                       |    (email, id)       |                    |
  |                       |--------------------->|                    |
  |                       | 4. Upsert user by    |                    |
  |                       |    (provider, id)    |                    |
  |                       |------------------------------------------->|
  |                       | 5. Issue JWT + refresh token (as per login)|
  |  302 redirect to app  |                                            |
  |  with accessToken in  |                                            |
  |  fragment (SPA) OR    |                                            |
  |  direct cookie set    |                                            |
  |<----------------------|                                            |
```

**CSRF protection:** The `state` parameter is a 16-byte random hex nonce stored in a short-lived (10-minute) Redis key `oauth:state:<<nonce>>`. The callback handler verifies the nonce exists and deletes it (one-time use).

**Provider config:**

```typescript
interface OAuthProviderConfig {
  clientId: string;           // from AWS Secrets Manager
  clientSecret: string;       // from AWS Secrets Manager
  redirectUri: string;        // OAUTH_REDIRECT_BASE_URL + "/api/auth/oauth/<<provider>>/callback"
  scopes: string[];
}

const GOOGLE_SCOPES = ["openid", "email", "profile"];
const LINKEDIN_SCOPES = ["r_emailaddress", "r_liteprofile"];
```

### 7.4 Token Refresh Flow

```
Client                    Web API / Auth Service           MongoDB
  |                              |                            |
  |  POST /api/auth/refresh      |                            |
  |  Cookie: refreshToken=<<raw>>|                            |
  |----------------------------->|                            |
  |                              | 1. sha256(rawToken)        |
  |                              | 2. Look up by tokenHash    |
  |                              |------------------------->  |
  |                              | 3. Check: not expired,     |
  |                              |    not revoked             |
  |                              | 4. Check: not already used |
  |                              |    (reuse detection)       |
  |                              | 5. Mark old token usedAt   |
  |                              | 6. Issue new JWT           |
  |                              | 7. Issue new refresh token |
  |                              |    (rotation)              |
  |                              | 8. Insert new token doc    |
  |                              |------------------------->  |
  |  HTTP 200 { accessToken }    |                            |
  |  Set-Cookie: refreshToken=   |                            |
  |    <<new_raw>>               |                            |
  |<-----------------------------|                            |
```

**Refresh token reuse detection:** If `usedAt` is already set when a refresh request arrives (meaning the token has already been used), this indicates a possible theft. The system:
1. Revokes ALL refresh tokens for that user (`revokedAt = now`).
2. Returns `AuthError { code: "REFRESH_TOKEN_REUSE_DETECTED" }` → HTTP 401.
3. Logs a security event at WARN level with `userId` and `ipAddress` (masked).

**Refresh token lifetime:** `REFRESH_TOKEN_TTL_DAYS` (default: 30). Cookie `Max-Age` is set to `REFRESH_TOKEN_TTL_DAYS * 86400`. MongoDB TTL index auto-purges expired records.

### 7.5 JWT Signing Key Management

- **Algorithm:** RS256.
- **Key pair:** 2048-bit RSA stored in AWS Secrets Manager at `gobjobs/jwt-private-key` and `gobjobs/jwt-public-key`.
- **Key rotation:** Manual process. New key pair replaces old; all existing access tokens expire within 15 minutes naturally. Refresh tokens cause re-issuance with the new key.
- **Public key endpoint:** `GET /api/auth/.well-known/jwks.json` — exposes the public key as a JWKS document for potential third-party consumers.

### 7.6 Admin Role Elevation

Admin role can only be granted by:
1. Direct MongoDB write by a system operator (bootstrap process).
2. API call: `POST /api/admin/users/:id/elevate` — requires existing admin JWT + admin DB double-check.

User-supplied input cannot set `role`. The registration and profile update endpoints strip `role` from the request body via Zod schema (not `role` in the schema → silently ignored).

---

## 8. Vector Search Integration

### 8.1 Embedding Model Interface

```typescript
interface EmbeddingModel {
  readonly modelId: string;             // e.g. "text-embedding-3-small"
  readonly dimensions: number;          // output vector dimensions; e.g. 1536

  // Embed a single text string.
  // timeout: EMBEDDING_REQUEST_TIMEOUT_MS (default: 10000)
  embed(text: string): Promise<number[] | VectorWorkerError>;

  // Batch embed up to EMBEDDING_BATCH_SIZE strings (default: 100).
  // timeout: EMBEDDING_BATCH_TIMEOUT_MS (default: 60000)
  embedBatch(texts: string[]): Promise<number[][] | VectorWorkerError>;
}

// Concrete implementations
class OpenAiEmbeddingModel implements EmbeddingModel {
  // Uses OPENAI_API_KEY from Secrets Manager
  // EMBEDDING_MODEL = "text-embedding-3-small" (default)
}

class LocalEmbeddingModel implements EmbeddingModel {
  // For testing/offline use; uses a tiny ONNX model
  // Activated when VECTOR_DB_PROVIDER = "mock"
}
```

**Text prepared for embedding:** `"${job.title} ${job.agency} ${job.classification} ${job.location} ${job.descriptionText}"` truncated to `EMBEDDING_MAX_CHARS` (default: 8000) characters.

### 8.2 Semantic Search Query Path

```
Client
  |
  | GET /api/jobs/search?q=<<semantic_query>>&mode=semantic
  |
  v
Web API
  |
  | 1. Parse query parameters
  | 2. If mode=semantic (or mode=hybrid):
  |    a. Embed the query text using EmbeddingModel
  |       timeout: EMBEDDING_REQUEST_TIMEOUT_MS (10s)
  |    b. Query VectorDbAdapter.querySimilar(vector, topK=100, filter)
  |       timeout: VECTOR_QUERY_TIMEOUT_MS (default: 3000)
  |    c. Extract job IDs from VectorSearchResult[]
  |    d. Query ElasticSearch with ids filter + optional facet filters
  |       timeout: ES_QUERY_TIMEOUT_MS (default: 2000)
  |    e. Merge ES documents with vector similarity scores for re-ranking
  | 3. If mode=keyword (default):
  |    a. Query ElasticSearch directly (no vector step)
  | 4. Return merged, ranked results
```

**Latency budget for semantic search:** The 500ms p95 SLA (NFR-001) requires:
- Query embedding: ≤ 100ms (OpenAI API, p95 for small inputs)
- Vector DB query: ≤ 100ms (Weaviate/Pinecone p95 with ANN)
- ES enrichment query: ≤ 200ms
- Overhead (serialise, deserialise, network): ≤ 100ms
- Total: ≤ 500ms

If the vector DB call exceeds `VECTOR_QUERY_TIMEOUT_MS`, the system falls back to a pure keyword search (NFR-003 graceful degradation). This is logged at WARN level.

### 8.3 Weaviate vs Pinecone Selection

| Criterion | Weaviate | Pinecone |
|---|---|---|
| Self-hosted option | Yes (Docker, Kubernetes) | No (SaaS only) |
| AWS region availability | Any (self-hosted) | Limited regions |
| Cost at 500k vectors | Lower (self-hosted) | Higher (managed) |
| Operational complexity | Higher (you manage it) | Lower (fully managed) |
| Hybrid search (BM25 + vector) | Native | Requires client-side merge |
| Filter support | Rich metadata filters | Good |
| Cold start / startup | Requires warm-up | Instant |
| Vendor lock-in | Low | Higher |

**Decision (ADR-009):** Default to Weaviate deployed on ECS Fargate using `VECTOR_DB_PROVIDER=weaviate`. Pinecone is the fallback if operational capacity for self-managed Weaviate is unavailable. The `VectorDbAdapter` interface (Section 1.7) ensures the implementation is swappable with no changes to the Vector Worker or Web API. `VECTOR_DB_PROVIDER` selects the adapter at startup; valid values: `"weaviate"`, `"pinecone"`, `"mock"`.

### 8.4 Weaviate Schema

Weaviate class name: `GovJob`. Properties mirror the `VectorMetadata` interface. Vector dimension: matches `EMBEDDING_MODEL` output (1536 for `text-embedding-3-small`).

---

## 9. API Request/Response Contracts

All responses use the envelope from Section 1.4: `ApiResponse<T>` on success, `ApiErrorResponse` on error. HTTP status codes are standard. All timestamps are ISO 8601 strings in API responses.

### 9.1 `GET /api/jobs/search`

**Query parameters:**

```typescript
interface JobSearchQueryParams {
  q?: string;                    // free-text query; max 500 chars
  mode?: "keyword" | "semantic" | "hybrid";  // default: "keyword"
  agencies?: string;             // comma-separated agency names
  classifications?: string;      // comma-separated classifications
  locations?: string;            // comma-separated locations
  governmentLevels?: string;     // comma-separated: federal,state,territory,council,statutory
  states?: string;               // comma-separated: ACT,NSW,NT,QLD,SA,TAS,VIC,WA
  salaryMin?: number;            // integer AUD
  salaryMax?: number;            // integer AUD
  statusFilter?: "active" | "all";  // default: "active"
  page?: number;                 // 1-indexed; default: 1; max: 100
  pageSize?: number;             // default: 20; max: 50
  sortBy?: "relevance" | "expiry_asc" | "created_desc";  // default: "relevance"
}
```

**Response (200):**

```typescript
interface JobSearchResponse {
  data: {
    results: JobSearchResult[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    queryId: string;             // UUID for query logging; sent back for analytics
    searchMode: "keyword" | "semantic" | "hybrid" | "degraded_keyword";
    // "degraded_keyword" indicates the vector step failed and fell back
  };
  meta: {
    durationMs: number;
    facets: SearchFacets;
  };
}

interface JobSearchResult {
  id: string;                    // MongoDB _id as string
  title: string;
  agency: string;
  location: string;
  classification: string;
  governmentLevel: string;
  state: string | null;
  salaryBand: { min: number | null; max: number | null; currency: "AUD" };
  expiryDate: string | null;     // ISO 8601
  status: "active" | "expired" | "admin_expired";
  sources: { sourceName: string; sourceType: string }[];
  score: number | null;          // relevance score; null for non-relevance sorts
  createdAt: string;             // ISO 8601
}

interface SearchFacets {
  governmentLevels: FacetBucket[];
  states: FacetBucket[];
  classifications: FacetBucket[];
  agencies: FacetBucket[];       // top 20 by count
}

interface FacetBucket {
  value: string;
  count: number;
}
```

**Error responses:**
- `503 ApiErrorResponse` with `code: "SEARCH_UNAVAILABLE"` when ES is unreachable.
- `422 ApiErrorResponse` with `code: "VALIDATION_ERROR"` for invalid query parameters.
- `429 ApiErrorResponse` with `code: "RATE_LIMITED"` if rate limit exceeded.

---

### 9.2 `GET /api/jobs/:id`

**Path parameter:** `id` — MongoDB ObjectId string (24-char hex).

**Response (200):**

```typescript
interface JobDetailResponse {
  data: {
    id: string;
    title: string;
    agency: string;
    agencyId: string | null;     // if agency has a profile in the system
    location: string;
    classification: string;
    governmentLevel: string;
    state: string | null;
    salaryBand: { min: number | null; max: number | null; currency: "AUD" };
    description: string;         // HTML-sanitised
    applyUrl: string;
    sources: JobSourceDetail[];
    status: "active" | "expired" | "admin_expired";
    expiryDate: string | null;
    lastSeenAt: string;
    createdAt: string;
    updatedAt: string;
    // Contextual content (populated if associated guides exist)
    preparationResources: ContentSummary[];
    isSaved: boolean;            // false for anonymous users
  };
}

interface JobSourceDetail {
  sourceName: string;
  sourceType: "api" | "scrape";
  sourceUrl: string;             // direct link to source listing
  firstSeenAt: string;
  lastSeenAt: string;
}

interface ContentSummary {
  id: string;
  title: string;
  slug: string;
  category: string;
  excerpt: string;
}
```

**Error responses:**
- `404 ApiErrorResponse` with `code: "NOT_FOUND"` if job does not exist.
- `404 ApiErrorResponse` if `id` is not a valid ObjectId format.

**Data source:** Job detail is fetched from MongoDB (not ES) to ensure freshness. This satisfies the "MongoDB is source of truth" constraint.

---

### 9.3 `POST /api/auth/login`

**Request body:**

```typescript
interface LoginRequestBody {
  email: string;
  password: string;
}
```

**Response (200):**

```typescript
interface LoginResponse {
  data: {
    accessToken: string;         // JWT; 15-minute lifetime
    expiresIn: number;           // 900 (seconds)
    user: {
      id: string;
      email: string;
      displayName: string | null;
      role: "user" | "admin";
      emailVerified: boolean;
    };
  };
}
// Set-Cookie header: refreshToken=<<raw>>; HttpOnly; Secure; SameSite=Strict;
//   Path=/api/auth/refresh; Max-Age=2592000
```

**Error responses:**
- `401 ApiErrorResponse` with `code: "UNAUTHORIZED"` for invalid credentials.
- `403 ApiErrorResponse` with `code: "FORBIDDEN"` with message "Email not verified" for unverified accounts.
- `429 ApiErrorResponse` with `code: "RATE_LIMITED"` after 5 failed attempts.
- `422 ApiErrorResponse` for malformed request body.

---

### 9.4 `GET /api/users/me/alerts` and `POST /api/users/me/alerts`

**Authentication:** Required (JWT). Both endpoints require a valid access token.

**GET response (200):**

```typescript
interface GetAlertsResponse {
  data: {
    alerts: AlertDetail[];
    total: number;
  };
}

interface AlertDetail {
  id: string;
  name: string;
  status: "active" | "paused";
  criteria: SearchCriteria;
  channels: ("email" | "push")[];
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

**POST request body:**

```typescript
interface CreateAlertRequestBody {
  name: string;                  // required; max 100 chars
  criteria: SearchCriteriaInput; // at least one criterion must be non-empty
  channels: ("email" | "push")[]; // required; at least one
}

interface SearchCriteriaInput {
  query?: string;                // max 500 chars
  agencies?: string[];           // max 10 items
  classifications?: string[];    // max 10 items
  locations?: string[];          // max 10 items
  governmentLevels?: ("federal" | "state" | "territory" | "council" | "statutory")[];
  states?: AustralianState[];
  salaryBandMin?: number;        // non-negative integer
  salaryBandMax?: number;        // non-negative integer; must be >= salaryBandMin if both set
  statusFilter?: "active" | "all";
}
```

**POST response (201):**

```typescript
interface CreateAlertResponse {
  data: {
    alert: AlertDetail;
  };
}
```

**Error responses (both endpoints):**
- `401 ApiErrorResponse` — missing or expired JWT.
- `422 ApiErrorResponse` — validation error (empty criteria, channel mismatch, etc.).
- `409 ApiErrorResponse` with `code: "VALIDATION_ERROR"` — user has reached `ALERTS_PER_USER` limit.

**PATCH** (`/api/users/me/alerts/:id`) accepts partial `CreateAlertRequestBody`; updates `status` (active/paused), `name`, `criteria`, `channels`.
**DELETE** (`/api/users/me/alerts/:id`) sets `status: "deleted"` (soft delete).

---

### 9.5 `POST /api/auth/refresh`

**Cookie:** `refreshToken=<<raw>>` (HTTP-only; sent automatically by browser).

**Request body:** empty.

**Response (200):**

```typescript
interface RefreshResponse {
  data: {
    accessToken: string;
    expiresIn: number;           // 900
  };
}
// Set-Cookie: refreshToken=<<new_raw>>; HttpOnly; Secure; SameSite=Strict;
//   Path=/api/auth/refresh; Max-Age=2592000
```

**Error responses:**
- `401 ApiErrorResponse` with `code: "UNAUTHORIZED"` — no cookie present.
- `401 ApiErrorResponse` with `code: "REFRESH_TOKEN_INVALID"` — token not found or revoked.
- `401 ApiErrorResponse` with `code: "REFRESH_TOKEN_EXPIRED"` — token past 30-day window.
- `401 ApiErrorResponse` with `code: "REFRESH_TOKEN_REUSE_DETECTED"` — all tokens revoked.

---

## 10. Configuration and Environment Variables

All environment variables are loaded at process startup and validated via Zod. Missing required variables with no default cause a hard startup failure with a descriptive error message. Secrets (marked with `[SECRET]`) are loaded from AWS Secrets Manager via the `@aws-sdk/client-secrets-manager` SDK, not from process environment directly in production.

### 10.1 Shared (all services)

| Variable | Type | Default | Description |
|---|---|---|---|
| `NODE_ENV` | `"development" \| "staging" \| "production"` | `"development"` | Runtime environment |
| `LOG_LEVEL` | `"debug" \| "info" \| "warn" \| "error"` | `"info"` | Structured log level |
| `SERVICE_NAME` | `string` | required | ECS service identifier; included in all log entries |
| `AWS_REGION` | `string` | `"ap-southeast-2"` | AWS region |
| `REDIS_URL` | `string` [SECRET] | required | Redis connection URL (includes auth) |
| `MONGODB_URI` | `string` [SECRET] | required | MongoDB Atlas / DocumentDB connection string |

### 10.2 Web API Service (`api`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | `number` | `3000` | Express listen port |
| `API_REQUEST_TIMEOUT_MS` | `number` | `5000` | Per-request timeout |
| `API_RATE_LIMIT_REQUESTS` | `number` | `300` | Max requests per window per IP |
| `API_RATE_LIMIT_WINDOW_MS` | `number` | `60000` | Rate limit window in ms |
| `API_MAX_BODY_SIZE_BYTES` | `number` | `102400` | Max request body size (100KB) |
| `JWT_PRIVATE_KEY` | `string` [SECRET] | required | RS256 private key PEM string |
| `JWT_PUBLIC_KEY` | `string` [SECRET] | required | RS256 public key PEM string |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | `number` | `900` | JWT access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `number` | `30` | Refresh token lifetime in days |
| `GOOGLE_CLIENT_ID` | `string` [SECRET] | required | Google OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | `string` [SECRET] | required | Google OAuth2 client secret |
| `LINKEDIN_CLIENT_ID` | `string` [SECRET] | required | LinkedIn OAuth2 client ID |
| `LINKEDIN_CLIENT_SECRET` | `string` [SECRET] | required | LinkedIn OAuth2 client secret |
| `OAUTH_REDIRECT_BASE_URL` | `string` | required | Base URL for OAuth2 callbacks (e.g. `https://govjobs.com.au`) |
| `ELASTICSEARCH_URL` | `string` [SECRET] | required | AWS OpenSearch endpoint URL |
| `ELASTICSEARCH_USERNAME` | `string` [SECRET] | optional | ES basic auth username (if not IAM auth) |
| `ELASTICSEARCH_PASSWORD` | `string` [SECRET] | optional | ES basic auth password |
| `ES_QUERY_TIMEOUT_MS` | `number` | `2000` | Timeout for ES search queries |
| `VECTOR_DB_PROVIDER` | `"weaviate" \| "pinecone" \| "mock"` | `"weaviate"` | Vector DB adapter selection |
| `WEAVIATE_URL` | `string` | required if provider=weaviate | Weaviate endpoint |
| `WEAVIATE_API_KEY` | `string` [SECRET] | optional | Weaviate auth key |
| `PINECONE_API_KEY` | `string` [SECRET] | required if provider=pinecone | Pinecone API key |
| `PINECONE_INDEX_NAME` | `string` | required if provider=pinecone | Pinecone index name |
| `OPENAI_API_KEY` | `string` [SECRET] | required (unless mock) | OpenAI API key for embeddings |
| `EMBEDDING_MODEL` | `string` | `"text-embedding-3-small"` | OpenAI embedding model |
| `VECTOR_QUERY_TIMEOUT_MS` | `number` | `3000` | Timeout for vector DB queries |
| `EMBEDDING_REQUEST_TIMEOUT_MS` | `number` | `10000` | Timeout for embedding API calls |
| `AUTH_ADMIN_CHECK_TIMEOUT_MS` | `number` | `2000` | Timeout for admin role DB check |
| `EMAIL_VERIFY_TOKEN_EXPIRY_HOURS` | `number` | `24` | Email verification token lifetime |
| `LOGIN_LOCKOUT_DURATION_MS` | `number` | `900000` | Account lockout duration after failed logins |
| `ADSENSE_PUBLISHER_ID` | `string` | optional | Google AdSense publisher ID; if absent, no ads rendered |
| `SAVED_SEARCHES_PER_USER` | `number` | `20` | Max saved searches per user |
| `ALERTS_PER_USER` | `number` | `10` | Max alerts per user |
| `ALERT_MATCH_INDEX_THRESHOLD` | `number` | `10000` | Alert count above which indexed query is used |
| `ALERT_MATCH_USE_INDEXED_QUERY` | `boolean` | `false` | Force indexed alert matching query |
| `ALERT_MATCH_QUERY_TIMEOUT_MS` | `number` | `5000` | Timeout for alert matching DB query |

### 10.3 Scraper Scheduler Service (`scheduler`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `SOURCE_POLL_INTERVAL_SECONDS` | `number` | `300` | How often to poll MongoDB for due sources |
| `EXPIRY_PRESCAN_HOURS` | `number` | `72` | Hours before expiry to begin high-frequency re-scans |
| `EXPIRY_POSTSCAN_HOURS` | `number` | `48` | Hours after expiry to continue re-scans |
| `EXPIRY_RESCAN_INTERVAL_HOURS` | `number` | `12` | Re-scan frequency during expiry window |
| `SCHEDULER_LOCK_TTL_MS` | `number` | `90000` | Redis leader lock TTL in ms |
| `SCHEDULER_LOCK_HEARTBEAT_INTERVAL_MS` | `number` | `30000` | Heartbeat interval to extend lock TTL |
| `SCHEDULER_CYCLE_TIMEOUT_MS` | `number` | `60000` | Hard timeout for a single scheduling cycle |

### 10.4 Scraper Worker Service (`scraper-worker`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `SCRAPE_QUEUE_CONCURRENCY` | `number` | `5` | Concurrent BullMQ jobs per ECS task |
| `SCRAPER_FETCH_TIMEOUT_MS` | `number` | `60000` | Per-plugin fetchJobs timeout |
| `SCRAPER_DEFAULT_CRAWL_DELAY_MS` | `number` | `2000` | Default inter-request delay when robots.txt has no Crawl-delay |
| `SCRAPER_USER_AGENT` | `string` | `"GovJobsPortalBot/1.0 (+https://govjobs.com.au/bot)"` | HTTP User-Agent for all scraper requests |
| `ROBOTS_CACHE_TTL_SECONDS` | `number` | `3600` | TTL for robots.txt in-memory cache |
| `ROBOTS_FETCH_TIMEOUT_MS` | `number` | `5000` | Timeout for robots.txt HTTP fetch |
| `RATE_LIMITER_WAIT_TIMEOUT_MS` | `number` | `30000` | Max wait time in rate limiter before error |
| `INGEST_SERVICE_URL` | `string` | required | Internal URL of the Ingest Service |
| `INGEST_REQUEST_TIMEOUT_MS` | `number` | `30000` | Timeout for POST /internal/ingest |
| `MAX_INGEST_BATCH_SIZE` | `number` | `500` | Max jobs per ingest request batch |
| `PLAYWRIGHT_BROWSER` | `"chromium" \| "firefox" \| "webkit"` | `"chromium"` | Playwright browser engine |

### 10.5 ES Sync Worker Service (`es-sync-worker`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `ES_SYNC_CONCURRENCY` | `number` | `10` | Concurrent BullMQ jobs per ECS task |
| `ES_SYNC_TIMEOUT_MS` | `number` | `10000` | Timeout for single document sync |
| `ES_BULK_TIMEOUT_MS` | `number` | `30000` | Timeout for bulk sync batch |
| `ES_MIGRATION_TIMEOUT_MS` | `number` | `3600000` | Timeout for full index migration (1 hour) |

### 10.6 Notification Worker Service (`notification-worker`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `NOTIFICATION_CONCURRENCY` | `number` | `20` | Concurrent BullMQ jobs per ECS task |
| `EXPIRY_REMINDER_CRON` | `string` | `"0 */6 * * *"` | Cron expression for expiry reminder scheduler |
| `EXPIRY_REMINDER_MIN_HOURS` | `number` | `24` | Minimum hours until expiry to trigger reminder |
| `EXPIRY_REMINDER_MAX_HOURS` | `number` | `72` | Maximum hours until expiry to trigger reminder |
| `AWS_SES_REGION` | `string` | `"ap-southeast-2"` | SES region (may differ from main region) |
| `SES_FROM_ADDRESS` | `string` | required | Verified SES sender address |
| `SES_CONFIGURATION_SET` | `string` | optional | SES configuration set name for delivery tracking |
| `FCM_PROJECT_ID` | `string` [SECRET] | required | Firebase project ID |
| `FCM_PRIVATE_KEY` | `string` [SECRET] | required | Firebase service account private key |
| `FCM_CLIENT_EMAIL` | `string` [SECRET] | required | Firebase service account email |
| `NOTIFICATION_DLQ_CHECK_CRON` | `string` | `"0 */6 * * *"` | DLQ inspector run frequency |

### 10.7 Vector Worker Service (`vector-worker`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `VECTOR_CONCURRENCY` | `number` | `3` | Concurrent BullMQ jobs per ECS task |
| `VECTOR_EMBED_TIMEOUT_MS` | `number` | `30000` | Timeout for embed + upsert cycle |
| `EMBEDDING_BATCH_SIZE` | `number` | `100` | Max texts per batch embed call |
| `EMBEDDING_BATCH_TIMEOUT_MS` | `number` | `60000` | Timeout for batch embedding call |
| `EMBEDDING_MAX_CHARS` | `number` | `8000` | Max text chars before truncation |

### 10.8 Startup Validation

All services run a Zod validation of all required environment variables on startup. If any required variable is absent or type-invalid, the process logs a descriptive error (listing all missing/invalid variables) and exits with code 1. This prevents silent misconfiguration in production.

---

## Appendix A: Error Code Registry

A consolidated registry of all typed error codes to ensure uniqueness and consistent naming:

| Error Code | Component | HTTP Equivalent | Meaning |
|---|---|---|---|
| `UNAUTHORIZED` | Web API | 401 | Missing or invalid JWT |
| `FORBIDDEN` | Web API | 403 | Valid JWT but insufficient role |
| `NOT_FOUND` | Web API | 404 | Resource does not exist |
| `VALIDATION_ERROR` | Web API | 422 | Request body/params failed validation |
| `SEARCH_UNAVAILABLE` | Web API | 503 | ElasticSearch unreachable |
| `RATE_LIMITED` | Web API | 429 | Request rate exceeded |
| `INTERNAL_ERROR` | Web API | 500 | Unhandled internal exception |
| `INVALID_CREDENTIALS` | Auth | 401 | Wrong email or password |
| `EMAIL_NOT_VERIFIED` | Auth | 403 | Account exists but email not verified |
| `EMAIL_ALREADY_REGISTERED` | Auth | 409 | Registration with existing email |
| `OAUTH_PROVIDER_ERROR` | Auth | 502 | Upstream OAuth2 provider error |
| `REFRESH_TOKEN_INVALID` | Auth | 401 | Token not found or revoked |
| `REFRESH_TOKEN_EXPIRED` | Auth | 401 | Token past TTL |
| `REFRESH_TOKEN_REUSE_DETECTED` | Auth | 401 | Token reuse — security event |
| `ACCOUNT_DELETED` | Auth | 403 | Account scheduled for deletion |
| `LOCK_ACQUIRE_FAILED` | Scheduler | — | Redis leader lock held by other instance |
| `CRON_PARSE_ERROR` | Scheduler | — | Invalid cron expression in DB |
| `ENQUEUE_FAILED` | Scheduler | — | BullMQ enqueue error |
| `ROBOTS_DISALLOWED` | Scraper | — | robots.txt disallows this URL |
| `HTTP_4XX` | Scraper | — | Source returned 4xx (no retry) |
| `HTTP_5XX` | Scraper | — | Source returned 5xx (retry eligible) |
| `NETWORK_TIMEOUT` | Scraper | — | Fetch timed out (retry eligible) |
| `PLAYWRIGHT_CRASH` | Scraper | — | Browser crashed (ECS restarts task) |
| `PARSE_ERROR` | Scraper | — | Failed to parse scraped HTML/JSON |
| `VALIDATION_FAILED` | Ingest | 400 | Invalid raw job input |
| `BATCH_TOO_LARGE` | Ingest | 400 | Batch exceeds MAX_INGEST_BATCH_SIZE |
| `STORAGE_ERROR` | Ingest | 500 | MongoDB write failure |
| `ES_UNAVAILABLE` | ES Sync | — | OpenSearch unreachable |
| `MAPPING_CONFLICT` | ES Sync | — | Field mapping version mismatch |
| `BULK_PARTIAL_FAILURE` | ES Sync | — | Some documents failed in bulk op |
| `EMBEDDING_API_ERROR` | Vector Worker | — | OpenAI API error |
| `VECTOR_DB_UNAVAILABLE` | Vector Worker | — | Vector DB unreachable |
| `SES_SEND_FAILED` | Notification | — | SES delivery failure |
| `FCM_SEND_FAILED` | Notification | — | FCM delivery failure |
| `FCM_TOKEN_INVALID` | Notification | — | FCM token expired or invalid |
| `DEDUP_CHECK_FAILED` | Notification | — | Deduplication index check error |

---

## Appendix B: Concurrency and Isolation Summary

| Resource | Concurrent Readers | Concurrent Writers | Isolation Mechanism |
|---|---|---|---|
| MongoDB `jobs` | Web API (read), ES Sync Worker (read), Notification Worker (read), Scraper Worker via Ingest (write) | Ingest Service | MongoDB 3-node replica set; write concern `majority`; Ingest uses transactions for upsert + source append |
| MongoDB `alerts` | Notification Worker (read) | Web API (write) | No shared write contention; reads are eventual-consistent |
| MongoDB `refresh_tokens` | Auth Service (read on refresh) | Auth Service (write on issue, use, revoke) | Atomic findOneAndUpdate for token rotation; unique index on `tokenHash` |
| BullMQ queues | Multiple worker ECS tasks per queue | Ingest Service + Notification Worker (enqueue) | BullMQ distributed locking (Redis SET NX) on job processing; `jobId` dedup prevents double-enqueue |
| Redis leader lock | Scheduler instances (competing acquire) | Single winning Scheduler instance | `SET NX EX` semantics; lock value is UUID to prevent foreign DEL |
| ES index | Web API (query via alias) | ES Sync Worker (bulk index via write alias) | ES alias swap is atomic; readers never address versioned index directly |
| Vector DB | Web API (query) | Vector Worker (upsert) | No coordination required; upserts are idempotent by job ID |
| robots.txt cache | Multiple Scraper Worker goroutines | RobotsChecker (write on cache miss) | In-process LRU cache; single-process per ECS task (no shared state across tasks) |

**Deregistration paths:**
- FCM token invalidated: `FCM_TOKEN_INVALID` error → Notification Worker removes the specific token from `users.fcmTokens` via an atomic `$pull` update (see Section 1.8).
- OAuth identity unlinked: `DELETE /api/users/me/oauth/:provider` removes the identity from `oauthIdentities` array. If it was the only identity and no password exists, the endpoint returns 409.
- Refresh token revoked: All tokens for a user revoked via `DELETE /api/auth/sessions` (logout-all).
- Alert deregistered: `DELETE /api/users/me/alerts/:id` soft-deletes with `status: "deleted"`. Notification Worker skips `deleted` alerts.
- Source disabled: `PATCH /api/admin/sources/:id` with `{ enabled: false }`. Scheduler skips sources with `enabled: false` on next cycle (within 5 minutes).
