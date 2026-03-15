# Review Report — GovJobs Portal L2 Component Design (Re-review)

## Summary

The revised L2 Component Design document for GovJobs Portal addresses all five items raised in the first review: the `fcmTokens` blocker is fully resolved with a typed `FcmToken` interface, a sparse index, and complete Notification Worker dispatch logic; the four advisories (email verification hashing, `RobotsChecker` return type, `deletion-queue` consumer placement, and the `alerts` compound index) are each explicitly and correctly resolved. All previously passing criteria continue to pass, and the document now meets every standard defined in the constitution.

## Decision

**Decision:** GO

---

## Evidence Checklist

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| B1 | `fcmTokens: FcmToken[]` present in `UserDocument` with correct fields and sparse index | PASS | Section 2.3 defines `FcmToken` interface with `token`, `deviceId`, `registeredAt`, `lastUsedAt`. `UserDocument` has `fcmTokens: FcmToken[]` capped at `MAX_FCM_TOKENS_PER_USER = 10`. Sparse index `{ "fcmTokens.token": 1 }` is present. Section 1.8 documents the Notification Worker reading `users.fcmTokens`, fanning out per device, updating `lastUsedAt` on success, removing invalid tokens via `$pull`, and pruning stale tokens (>90 days). |
| A1 | Email verification token hashing uses SHA-256 (not bcrypt) | PASS | Section 2.3 `UserDocument.emailVerificationToken` field comment: "SHA-256 hex hash of the token; cleared on verify". Section 7.1 registration flow step 5: "Hash verify token (SHA-256 for storage)". Auth flow prose confirms: "Token hash: SHA-256 hex hash stored in `users.emailVerificationToken`". |
| A2 | `RobotsChecker.isAllowed()` return type is `Promise<{ allowed: boolean } \| ScraperWorkerError>` | PASS | Section 5.1 interface definition exactly matches the required signature. The inline comment further confirms: "Returns `{ allowed: boolean }` if the check succeeds, or ScraperWorkerError if the robots.txt fetch itself fails." |
| A3 | `deletion-queue` consumer is `account-worker` (not `api` service) | PASS | Section 4.1 Queue Inventory table row for `deletion-queue` names `account-worker (dedicated ECS service — see note)`. The explanatory note explicitly states it must run as a dedicated service to avoid holding open HTTP connections and to allow independent scaling and restart policies. |
| A4 | `alerts` collection has compound index `{ status: 1, governmentLevel: 1, state: 1 }` | PASS | Section 2.7 `alerts` index block includes `{ status: 1, governmentLevel: 1, state: 1 }` with comment "alert matching pre-filter (used when ALERT_MATCH_USE_INDEXED_QUERY=true)". Section 6.2 and the `ALERT_MATCH_INDEX_THRESHOLD` env var (Section 10.2) document the activation logic for this index. |
| 6 | All interface methods have explicit error return types (no `any` or `unknown`) | PASS | Every component uses typed discriminated unions: `SchedulerError`, `ScraperWorkerError`, `IngestErrorCode`, `ApiError`, `AuthError`, `EsSyncError`, `VectorWorkerError`, `NotificationWorkerError`. No method returns `any` or `unknown` for error fields. |
| 7 | Every async or external call has a documented failure mode and recovery path | PASS | All external calls document error codes and recovery: MongoDB writes → `STORAGE_ERROR` + retry/DLQ; ES → `ES_UNAVAILABLE` + retry/DLQ; SES → `SES_SEND_FAILED` + 3 retries; FCM → `FCM_SEND_FAILED` + `FCM_TOKEN_INVALID` → `$pull`; Playwright → `PLAYWRIGHT_CRASH` → ECS task restart; Vector DB → `VECTOR_DB_UNAVAILABLE` + fallback to keyword search (NFR-003); Redis → `LOCK_ACQUIRE_FAILED` → skip cycle. |
| 8 | Timeouts and retry limits are configurable parameters, not hardcoded constants | PASS | Every timeout is a named env var: `SCHEDULER_LOCK_TTL_MS`, `SCHEDULER_CYCLE_TIMEOUT_MS`, `SCRAPER_FETCH_TIMEOUT_MS`, `ROBOTS_FETCH_TIMEOUT_MS`, `RATE_LIMITER_WAIT_TIMEOUT_MS`, `ES_SYNC_TIMEOUT_MS`, `ES_BULK_TIMEOUT_MS`, `VECTOR_EMBED_TIMEOUT_MS`, `EMBEDDING_REQUEST_TIMEOUT_MS`, `VECTOR_QUERY_TIMEOUT_MS`, `ALERT_MATCH_QUERY_TIMEOUT_MS`, `API_REQUEST_TIMEOUT_MS`, `AUTH_ADMIN_CHECK_TIMEOUT_MS`. All BullMQ retry attempt counts are also configurable via the queue options pattern. |
| 9 | Every element traces to a specific FR or NFR | PASS | Leader election and BullMQ dedup key → FR-001. Expiry reminder cadence → FR-003 acceptance criteria (explicitly cited in Section 6.4). robots.txt gate → NFR-005. JWT/argon2id/RS256 → NFR-004. Semantic search latency budget → NFR-001 (500ms p95). No design elements are present without FR/NFR anchors. |
| 10 | Operator visibility: what is seen when the feature runs and when it fails | PASS | `scraper_runs` collection records every scraper execution with status, `durationMs`, listing counts, and `errorCode` for dashboard display. All error paths include a log level and structured fields. CloudWatch alarm thresholds are referenced (notification-queue failed count > 100). The DLQ Inspector cron documents its structured JSON output. Vector fallback emits a WARN-level log. FCM token removal logs at the token level. Admin health dashboard referenced from L1 (maintained). |
| 11 | Scraper isolation maintained | PASS | `scraper-worker`, `scheduler`, `es-sync-worker`, `vector-worker`, `notification-worker`, `account-worker`, and `api` remain distinct ECS services. No cross-service synchronous coupling is introduced. Internal `POST /internal/ingest` remains VPC-internal only. |
| 12 | Queue design sound | PASS | Six BullMQ queues (`scrape-queue`, `es-sync-queue`, `notification-queue`, `expiry-reminder-queue`, `vector-queue`, `deletion-queue`) each have defined payloads, concurrency, retry policy, DLQ TTL, and dedup key scheme. Expiry reminder queue uses a 6-hour `reminderWindowKey` bucket matching the 6-hour cron cadence — dedup and scheduling are consistent. |
| 13 | ES as read model; MongoDB as source of truth | PASS | Job detail endpoint (`GET /api/jobs/:id`) explicitly fetches from MongoDB, not ES, for freshness (Section 9.2). ES Sync Worker uses alias-based indexing; MongoDB is always written first before ES sync is enqueued. `DOCUMENT_NOT_FOUND` error code handles the race where a job is deleted before ES sync. |
| 14 | Data models sufficient for all FRs | PASS | `jobs`, `sources`, `users`, `refresh_tokens`, `saved_jobs`, `saved_searches`, `alerts`, `notifications`, `content`, `agency_reviews`, `es_schema_versions`, `scraper_runs` — all functional areas are covered. `FcmToken` embedded array enables push delivery. `NotificationPreferences.pushEnabled` gates push dispatch. |
| 15 | L1 advisory A1 (leader election) resolved | PASS | Section 1.1 specifies `SET NX EX` with lock key `scheduler:leader-lock`, TTL `SCHEDULER_LOCK_TTL_MS` (90s), heartbeat via `PEXPIRE` every 30s, UUID lock value to prevent foreign `DEL`, explicit `DEL` on graceful shutdown, and TTL expiry (90s) as crash-recovery path. |
| 16 | L1 advisory A2 (expiry reminder cadence) resolved | PASS | Section 6.4 documents the 6-hour BullMQ cron with explicit reasoning: worst-case missed window is 6 hours, which still falls within the 2-day reminder window required by FR-003. The deduplication key scheme ensures at-most-one reminder per 6-hour window. |
| 17 | L1 recommendation 3 (ingest API contract) resolved | PASS | Section 1.3 defines the full `POST /internal/ingest` request (`IngestRequest`) and response (`IngestResponse`, `IngestErrorResponse`) with all four HTTP status codes (200, 400, 422, 500) and typed error codes. Deduplication key algorithm is specified in detail. |
| 18 | L1 recommendation 4 (semantic search latency budget) resolved | PASS | Section 8.2 explicitly documents the latency budget breakdown: 100ms embedding + 100ms vector DB + 200ms ES enrichment + 100ms overhead = 500ms total, satisfying NFR-001. Fallback to keyword search if `VECTOR_QUERY_TIMEOUT_MS` exceeded. |
| 19 | L1 recommendation 5 (ES migration strategy) resolved | PASS | Section 3.4 specifies the full versioning strategy: `jobs_v{N}` naming, `jobs` alias, `jobs_write` write alias for dual-write during migration, `_reindex` API, atomic alias swap, non-breaking vs breaking change distinction, and `scripts/es-migrate.ts` with `ES_MIGRATION_TIMEOUT_MS`. |

---

## Issues

None.

---

## Recommendations

1. **Implement `fcmTokens` pruning as a dedicated code path.** The stale-token pruning (>90 days `lastUsedAt`) described in Section 1.8 runs before each push dispatch. Consider extracting this into a scheduled maintenance operation (e.g. a BullMQ cron job in `account-worker`) so that devices that are never notified do not accumulate silently. The current approach is correct and safe but could leave large arrays for inactive users.

2. **Document the `account-worker` startup sequence.** Section 4.1 notes the `account-worker` registers a BullMQ worker for `deletion-queue` only. During implementation, ensure the service's ECS task definition and startup Zod validation (Section 10.8) are scoped to only the env vars it needs (`MONGODB_URI`, `REDIS_URL`, `SERVICE_NAME`) rather than the full API surface, to minimise the blast radius of misconfiguration.

3. **Alert matching scalability path.** Section 6.2 describes an in-memory fallback at 100k active alerts as unacceptable, with `ALERT_MATCH_USE_INDEXED_QUERY` as the mitigation. During implementation, add a background metric that logs the active alert count periodically so that operators can observe when the threshold is being approached before performance degrades.

4. **Validate `FcmToken.deviceId` uniqueness at API layer.** The `users.fcmTokens` array is capped at `MAX_FCM_TOKENS_PER_USER = 10`. During implementation, enforce that a new token registration for an already-registered `deviceId` replaces the existing entry (upsert by `deviceId`) rather than appending, to prevent the cap being reached by re-registrations from the same device.

5. **Integration test the `deletion-queue` cascade.** The account deletion job cascades across six collections. During implementation, write an integration test that triggers a deletion job and asserts that all associated documents (`saved_jobs`, `saved_searches`, `alerts`, `notifications`, `refresh_tokens`, and the user document) are removed or anonymised within the expected window.
