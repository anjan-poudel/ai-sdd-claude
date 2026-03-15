# TG-01: Infrastructure and Project Setup

> **Jira Epic:** Infrastructure and Project Setup

## Description

Establishes the TypeScript monorepo, all shared configuration, MongoDB schemas with indexes, ElasticSearch index mappings, BullMQ queue definitions, environment variable validation, structured logging, and AWS Secrets Manager integration. These tasks are the foundation every other task group depends on. No domain logic is implemented here — only the structural layer that all services build on.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| T-001 | Initialise monorepo structure and TypeScript configuration | S | — | LOW |
| T-002 | Implement all 12 MongoDB Mongoose schemas and indexes | L | T-001 | MEDIUM |
| T-003 | Create ElasticSearch index mapping with alias and migration script | M | T-001 | MEDIUM |
| T-004 | Initialise BullMQ queues with all 6 queue definitions | M | T-001 | LOW |
| T-005 | Implement environment variable validation with Zod at startup | S | T-001 | MEDIUM |
| T-006 | Implement structured JSON logger with trace_id propagation | S | T-001 | LOW |
| T-007 | Implement AWS Secrets Manager integration and CI security scanning | M | T-005, T-006 | HIGH |

---

## T-001: Initialise monorepo structure and TypeScript configuration

**Design-l2 reference:** Section 10 (Configuration and Environment Variables), Section 10.8 (Startup Validation)

### Description

Create the Bun-based TypeScript monorepo with all seven service packages. The monorepo uses Bun workspaces. TypeScript strict mode is enforced across all packages. Docker Compose is provided for local development (MongoDB, Redis, ElasticSearch). Each ECS service has its own `package.json` and entrypoint but shares a `packages/shared` library for common types.

### Directory layout to create

```
govtjobs-portal/
  package.json                  # workspace root (Bun workspaces)
  tsconfig.base.json            # strict: true, target: ES2022, module: Node16
  docker-compose.yml            # MongoDB 7, Redis 7 (AOF), OpenSearch 2.x
  packages/
    shared/                     # shared types, utils, logger stub
      package.json
      src/
        types/                  # all TypeScript interfaces from design-l2
        errors/                 # typed error discriminated unions
  services/
    api/                        # Web API (Express)
    scheduler/                  # Scraper Scheduler
    scraper-worker/             # Scraper Worker
    es-sync-worker/             # ElasticSearch Sync Worker
    vector-worker/              # Vector Embedding Worker
    notification-worker/        # Notification Worker
    account-worker/             # Account Deletion Worker
  scripts/
    es-migrate.ts               # ES migration script (stub for T-003)
```

### Acceptance criteria

- Running `bun install` at repo root installs all workspace dependencies without errors.
- `bun run typecheck` (running `tsc --noEmit` for all packages) passes with zero errors.
- `docker-compose up` starts MongoDB 7 (replica set with 3 nodes), Redis 7 with AOF enabled, and OpenSearch 2.x; all health checks pass within 60 seconds.
- `packages/shared/src/types/index.ts` exports all TypeScript interfaces defined in design-l2.md sections 1, 2, 3, 4, 5, 6, 7, 8, and 9 (including `JobDocument`, `SourceDocument`, `UserDocument`, all error union types).
- Each service package has a valid `package.json` with a `start` script pointing to its entrypoint.
- `tsconfig.base.json` has `"strict": true`, `"noUncheckedIndexedAccess": true`, and `"exactOptionalPropertyTypes": true`.

### Implementation notes

- Bun workspaces configuration in root `package.json`: `"workspaces": ["packages/*", "services/*"]`.
- Redis `docker-compose` entry must include `command: redis-server --appendonly yes` to enable AOF as required by NFR-003.
- MongoDB must start as a 3-node replica set for transaction support (required by Ingest Service in T-013).
- Use `mongo-setup` init container to run `rs.initiate()` script before application containers start.
- OpenSearch image: `opensearchproject/opensearch:2.11.0` (latest stable at time of writing).
- `packages/shared` must export discriminated union error types verbatim from design-l2.md sections 1.1 through 1.8.
- Do NOT implement logic in this task — only interfaces, types, and project structure.

### Test requirements

- Unit test: import all exported types from `packages/shared` and verify TypeScript compilation.
- Integration test: `docker-compose up` health check script verifies MongoDB replica set `rs.status()` shows 3 members, Redis `CONFIG GET appendonly` returns `yes`, OpenSearch `/_cluster/health` returns `status: green` or `yellow`.

### Estimated complexity: S

---

## T-002: Implement all 12 MongoDB Mongoose schemas and indexes

**Design-l2 reference:** Section 2 (Data Models — MongoDB Schemas), all subsections 2.1 through 2.12

### Description

Implement all 12 Mongoose schema definitions with full field validation, all indexes (including compound, sparse, unique, TTL, and text indexes), and `updated_at` pre-save hook. Place all schemas in `packages/shared/src/models/`. Each schema file exports a Mongoose `Model<TDocument>` typed with the corresponding TypeScript interface from T-001.

### Schemas to implement (one file each)

| File | Collection | Key constraints |
|------|------------|----------------|
| `job.model.ts` | `jobs` | unique `deduplicationKey`, text index `{title:10, agency:5, descriptionText:1}`, compound `{status,expiryDate,lastSeenAt}`, TTL none |
| `source.model.ts` | `sources` | unique `name`, compound `{enabled,nextRunAt}` |
| `user.model.ts` | `users` | unique `email`, unique sparse `{oauthIdentities.provider, oauthIdentities.providerId}`, sparse `emailVerificationToken` |
| `refresh-token.model.ts` | `refresh_tokens` | unique `tokenHash`, TTL on `expiresAt` with `expireAfterSeconds:0` |
| `saved-job.model.ts` | `saved_jobs` | unique `{userId, jobId}`, `{userId, savedAt:-1}` |
| `saved-search.model.ts` | `saved_searches` | `{userId, created_at:-1}` |
| `alert.model.ts` | `alerts` | `{userId, status}`, `{status}`, compound `{status, governmentLevel, state}` |
| `notification.model.ts` | `notifications` | unique `deduplicationKey`, TTL on `created_at` with `expireAfterSeconds:7776000` (90 days) |
| `content.model.ts` | `content` | unique `slug`, `{associatedAgencies, status}`, text index |
| `agency-review.model.ts` | `agency_reviews` | `{agencyName, status}`, `{status, created_at:-1}` |
| `es-schema-version.model.ts` | `es_schema_versions` | unique `{version:-1}` |
| `scraper-run.model.ts` | `scraper_runs` | `{sourceId, startedAt:-1}`, TTL on `startedAt` with `expireAfterSeconds:7776000` |

### Acceptance criteria

- All 12 Mongoose models can be imported and connected to a running MongoDB instance without errors.
- The `updated_at` field is automatically set on every document save via a pre-save hook applied to all models that include `updated_at`.
- Validation rules from design-l2.md section 2 are enforced: `UserDocument.email` maxLength 254; `JobDocument.status` is restricted to the enum; `AgencyReviewDocument.rating` min 1 max 5; `ContentDocument.slug` is unique.
- All TTL indexes are confirmed present by querying `db.collection.getIndexes()` in a test.
- TypeScript strict mode: all model files compile without errors; no `any` casts.
- `deduplicationKey` on `jobs` is unique and the index is confirmed by the test suite.

### Implementation notes

- Use `mongoose` 8.x. Import `Schema`, `model`, `Types` from mongoose.
- The `updated_at` pre-save hook pattern: `schema.pre('save', function(next) { this.updated_at = new Date(); next(); })`.
- `refresh_tokens.expiresAt` TTL: `{ expiresAt: { type: Date, index: { expireAfterSeconds: 0 } } }`.
- `users.fcmTokens` is a sub-array capped implicitly by application logic (not Mongoose `capped`); enforce `MAX_FCM_TOKENS_PER_USER = 10` at the service layer, not schema layer.
- `SearchCriteria` is a reusable sub-document schema shared by `saved_searches.criteria` and `alerts.criteria`.
- `jobs.descriptionText` stores the plain-text stripped version of `description`; the stripping is done at ingest time (T-013), not in the schema.
- The text index on `jobs` uses weights: `{ title: 10, agency: 5, descriptionText: 1 }` via `schema.index({ title: "text", agency: "text", descriptionText: "text" }, { weights: { title: 10, agency: 5, descriptionText: 1 } })`.
- All `ObjectId` reference fields use `type: Schema.Types.ObjectId` with appropriate `ref` strings.

### Test requirements

- Unit tests for each model: create a valid document and assert it saves; create a document that violates each validation rule and assert the expected `ValidationError`.
- Integration test: connect to in-memory MongoDB (use `mongodb-memory-server`), create all 12 indexes, and assert `getIndexes()` matches the expected index definitions from design-l2.md.
- Test: saving a document without `updated_at` auto-populates the field; updating an existing document changes `updated_at`.
- Test: `refresh_tokens` TTL index has `expireAfterSeconds: 0` confirmed.

### Estimated complexity: L

---

## T-003: Create ElasticSearch index mapping with alias and migration script

**Design-l2 reference:** Section 3 (ElasticSearch Index Mapping), subsections 3.1 through 3.4

### Description

Create the `jobs_v1` index with the full field mapping and custom analyzer definitions from design-l2.md Section 3. Set up the `jobs` read alias and `jobs_write` write alias pointing to `jobs_v1`. Implement the migration script `scripts/es-migrate.ts` that supports creating a new versioned index and atomically swapping the alias. Track schema versions in the `es_schema_versions` MongoDB collection (from T-002).

### Acceptance criteria

- Running `bun run scripts/es-migrate.ts --version 1` creates `jobs_v1` index with the exact mapping from design-l2.md Section 3.2 and settings from Section 3.1 (3 shards, 1 replica, custom analyzers: `australian_english`, `classification_keyword`, `agency_autocomplete`, `agency_search`).
- The `jobs` alias and `jobs_write` alias both resolve to `jobs_v1` after initial setup.
- A document indexed via `jobs_write` alias is retrievable via the `jobs` alias.
- The `es_schema_versions` MongoDB collection contains a record with `version: 1`, `indexName: "jobs_v1"`, `status: "active"` after setup.
- Running the migration script for version 2 (given a modified mapping) creates `jobs_v2`, reindexes, and atomically swaps the `jobs` alias from `jobs_v1` to `jobs_v2` without read downtime.
- `scripts/es-migrate.ts` accepts `--dry-run` flag that logs what would be done without modifying ES.

### Implementation notes

- Use the `@opensearch-project/opensearch` client (AWS OpenSearch is API-compatible with OpenSearch 2.x).
- Index creation request body: copy verbatim from design-l2.md Sections 3.1 and 3.2.
- Alias swap uses the ES `/_aliases` endpoint with a single atomic request body containing both `remove` (old index) and `add` (new index) actions.
- `mappingHash`: compute `sha256(JSON.stringify(mapping))` and store in `es_schema_versions`.
- `dynamic: "strict"` in the mapping prevents undeclared fields from being indexed silently.
- The `title.suggest` field uses `"type": "completion"` for autocomplete (not needed by keyword search but useful for future feature).
- Reindex API: `POST /_reindex` with `source.index: "jobs_v1"` and `dest.index: "jobs_v2"`.
- The migration script must use `ES_MIGRATION_TIMEOUT_MS` (default: 3600000) as the request timeout for the reindex call.

### Test requirements

- Integration test against a running OpenSearch instance (Docker): assert that after `es-migrate.ts --version 1`, the `jobs` alias exists and a sample document matching `JobDocument` shape can be indexed and retrieved.
- Test: index a document with an undeclared field and confirm ES returns a `strict_dynamic_mapping_exception` (proving `dynamic: "strict"` is active).
- Test: run `es-migrate.ts --version 1` twice and confirm it is idempotent (no error on second run if index already exists).
- Test: `--dry-run` flag logs expected actions but makes no changes (verify by checking index does not exist after dry run).

### Estimated complexity: M

---

## T-004: Initialise BullMQ queues with all 6 queue definitions

**Design-l2 reference:** Section 4 (BullMQ Queue Design), subsections 4.1 through 4.7

### Description

Implement the `packages/shared/src/queues/` module that exports typed BullMQ `Queue` and `Worker` factory functions for all six queues. Each queue has its job payload type, retry options, and dead-letter TTL from design-l2.md Section 4.1. The module must export helper functions to enqueue each job type with the correct deduplication `jobId` key format.

### Queues to implement

| Queue | Consumer | Concurrency | Retry | Dedup key pattern |
|-------|----------|-------------|-------|-------------------|
| `scrape-queue` | `scraper-worker` | `SCRAPE_QUEUE_CONCURRENCY` (5) | 3×, exp backoff 30s | `scrape:${sourceId}:${bucketedScheduledFor}` |
| `es-sync-queue` | `es-sync-worker` | `ES_SYNC_CONCURRENCY` (10) | 5×, exp backoff 5s | `es-sync:${mongoJobId}` |
| `notification-queue` | `notification-worker` | `NOTIFICATION_CONCURRENCY` (20) | 3×, exp backoff 10s | `notify:${alertId}:${mongoJobId}` |
| `expiry-reminder-queue` | `notification-worker` | shares `NOTIFICATION_CONCURRENCY` | 3×, exp backoff 10s | `expiry-reminder:${savedJobId}:${reminderWindowKey}` |
| `vector-queue` | `vector-worker` | `VECTOR_CONCURRENCY` (3) | 3×, exp backoff 60s | `vector:${mongoJobId}` |
| `deletion-queue` | `account-worker` | 2 | 5×, exp backoff 60s | `deletion:${userId}` |

### Acceptance criteria

- All 6 `Queue` instances can be created without error against a running Redis instance.
- The `enqueueScrapejob(payload: ScrapeQueueJob)` helper computes the bucket-aligned `jobId` as `"scrape:${sourceId}:${Math.floor(scheduledFor.getTime() / 900000) * 900000}"` (15-minute bucket).
- Adding the same job ID twice to any queue results in only one job present (BullMQ dedup behaviour confirmed by test).
- Each queue's BullMQ options match the retry policy from Section 4.1: attempts, backoff type `exponential`, correct delay values.
- `removeOnComplete: { count: 1000 }` and `removeOnFail: false` are set on `scrape-queue` jobs.
- The DLQ inspector function `inspectDeadLetterJobs(queueName: string)` can query the `failed` state of any queue and return structured results.

### Implementation notes

- Use `bullmq` 5.x. All queues share `REDIS_URL` connection.
- Export a `createQueue<T>(name: string, opts: QueueOptions): Queue<T>` factory.
- Export strongly-typed job payload interfaces re-exported from `packages/shared/src/types/index.ts`.
- The `reminderWindowKey` helper: `format(truncate(expiryDate, '6h'), 'yyyy-MM-dd-HH')` where HH is floored to nearest multiple of 6.
- `scrapeJobOptions` constant from design-l2.md Section 4.2 must be exported from this module so the scheduler (T-014) can import it.
- Do NOT start any workers in this task — only define queue instances and job option constants.

### Test requirements

- Unit test: `enqueueScrapejob` with a timestamp at 14:22 produces a `jobId` ending in `:${timestamp_of_14:15}`.
- Integration test against Redis: enqueue the same job ID twice, confirm `queue.getJobCounts()` shows `waiting: 1` not `waiting: 2`.
- Unit test: `computeReminderWindowKey` for a date at 2024-05-15T19:30:00Z returns `"2024-05-15-18"`.
- Unit test: all 6 job payload types are correctly typed (TypeScript compilation test with strict null checks).

### Estimated complexity: M

---

## T-005: Implement environment variable validation with Zod at startup

**Design-l2 reference:** Section 10 (Configuration and Environment Variables), subsections 10.1 through 10.8

### Description

Implement the `packages/shared/src/config/` module that validates all environment variables for each service using Zod schemas. Each service has its own config schema (composed of the shared base + service-specific variables). On startup, if any required variable is absent or has the wrong type, the process logs all errors and exits with code 1.

### Acceptance criteria

- `parseConfig('api')` validates all variables from design-l2.md Sections 10.1 and 10.2; returns a strongly-typed config object on success.
- `parseConfig('scheduler')` validates Sections 10.1 and 10.3.
- `parseConfig('scraper-worker')` validates Sections 10.1 and 10.4.
- `parseConfig('es-sync-worker')` validates Sections 10.1 and 10.5.
- `parseConfig('notification-worker')` validates Sections 10.1 and 10.6.
- `parseConfig('vector-worker')` validates Sections 10.1 and 10.7.
- When `MONGODB_URI` is absent, the process startup test confirms exit code 1 and a log message listing the missing variable name.
- All variables listed as `[SECRET]` in design-l2.md have a corresponding note in the Zod schema that they must be loaded from Secrets Manager in production (enforced by a linting comment, not by the schema itself).
- `NODE_ENV` enum validation: only `"development"`, `"staging"`, `"production"` are accepted.

### Implementation notes

- One Zod schema per service: `apiConfigSchema`, `schedulerConfigSchema`, etc.
- Shared base schema covers Section 10.1 variables; compose via `z.object({}).merge(baseSchema)`.
- On validation failure: use Zod `safeParse`, collect all `ZodError.errors`, log them as a structured JSON array, then `process.exit(1)`.
- Default values in Zod: `z.number().default(300)` for `SOURCE_POLL_INTERVAL_SECONDS`.
- Secrets (e.g. `MONGODB_URI`): marked required with no default; `z.string().min(1)`.
- The module must export a `getConfig()` singleton that caches the parsed config (only validates once per process startup).
- For tests: provide a `setTestConfig(partial)` helper that allows overriding specific variables in tests without real env pollution.

### Test requirements

- Unit test: passing all required variables returns the correctly typed config object with defaults applied.
- Unit test: omitting `MONGODB_URI` causes `parseConfig` to collect a Zod error for that field.
- Unit test: passing `NODE_ENV=invalid` causes a Zod enum error.
- Unit test: `LOG_LEVEL` defaults to `"info"` when not set.
- Integration test: start a subprocess with missing required env vars and confirm exit code 1 and structured error log.

### Estimated complexity: S

---

## T-006: Implement structured JSON logger with trace_id propagation

**Design-l2 reference:** Section 10.1 (`LOG_LEVEL`), L1 Observability section, NFR-006

### Description

Implement the `packages/shared/src/logger/` module providing a structured JSON logger used by all services. Every log entry emits `{ timestamp, service, level, trace_id, message, ...fields }`. No PII fields (`email`, `password`, JWT token values) may appear in any log entry. The `trace_id` is propagated via Node.js `AsyncLocalStorage` so it flows automatically across async call chains without explicit passing.

### Log entry shape

```typescript
interface LogEntry {
  timestamp: string;    // ISO 8601 with milliseconds
  service: string;      // SERVICE_NAME env var
  level: "debug" | "info" | "warn" | "error";
  trace_id: string;     // UUID; propagated via AsyncLocalStorage
  message: string;
  [key: string]: unknown;  // additional structured fields; PII fields are scrubbed
}
```

### Acceptance criteria

- `logger.info("message", { jobId: "abc" })` writes a single-line JSON object to stdout with all required fields.
- If `trace_id` is not set in the current async context, the log entry emits `trace_id: "unset"` rather than omitting the field.
- Setting `LOG_LEVEL=warn` suppresses `info` and `debug` messages; `warn` and `error` still appear.
- If a log call includes a field named `email`, `password`, `token`, `authorization`, or `refreshToken`, that field is replaced with `"[REDACTED]"` in the output.
- `withTraceId(traceId: string, fn: () => Promise<T>): Promise<T>` runs `fn` inside an `AsyncLocalStorage` scope so all log calls within `fn` (and its async descendants) automatically include the provided `trace_id`.
- The logger does NOT write stack traces in production (`NODE_ENV=production`): only `error.message` and `error.code` are included.

### Implementation notes

- Use `pino` 8.x for performance. Configure with `level: config.LOG_LEVEL` and `formatters.level` to output lowercase level strings.
- PII scrubbing: implement via a `redact` pino option using the paths: `["email", "password", "token", "authorization", "refreshToken", "*.email", "*.password"]`.
- `AsyncLocalStorage` from Node.js `async_hooks` built-in.
- `withTraceId` pattern:
  ```typescript
  const traceStorage = new AsyncLocalStorage<string>();
  export function withTraceId<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return traceStorage.run(id, fn);
  }
  export function getTraceId(): string {
    return traceStorage.getStore() ?? "unset";
  }
  ```
- The Express middleware (T-020) will call `withTraceId(req.headers['x-trace-id'] ?? uuidv4(), next)`.

### Test requirements

- Unit test: logger emits valid JSON parseable by `JSON.parse` on each call.
- Unit test: `LOG_LEVEL=warn` suppresses info-level output.
- Unit test: `{ email: "user@example.com" }` is emitted as `{ email: "[REDACTED]" }`.
- Unit test: `withTraceId("abc-123", async () => { logger.info("test"); })` produces a log entry with `trace_id: "abc-123"`.
- Unit test: nested async calls within `withTraceId` scope all carry the same `trace_id`.
- Unit test: `NODE_ENV=production` omits stack trace from error log entries.

### Estimated complexity: S

---

## T-007: Implement AWS Secrets Manager integration and CI security scanning

**Design-l2 reference:** Section 10 (`[SECRET]` variables), NFR-004 (secrets never in env files or logs)

### Description

Implement the `packages/shared/src/secrets/` module that loads all `[SECRET]` variables from AWS Secrets Manager at startup. In development (`NODE_ENV=development`), the module falls back to environment variables directly. In production, it fetches secrets from Secrets Manager and injects them into the config before Zod validation (T-005) runs. Also configure the CI pipeline to run `npm audit --audit-level=high` (or equivalent Bun security scan) and fail the build on high-severity CVEs.

### Secrets to load from Secrets Manager

| Secret name (AWS) | Env variable mapped to |
|---|---|
| `gobjobs/mongodb-uri` | `MONGODB_URI` |
| `gobjobs/redis-url` | `REDIS_URL` |
| `gobjobs/jwt-private-key` | `JWT_PRIVATE_KEY` |
| `gobjobs/jwt-public-key` | `JWT_PUBLIC_KEY` |
| `gobjobs/google-oauth` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| `gobjobs/linkedin-oauth` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| `gobjobs/elasticsearch-creds` | `ELASTICSEARCH_USERNAME`, `ELASTICSEARCH_PASSWORD` |
| `gobjobs/openai-api-key` | `OPENAI_API_KEY` |
| `gobjobs/fcm-credentials` | `FCM_PROJECT_ID`, `FCM_PRIVATE_KEY`, `FCM_CLIENT_EMAIL` |
| `gobjobs/weaviate-api-key` | `WEAVIATE_API_KEY` |

### Acceptance criteria

- `loadSecrets(serviceName)` fetches the appropriate secrets from AWS Secrets Manager and returns a `Record<string, string>` that is merged into the environment before Zod config validation.
- In `NODE_ENV=development`, `loadSecrets` is a no-op and returns an empty object (allowing local dev via `.env` file).
- If a Secrets Manager call fails with a non-404 error, the startup logs the error and exits with code 1.
- No secret value appears in any log entry (verified by test that calls `loadSecrets` with a mock that returns a test secret value and asserts the value is not in the log output).
- The CI pipeline file (`.github/workflows/ci.yml`) includes a step `bun run security-scan` that executes `bun audit` and fails on high-severity issues.
- A `scripts/generate-jwt-keypair.ts` script generates a fresh 2048-bit RSA key pair and outputs the PEM strings for manual upload to Secrets Manager.

### Implementation notes

- Use `@aws-sdk/client-secrets-manager` for Secrets Manager SDK calls.
- Secrets that are JSON strings (e.g. `gobjobs/google-oauth` contains `{ clientId, clientSecret }`) are parsed with `JSON.parse` and the fields are mapped to individual env variable names.
- The module must cache fetched secrets for the process lifetime (do not re-fetch on every config access).
- `loadSecrets` is called once at startup, before `parseConfig`, inside each service's `main.ts`.
- For the CI step: use `bun audit` (Bun's built-in security audit) or `npm audit --audit-level=high` on the `package-lock.json` equivalent. Exit code 1 on high severity.
- The `generate-jwt-keypair.ts` script uses Node.js `crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })` and outputs both keys in PEM format to stdout.

### Test requirements

- Unit test (mocked Secrets Manager): `loadSecrets` returns correctly merged env vars from mock secret responses.
- Unit test: when Secrets Manager throws an access-denied error, the function re-throws with a log message containing no secret values.
- Unit test: `NODE_ENV=development` causes `loadSecrets` to return empty object without making any AWS SDK call.
- Security test: assert that after `loadSecrets`, no secret value appears in `logger.info` output when the logger processes the returned config (PII redaction from T-006 must catch it).
- Integration test (CI gate): add a known vulnerable `lodash@4.17.4` as a dev dependency, run `bun audit`, confirm exit code 1.

### Estimated complexity: M
