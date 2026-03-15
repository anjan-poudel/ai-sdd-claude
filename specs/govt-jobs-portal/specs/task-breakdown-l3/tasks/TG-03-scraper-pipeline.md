# TG-03: Scraper Pipeline

> **Jira Epic:** Scraper Pipeline

## Description

Implements the complete scraping and ingestion pipeline: the Ingest Service (deduplication + MongoDB upsert + downstream event publishing), the Scraper Scheduler (Redis leader lock, cron scheduling, expiry re-scan enqueue), the Scraper Worker framework (robots.txt check, rate limiter, Playwright stealth, plugin registry), two production scraper plugins (APSjobs + NSW Public Service Commission), the ElasticSearch Sync Worker, the Vector Embedding Worker, and the expiry tracking and re-scan scheduler. This is the highest-risk group — deduplication accuracy and scheduler correctness are critical-path items.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| T-013 | Implement Ingest Service with deduplication and event publishing | L | T-002, T-003, T-004, T-006 | HIGH |
| T-014 | Implement Scraper Scheduler with Redis leader lock | M | T-004, T-005 | HIGH |
| T-015 | Implement Scraper Worker framework: robots.txt, rate limiter, Playwright, plugin registry | L | T-004, T-013 | CRITICAL |
| T-016 | Implement APSjobs API plugin and NSW Public Service Commission API plugin | M | T-015 | HIGH |
| T-017 | Implement ElasticSearch Sync Worker | M | T-003, T-004, T-006 | MEDIUM |
| T-018 | Implement Vector Embedding Worker | M | T-004, T-006 | HIGH |
| T-019 | Implement expiry tracking scheduler and re-scan logic | M | T-014, T-002 | MEDIUM |

---

## T-013: Implement Ingest Service with deduplication and event publishing

**Design-l2 reference:** Section 1.3 (Ingest Service), Section 2.1 (`jobs` collection), Section 4.2–4.6 (queue payloads), Section 3.3 (deduplication key)

### Description

Implement the internal HTTP service `POST /internal/ingest` that accepts batches of raw job input, deduplicates them using SHA-256 composite key + Levenshtein secondary fuzzy match, upserts canonical job records in MongoDB, and publishes three BullMQ events per upserted job (ES sync, notification, vector). Runs as a module within the API service or as a standalone Express app on a separate internal port (`INGEST_PORT`, default 4000). Not exposed on the public ALB.

### Acceptance criteria

- `POST /internal/ingest` with a valid `IngestRequest` (max 500 jobs) returns `HTTP 200 IngestResponse` with correct `created`, `updated`, `duplicatesSkipped` counts.
- The deduplication key is computed as `sha256(normalise(agency) + "|" + normalise(title) + "|" + normalise(location) + "|" + normalise(classification))` where `normalise = (s) => s.toLowerCase().trim().replace(/\s+/g, ' ')`.
- A job with an existing `deduplicationKey` is updated (not re-created); the `sources` array has the new source appended if it is not already present.
- A near-duplicate where Levenshtein distance between the incoming key and an existing key is ≤ 2 is treated as a duplicate (action: `"updated"`).
- After a successful upsert of a new job, three BullMQ jobs are enqueued: one in `es-sync-queue`, one in `notification-queue`, one in `vector-queue` (only when `isNew` or description changed).
- The three BullMQ enqueues and the MongoDB upsert are wrapped in a MongoDB multi-document transaction that aborts all on any failure.
- `POST /internal/ingest` with more than 500 jobs returns `HTTP 400` with `code: "BATCH_TOO_LARGE"`.
- `description` HTML is sanitised using `sanitize-html` before storage (strips script tags, event handlers, iframe).
- `descriptionText` is populated by stripping all HTML tags from the sanitised `description`.

### Implementation notes

- File: `services/api/src/internal/ingest.ts` (or `services/ingest/src/main.ts` if standalone).
- Levenshtein implementation: use `fastest-levenshtein` package; compute on the normalised composite string (not on individual fields).
- MongoDB transaction pattern:
  ```typescript
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const job = await Job.findOneAndUpdate(
      { deduplicationKey },
      { $set: { ...fields }, $addToSet: { sources: newSource } },
      { upsert: true, new: true, session }
    );
    await enqueueEsSync(job._id.toString(), session);  // within same session
    await session.commitTransaction();
  } catch (e) {
    await session.abortTransaction();
    throw e;
  }
  ```
- BullMQ enqueue within transaction: the BullMQ enqueue happens outside the MongoDB session (Redis is not part of the MongoDB transaction) but immediately after commit in a `finally` cleanup step. Accept at-most-once risk on process crash between commit and enqueue — the ES Sync backfill job (T-019) handles recovery.
- `scraperRunId` from the request body must be validated against the `scraper_runs` collection; return `SCRAPER_RUN_NOT_FOUND` if absent.
- `description` sanitisation: `sanitize-html` with `allowedTags: ['p','b','i','em','strong','ul','ol','li','br','a']`, `allowedAttributes: { a: ['href'] }`.

### Test requirements

- Unit test: `computeDeduplicationKey({ agency: "Dept of Finance", title: " Senior Policy Officer ", ... })` returns the expected SHA-256 hex.
- Unit test with fixture: ingest a batch of 3 jobs where job[1] and job[2] have the same deduplication key — only 2 `JobDocument` records are created; the duplicate is skipped.
- Unit test: Levenshtein near-duplicate detection — a job with `agency: "Departmnt of Finance"` (typo, distance 1 from existing) is detected as a duplicate.
- Integration test: ingest a new job, confirm `es-sync-queue`, `notification-queue`, and `vector-queue` each have one job enqueued.
- Integration test: ingest the same job twice — second call returns `action: "updated"` not `action: "created"`.
- Integration test: batch of 501 jobs returns 400 `BATCH_TOO_LARGE`.
- Unit test: HTML description with `<script>alert('xss')</script>` is stripped from the stored `description`.

### Estimated complexity: L

---

## T-014: Implement Scraper Scheduler with Redis leader lock

**Design-l2 reference:** Section 1.1 (Scheduler interfaces), Section 4.2 (`scrape-queue` payload), Section 10.3 (Scheduler env vars)

### Description

Implement the `scheduler` service: the `SchedulerService` with `start()`, `stop()`, and `runCycle()`. Leader election uses `SET NX EX` to acquire `scheduler:leader-lock` with TTL 90s. A heartbeat goroutine extends the lock TTL every 30s via `PEXPIRE`. On each cycle: poll MongoDB `sources` collection for enabled sources with `nextRunAt <= now`, compute next run time from `cronExpression` using `cron-parser`, enqueue `ScrapeQueueJob` with BullMQ-level deduplication, update `sources.nextRunAt`. Graceful shutdown: complete current cycle, release lock via `DEL scheduler:leader-lock` only if the lock value matches the instance UUID.

### Acceptance criteria

- When two Scheduler instances start simultaneously, only one acquires the lock per cycle; the other logs `"LOCK_ACQUIRE_FAILED"` at INFO level and skips the cycle.
- A source with `cronExpression: "0 */6 * * *"` that last ran at 08:00 is enqueued at 14:00 (next due time: 12:00 — it is overdue).
- `runCycle()` returns a `SchedulerResult` with `sourcesEvaluated`, `jobsEnqueued`, `sourcesSkipped`, and `errors` fields.
- A source with `enabled: false` is included in `sourcesSkipped` and is NOT enqueued.
- A source with an invalid `cronExpression` produces a `SchedulerError { code: "CRON_PARSE_ERROR" }` in the result but does NOT abort the cycle for other sources.
- After `stop()` is called, the Redis lock key `scheduler:leader-lock` is deleted (confirmed by `redis.exists('scheduler:leader-lock') === 0`).
- The scheduler heartbeat: while a cycle is running longer than 30s, the lock TTL is extended; the lock does not expire mid-cycle.
- Each `ScrapeQueueJob` enqueued has the bucket-aligned `jobId` (15-minute bucket) to prevent duplicate enqueues.

### Implementation notes

- File: `services/scheduler/src/scheduler.service.ts`.
- Redis lock acquire: `await redis.set('scheduler:leader-lock', instanceUuid, 'NX', 'PX', SCHEDULER_LOCK_TTL_MS)` — returns `"OK"` or `null`.
- Lock value UUID: generated at service startup with `crypto.randomUUID()`.
- Lock release: `if (await redis.get('scheduler:leader-lock') === instanceUuid) { await redis.del('scheduler:leader-lock'); }` — this prevents a foreign DEL if the lock was re-acquired by another instance.
- Heartbeat: use `setInterval` with `SCHEDULER_LOCK_HEARTBEAT_INTERVAL_MS` (30000); call `redis.pexpire('scheduler:leader-lock', SCHEDULER_LOCK_TTL_MS)` if the current lock value matches the instance UUID.
- `cron-parser`: `CronExpressionParser.parse(cronExpression).next().toDate()` to compute `nextRunAt`.
- Polling loop: `setInterval(() => this.runCycle(), SOURCE_POLL_INTERVAL_SECONDS * 1000)`.
- `sources.nextRunAt` update: `Source.findByIdAndUpdate(sourceId, { $set: { nextRunAt, lastRunAt: now, lastRunStatus: 'running' } })`.

### Test requirements

- Unit test: `runCycle()` with a mocked Redis `SET NX` that returns `null` (lock held) — confirms `SchedulerError { code: "LOCK_ACQUIRE_FAILED" }` and no sources are evaluated.
- Unit test: `runCycle()` evaluates a source with `enabled: false` and marks it `sourcesSkipped`.
- Unit test: a source with invalid cron expression produces `CRON_PARSE_ERROR` but other sources are still processed.
- Integration test: start two Scheduler instances against the same Redis; confirm exactly one enqueues jobs per cycle (not double).
- Integration test: lock heartbeat — simulate a 60-second cycle, verify the lock key still exists in Redis after 45s (heartbeat extended it before the 90s TTL expired).
- Unit test: `graceful stop` confirms the lock key is deleted only if the value matches the instance UUID.

### Estimated complexity: M

---

## T-015: Implement Scraper Worker framework: robots.txt, rate limiter, Playwright, plugin registry

**Design-l2 reference:** Section 1.2 (Scraper Workers), Section 5 (Scraper Plugin Interface), Section 5.2 (robots.txt), Section 5.3 (Rate Limiting), Section 10.4 (Scraper Worker env vars)

### Description

Implement the `scraper-worker` service that: registers a BullMQ worker on `scrape-queue`; for each job, loads the appropriate plugin from the plugin registry by `pluginId`; injects `ScraperPluginContext` (logger, rateLimiter, robotsChecker, httpClient, browser); calls `plugin.fetchJobs(config, context)`; batches results to `POST /internal/ingest`; updates `scraper_runs` record. Implement `RobotsChecker` (LRU cache, `robots-parser` npm package), `RateLimiter` (per-domain token bucket), and Playwright browser context creation with stealth plugin.

### Acceptance criteria

- A BullMQ job for a registered `pluginId` calls `plugin.fetchJobs()`, submits results to ingest, and updates the `scraper_runs` record with the final status.
- `RobotsChecker.isAllowed(url, userAgent)` fetches `robots.txt` for the domain once per `ROBOTS_CACHE_TTL_SECONDS` (3600s) and caches the parsed result (max 500 entries LRU).
- A URL disallowed by `robots.txt` causes the worker to return `ScraperWorkerError { code: "ROBOTS_DISALLOWED" }` and mark the BullMQ job as complete (not failed — it was intentionally skipped).
- `RateLimiter.waitForSlot(domain)` waits the correct amount of time between consecutive requests to the same domain based on `sources.rateLimit.minIntervalMs`.
- The HTTP User-Agent for all requests is `SCRAPER_USER_AGENT` (default: `"GovJobsPortalBot/1.0 (+https://govjobs.com.au/bot)"`).
- Playwright browser context uses `playwright-extra` with `puppeteer-extra-plugin-stealth` (adapted for Playwright) to avoid bot detection.
- If `plugin.fetchJobs()` throws an unhandled exception, the scraper_run record is marked `status: "failed"` and the BullMQ job is allowed to retry up to 3 times with exponential backoff.
- An HTTP 4xx from the source is logged and the job is NOT retried (marked failed immediately).
- An HTTP 5xx or network timeout is retried up to 3 times with 30s/60s/120s backoff.
- A plugin that is not in the registry causes the job to fail immediately with a clear log message.

### Implementation notes

- File: `services/scraper-worker/src/worker.ts`.
- Plugin registry: a `Map<pluginId, ScraperPlugin>` populated at startup by importing and instantiating each plugin class.
- `RobotsChecker`: use `node-lru-cache` (LRU with max 500) and `robots-parser` npm package. Cache key: `${scheme}://${host}`.
- Playwright stealth: `playwright-extra` with the stealth plugin (`@extra/stealth`) applied to `chromium`.
- HTTP client for API-type plugins: use Node.js built-in `fetch` (available since Node 18) with the custom User-Agent header.
- Rate limiter memory: `lastRequestTime: Map<domain, number>` — compute `waitMs = minIntervalMs - (Date.now() - lastRequestTime.get(domain) ?? 0)`.
- `scraper_runs` update on completion: `ScraperRun.findByIdAndUpdate(scraperRunId, { $set: { status, completedAt, durationMs, listingsDiscovered, listingsNew, listingsUpdated, errorCode } })`.
- Emit structured log metric after each run (NFR-006): `logger.info("scraper-run-complete", { source_name, run_start, run_end, listings_discovered, listings_new, listings_updated, status })`.

### Test requirements

- Unit test with fixture `robots.txt` containing `Disallow: /jobs/` for `User-agent: *`: `isAllowed("https://example.com/jobs/vacancy-123", "GovJobsPortalBot/1.0")` returns `{ allowed: false }`.
- Unit test with fixture `robots.txt` containing `Crawl-delay: 5`: `getMinInterval("example.com")` returns 5000 (ms).
- Unit test: RobotsChecker cache — second call for the same domain does not make a new HTTP request.
- Unit test: `RateLimiter.waitForSlot("example.com")` called twice in rapid succession causes the second call to wait ~2000ms (default interval).
- Unit test: plugin not in registry causes job failure with `errorCode: "UNKNOWN_PLUGIN"`.
- Integration test: end-to-end worker test with a mock plugin that returns 2 jobs and a mock ingest service — confirm `scraper_runs` record shows `listingsDiscovered: 2`, `status: "success"`.
- Unit test: HTTP 404 from source — job marked failed, no retry.
- Unit test: HTTP 503 from source on first attempt — job is retried.

### Estimated complexity: L

---

## T-016: Implement APSjobs API plugin and NSW Public Service Commission API plugin

**Design-l2 reference:** Section 5.1 (ScraperPlugin interface), Section 5.4 (Built-in Plugin Registry)

### Description

Implement two production scraper plugins: `apsjobs-api` (APSJobs REST API, `pluginId: "apsjobs-api"`) and `nsw-public-service-api` (NSW Public Service Commission REST API, `pluginId: "nsw-public-service-api"`). Both are API-type plugins (no Playwright). Each plugin fetches paginated job listings from the respective REST API, maps the response to `RawJobInput[]`, and handles pagination until all listings are retrieved or `MAX_INGEST_BATCH_SIZE` is reached per batch.

### APSjobs API details

- Base URL: `https://api.apsjobs.gov.au/v1/job/search` (paginated, `page` and `pageSize` params).
- Response shape: `{ jobs: [{ id, title, agencyName, location, classification, salaryMin, salaryMax, closingDate, description, applyUrl }], totalCount, page }`.
- `pluginConfig` fields expected: `{ apiKey?: string, pageSize: number (default 100) }`.
- `governmentLevel` mapping: always `"federal"` for APSJobs.
- Rate limit: respect `Crawl-delay` from `robots.txt` at `https://apsjobs.gov.au/robots.txt`.

### NSW Public Service Commission API details

- Base URL: `https://iworkfor.nsw.gov.au/api/jobs` (paginated).
- Response shape: `{ items: [{ jobId, jobTitle, department, location, grade, salaryFrom, salaryTo, expiryDate, summary, jobUrl }], total, page }`.
- `pluginConfig` fields expected: `{ pageSize: number (default 50) }`.
- `governmentLevel` mapping: always `"state"`, `state: "NSW"`.

### Acceptance criteria

- `apsjobs-api` plugin with a fixture JSON response (1 page, 3 jobs) returns exactly 3 `RawJobInput` objects with correct field mappings.
- `nsw-public-service-api` plugin with a fixture JSON response (1 page, 5 jobs) returns exactly 5 `RawJobInput` objects with correct field mappings.
- Both plugins call `robotsChecker.isAllowed(url, userAgent)` before each HTTP request.
- Both plugins call `rateLimiter.waitForSlot(domain)` before each HTTP request.
- Pagination: if `totalCount > pageSize`, both plugins fetch subsequent pages until all listings are retrieved or `MAX_INGEST_BATCH_SIZE` is hit.
- Both plugins implement `validateConfig()`: missing required `pluginConfig` fields return a descriptive error string.
- Both plugins handle `HTTP 429 Too Many Requests` by returning `ScraperWorkerError { code: "RATE_LIMIT_EXCEEDED", retryAfterMs }` (parsed from `Retry-After` header).
- `expiryDate` field: if missing or unparseable, set to `null` (not an error condition).

### Implementation notes

- File: `services/scraper-worker/src/plugins/apsjobs-api.plugin.ts` and `nsw-public-service-api.plugin.ts`.
- Both plugins use `context.httpClient` (pre-configured with User-Agent) not raw `fetch`.
- Field mapping function: write a dedicated `mapApsJobsResponseToRawInput(apiJob, sourceId, sourceUrl, sourceName): RawJobInput` function — this is the key testable unit.
- `salaryBand`: if `salaryMin` and `salaryMax` are missing, set both to `null`.
- `classification`: normalise to a consistent format (e.g. strip extra whitespace, title-case).
- `applyUrl` mapping: if the API returns a relative URL, prefix with the base domain.
- Use fixture JSON files in `services/scraper-worker/src/plugins/__fixtures__/` for tests.

### Test requirements

- Unit test (APSjobs): `mapApsJobsResponseToRawInput` with fixture JSON `apsjobs-fixture.json` (3 jobs) returns 3 `RawJobInput` objects with all required fields non-null (except optional `expiryDate`).
- Unit test (NSW): `mapNswJobResponseToRawInput` with fixture JSON `nsw-fixture.json` (5 jobs) returns 5 `RawJobInput` objects with `state: "NSW"`.
- Unit test: `validateConfig({ pageSize: "not-a-number" })` returns a non-null validation error string.
- Unit test: robots.txt disallowed for APSjobs returns `ROBOTS_DISALLOWED` without making the API call (mock `robotsChecker.isAllowed` to return `{ allowed: false }`).
- Integration test with `nock`: APSjobs API returns 2 pages of results; plugin fetches both pages and returns correct total.
- Unit test: HTTP 429 response causes plugin to return `RATE_LIMIT_EXCEEDED` error, not throw.

### Estimated complexity: M

---

## T-017: Implement ElasticSearch Sync Worker

**Design-l2 reference:** Section 1.6 (ES Sync Worker), Section 4.3 (`es-sync-queue` payload), Section 3 (ES index mapping), Section 10.5 (ES Sync env vars)

### Description

Implement the `es-sync-worker` service that consumes `es-sync-queue` BullMQ jobs, fetches the full `JobDocument` from MongoDB, and indexes or updates the document in ElasticSearch via the `jobs_write` alias. Uses bulk indexing where multiple jobs are queued simultaneously. Handles ES unavailable with retry backoff. Updates `es_schema_versions` if mapping conflict is detected.

### Acceptance criteria

- A `EsSyncQueueJob` is processed within 60 seconds of MongoDB write (NFR-001): the ES document for the job ID is fetchable via `GET /jobs/_doc/{id}` after processing.
- If ES is unavailable, the BullMQ job is retried with exponential backoff (5 attempts, starting 5s); after all retries fail, the job goes to the `failed` state (not lost).
- `flushBatch()` uses the ES bulk API (`/_bulk`) and handles partial failures: documents that failed are individually retried; the batch job succeeds if all documents are eventually indexed.
- A `MAPPING_CONFLICT` error (field type mismatch) emits a CloudWatch metric `ESMappingConflict` and marks the BullMQ job as failed (requires manual migration to fix).
- Writes go to the `jobs_write` alias, not to a versioned index name directly.
- `EsSyncQueueJob.changedFields` is a hint only; the worker always fetches the full `JobDocument` from MongoDB before indexing (ensures consistency with source of truth).
- If `mongoJobId` does not exist in MongoDB (deleted before sync), the ES document is deleted if it exists, and the job is completed (not failed).

### Implementation notes

- File: `services/es-sync-worker/src/worker.ts`.
- ES document shape: map `JobDocument` fields to the ES mapping from design-l2.md Section 3.2. Key mappings: `_mongo_id = job._id.toString()`, `descriptionText = job.descriptionText`, `sources` as nested objects.
- Bulk API: accumulate jobs in a buffer; flush when buffer reaches `ES_SYNC_BATCH_SIZE` (default 50) or `ES_SYNC_BATCH_FLUSH_INTERVAL_MS` (default 1000ms).
- Detect `MAPPING_CONFLICT`: check the ES bulk response for `"type": "mapper_parsing_exception"` or `"type": "strict_dynamic_mapping_exception"`.
- CloudWatch metric: emit via `@aws-sdk/client-cloudwatch` `PutMetricData` for `ESMappingConflict`.

### Test requirements

- Integration test (OpenSearch): ingest a `JobDocument` into MongoDB, enqueue an `es-sync-queue` job, process it, and confirm the document is retrievable from ES via the `jobs` alias.
- Unit test: `mapJobDocumentToEsDocument` maps all `JobDocument` fields to the correct ES field names and types.
- Unit test: ES unavailable (mock client throws connection error) — BullMQ job is retried (exception propagates to BullMQ retry mechanism).
- Unit test: `mongoJobId` not found in MongoDB — worker fetches from MongoDB, gets null, deletes from ES if present, completes the job.
- Integration test: bulk flush of 3 jobs produces a single `/_bulk` request containing all 3 index operations.

### Estimated complexity: M

---

## T-018: Implement Vector Embedding Worker

**Design-l2 reference:** Section 1.7 (Vector Embedding Worker), Section 4.6 (`vector-queue` payload), Section 8 (Vector Search Integration), Section 10.7 (Vector Worker env vars)

### Description

Implement the `vector-worker` service that consumes `vector-queue` BullMQ jobs with a 5-minute debounce (dedup by `mongoJobId`), fetches the `JobDocument` from MongoDB, computes the embedding via the `EmbeddingModel` interface, and upserts into the configured `VectorDbAdapter`. Implement the `VectorDbAdapter` interface with a Weaviate adapter and a mock adapter (for testing). The mock adapter enables offline testing without OpenAI API calls.

### Acceptance criteria

- A new job in `vector-queue` triggers embedding computation using the configured `EMBEDDING_MODEL` (default `"text-embedding-3-small"`).
- The text prepared for embedding: `"${title} ${agency} ${classification} ${location} ${descriptionText}"` truncated to `EMBEDDING_MAX_CHARS` (8000) characters.
- After successful embedding, `jobs.embeddingStatus` is updated to `"computed"` and `jobs.embeddingComputedAt` is set.
- If the OpenAI API times out (mock: exceed `EMBEDDING_REQUEST_TIMEOUT_MS`), `jobs.embeddingStatus` is set to `"failed"` and the BullMQ job is retried (up to 3 times with 60s backoff).
- `VECTOR_DB_PROVIDER=mock` uses the `LocalEmbeddingModel` (returning a zero-vector of the correct dimensions) and `MockVectorDbAdapter` (in-memory map) — no external network calls.
- `VECTOR_DB_PROVIDER=weaviate` uses the Weaviate client pointing to `WEAVIATE_URL`.
- If the vector DB is unavailable, the error is logged and the job is retried; after exhausting retries, `embeddingStatus: "failed"` is set and the BullMQ job fails.
- The debounce behaviour: if two `vector-queue` jobs with the same `mongoJobId` arrive within 5 minutes, only one embedding is computed (BullMQ dedup key `"vector:${mongoJobId}"`).

### Implementation notes

- File: `services/vector-worker/src/worker.ts`, `services/vector-worker/src/adapters/weaviate.adapter.ts`, `services/vector-worker/src/adapters/mock.adapter.ts`.
- OpenAI embedding: use `openai` npm package 4.x. Model: `config.EMBEDDING_MODEL`. API key from Secrets Manager.
- Weaviate client: use `weaviate-ts-client`. Class name: `GovJob`. Vector dimensions from model config.
- `VectorDbAdapter` upsert: `weaviate.data.creator().withClassName('GovJob').withId(jobId).withVector(embedding).withProperties(metadata).do()`.
- After embedding, update MongoDB: `Job.findByIdAndUpdate(jobId, { $set: { embeddingStatus: 'computed', embeddingComputedAt: new Date() } })`.
- On `EMBEDDING_TIMEOUT` error, update MongoDB: `{ embeddingStatus: 'failed' }` but still retry the BullMQ job (the status is overwritten on next successful attempt).
- Debounce via BullMQ `jobId` dedup: `{ jobId: "vector:${mongoJobId}" }` in job options — BullMQ rejects the new enqueue if the same ID is already in `waiting` or `delayed` state.

### Test requirements

- Unit test with mock embedding model: `processJob` with a valid `VectorQueueJob` calls `embed()` with the correct text and calls `vectorDb.upsert()` with the result.
- Unit test: text truncation — a `descriptionText` of 10,000 chars is truncated to 8,000 before being passed to `embed()`.
- Unit test: `OpenAI API` timeout (mock throws after `EMBEDDING_REQUEST_TIMEOUT_MS`) causes `embeddingStatus: "failed"` to be set and the BullMQ error to propagate.
- Integration test with `VECTOR_DB_PROVIDER=mock`: end-to-end process a job, confirm `embeddingStatus: "computed"` in MongoDB and vector stored in mock adapter.
- Unit test: `VectorQueueJob` with a `mongoJobId` not found in MongoDB — logs `JOB_NOT_FOUND` and completes the BullMQ job (no retry).

### Estimated complexity: M

---

## T-019: Implement expiry tracking scheduler and re-scan logic

**Design-l2 reference:** Section 1.1 (ExpiryRescanJob), Section 6.4 (Expiry Reminder Polling Cadence resolves A2), Section 10.3 (`EXPIRY_PRESCAN_HOURS`, `EXPIRY_POSTSCAN_HOURS`, `EXPIRY_RESCAN_INTERVAL_HOURS`)

### Description

Extend the Scraper Scheduler (T-014) with expiry re-scan logic. On each scheduling cycle, query the `jobs` collection for records with `expiryDate` within the pre-expiry window (72h) or post-expiry window (48h) and enqueue `ScrapeQueueJob` entries with `runType: "expiry_rescan"`. The re-scan cadence is every 12 hours (`EXPIRY_RESCAN_INTERVAL_HOURS`). After the 48-hour post-expiry window closes without the job reappearing, mark the job as `status: "expired"`.

### Acceptance criteria

- A job with `expiryDate = now + 50h` (within the 72h pre-expiry window) is enqueued with `runType: "expiry_rescan"` on the next scheduler cycle.
- A job with `expiryDate = now - 30h` (within the 48h post-expiry window) is also enqueued for re-scan.
- A job with `expiryDate = now - 60h` (outside the 48h post-expiry window, no extension found) is updated to `status: "expired"` by the expiry logic.
- Re-scan jobs use the bucket-aligned `jobId` format: `"scrape:${sourceId}:expiry-rescan:${bucketedScheduledFor}"` to prevent duplicate enqueues.
- The query for expiry-due jobs uses the compound index `{ status: 1, expiryDate: 1, lastSeenAt: 1 }` (confirmed by query explain plan in test).
- A re-scan that discovers the job still active (plugin returns the job) causes the `ingest service` to update `lastSeenAt` and `expiryDate` if the closing date was extended.
- A re-scan that finds the job absent (plugin returns empty list for that listing) increments an absence counter; after 2 consecutive absent re-scans post-expiry, the job is marked `status: "expired"`.
- `SchedulerResult` includes `expiryRescanJobsEnqueued` count.

### Implementation notes

- Extend `services/scheduler/src/scheduler.service.ts` with a `runExpiryCycle()` method.
- Query: `Job.find({ status: 'active', expiryDate: { $gte: now - EXPIRY_POSTSCAN_HOURS_MS, $lte: now + EXPIRY_PRESCAN_HOURS_MS } })`.
- For each expiry-due job, find the first source in `job.sources` array (primary source); enqueue a `ScrapeQueueJob` with `runType: "expiry_rescan"` and `expiryRescanJobId: job._id.toString()`.
- The `expiryRescanJobId` in the job payload is used by the Ingest Service to detect when a re-scan finds no matching listing and to mark the job as expired.
- Expiry marking: query `Job.updateMany({ status: 'active', expiryDate: { $lt: now - EXPIRY_POSTSCAN_HOURS_MS }, lastSeenAt: { $lt: now - EXPIRY_POSTSCAN_HOURS_MS } }, { $set: { status: 'expired' } })`.

### Test requirements

- Unit test: `runExpiryCycle()` with a mock MongoDB containing 3 jobs (1 in pre-expiry window, 1 in post-expiry window, 1 outside both windows) enqueues 2 scrape jobs.
- Unit test: job outside the post-expiry window with old `lastSeenAt` is marked `status: "expired"`.
- Unit test: re-scan job ID is correctly bucket-aligned.
- Integration test: scheduler cycle with expiry tracking, end-to-end, confirms the correct jobs are enqueued and the expired job is updated.
- Integration test: query explain plan for expiry query uses the `{ status, expiryDate, lastSeenAt }` index (assert `winningPlan.inputStage.indexName`).

### Estimated complexity: M
