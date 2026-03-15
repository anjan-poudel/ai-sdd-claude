# GovJobs Portal — L2 Component Design Review

## Summary

The L2 component design is thorough and implementable. All twelve MongoDB collections are specified with indexes and validation. The ES mapping, BullMQ queue design, scraper plugin interface, auth flows, API contracts, and environment variables are complete. Both L1 advisory items (A1 scheduler leader election, A2 expiry reminder cadence) are explicitly resolved with correct mechanisms. One blocker was found: FCM push token storage is not modelled in the `users` collection schema, leaving the notification worker without a defined location to read or remove tokens.

## Decision

**Decision:** NO_GO

## Evidence Checklist

| Criterion | Result | Notes |
|---|---|---|
| A1 (scheduler leader election) resolved | PASS | Section 1.1: Redis `SET NX EX` with UUID lock value, 90s TTL, 30s heartbeat via `PEXPIRE`, graceful release on shutdown, crash recovery via TTL expiry. All parameters are configurable env vars. |
| A2 (expiry reminder cadence) resolved | PASS | Section 6.4: daily cadence replaced with 6-hour BullMQ cron (`EXPIRY_REMINDER_CRON`); deduplication key scheme prevents double-sends; window configurable via `EXPIRY_REMINDER_MIN_HOURS`/`EXPIRY_REMINDER_MAX_HOURS`. |
| All 12 MongoDB collections with indexes and validation | PASS | Sections 2.1–2.12 cover: `jobs`, `sources`, `users`, `refresh_tokens`, `saved_jobs`, `saved_searches`, `alerts`, `notifications`, `content`, `agency_reviews`, `es_schema_versions`, `scraper_runs`. Each has field validation and index definitions. |
| ES index mapping complete with versioning strategy | PASS | Section 3: full mapping JSON, custom analysers (`australian_english`, `classification_keyword`, `agency_autocomplete`), `jobs_v{N}` + alias strategy, non-breaking vs breaking migration distinction, atomic alias swap, zero-downtime reindex. |
| BullMQ queue design with retry/DLQ for all queues | PASS | Section 4: six queues defined (`scrape-queue`, `es-sync-queue`, `notification-queue`, `expiry-reminder-queue`, `vector-queue`, `deletion-queue`) with per-queue retry attempts, exponential backoff delays, dead-letter TTL, and configurable concurrency. DLQ inspector cron documented in Section 4.7. |
| Scraper plugin interface is implementable | PASS | Section 5: `ScraperPlugin` interface with `fetchJobs` and `validateConfig`; full `ScraperPluginContext` (logger, rateLimiter, robotsChecker, httpClient, browser); `RateLimiter`, `RobotsChecker`, `StructuredLogger` interfaces defined. Built-in plugin registry listed. |
| Auth flows fully specified | PASS | Section 7: registration (7.1), email/password login (7.2), OAuth2 with CSRF nonce (7.3), token refresh with reuse detection (7.4), JWT key management (7.5), admin elevation (7.6). All failure modes and return types specified. |
| API request/response types complete for 5 key endpoints | PASS | Section 9: `GET /api/jobs/search` (9.1), `GET /api/jobs/:id` (9.2), `POST /api/auth/login` (9.3), `GET+POST /api/users/me/alerts` (9.4), `POST /api/auth/refresh` (9.5). All include request types, response types, and error response enumerations. |
| All env vars documented with types and defaults | PASS | Section 10: 7 subsections covering all services. Each variable has type, default (or `required`), and description. Zod startup validation documented. Secrets marked `[SECRET]` and loaded via Secrets Manager. |
| No `any` types in TypeScript interfaces | PASS | All error types use discriminated unions. `pluginConfig: Record<string, unknown>` and `metadata: Record<string, string>` are the widest types used; neither is `any`. No `any` type found in any interface. |
| Notification deduplication prevents duplicate sends | PASS | Section 6.3: unique MongoDB index on `deduplicationKey` in `notifications` collection; four key formats defined (alert email/push, expiry email/push); duplicate-key error on insert treated as successful dedup (not failure). |
| Vector search latency budget sums correctly to p95 SLA | PASS | Section 8.2: 100ms embedding + 100ms vector DB + 200ms ES enrichment + 100ms overhead = 500ms total, matching NFR-001 p95 target. Vector DB timeout fallback to keyword search also documented. |
| FCM token storage modelled in data schema | FAIL | `UserDocument` (Section 2.3) has `notificationPreferences` but no `pushTokens`/`fcmTokens` field. Appendix B references removing a token from `users.pushToken` on `FCM_TOKEN_INVALID`, but this field does not exist in the schema. The notification worker has no defined location to read or remove FCM tokens. |

## Issues

### BLOCKER — B1: FCM push token storage missing from `users` schema

**Location:** Section 2.3 (`users` collection), Appendix B (deregistration paths)

**Problem:** The `UserDocument` interface defines `notificationPreferences` (a preferences flags object) but contains no field for storing FCM device tokens. Appendix B states: "FCM token invalidated: `FCM_TOKEN_INVALID` error → Notification Worker removes FCM token from `users.pushToken` (PATCH `fcmTokens` array)." The field `pushToken` / `fcmTokens` is referenced but not defined in the schema.

Without this field:
- The notification worker has no defined location to fetch FCM tokens when dispatching push notifications (FR-003).
- The `FCM_TOKEN_INVALID` cleanup path cannot be implemented.
- It is unknown whether a user can register multiple devices (one token vs array).

**Required fix:** Add a `fcmTokens: FcmToken[]` field to `UserDocument` with a sub-document type:

```typescript
interface FcmToken {
  token: string;       // FCM registration token
  deviceId: string;    // client-generated stable device identifier
  registeredAt: Date;
  lastUsedAt: Date | null;
}
```

Add the corresponding index: `{ "fcmTokens.token": 1 }` (sparse) for fast single-token lookup on invalidation. Clarify maximum tokens per user (recommended: 10, for multi-device support).

---

### Advisory — A1: Email verification token stored with bcrypt (inconsistency with refresh token hashing)

**Location:** Section 2.3, Section 7.1

**Problem:** The email verification token (32-byte random hex) is hashed with bcrypt (Section 7.1, step 5: "Hash verify token (bcrypt for storage)"). Refresh tokens (also 32-byte random hex) are hashed with sha256 (Section 7.4, step 1: "sha256(rawToken)"). Bcrypt is designed for password stretching (slow key derivation), not for hashing random tokens — it introduces unnecessary latency (~100ms) and is semantically wrong here. A random 32-byte token has enough entropy that sha256 is sufficient and correct.

**Recommendation:** Use sha256 consistently for all random token hashing (email verification, refresh tokens). Reserve bcrypt/argon2id for password hashing only.

---

### Advisory — A2: `RobotsChecker.isAllowed()` return type union is awkward

**Location:** Section 5.1, `RobotsChecker` interface

**Problem:** `isAllowed(url, userAgent): Promise<boolean | ScraperWorkerError>` requires callers to type-narrow a primitive `boolean` against an error object. Checking `typeof result === "boolean"` is not standard TypeScript discriminated union practice. Consider `Promise<{ allowed: boolean } | ScraperWorkerError>` or returning `Promise<boolean>` and throwing `ScraperWorkerError` on fetch failure.

**Impact:** Advisory only — the interface is implementable as written.

---

### Advisory — A3: `deletion-queue` consumer runs inside the `api` service

**Location:** Section 4.1

**Problem:** The deletion queue consumer is assigned to the `api` service (worker module), meaning a stateless web server hosts a long-running background worker. This complicates graceful shutdown (worker must drain before process exit), adds memory pressure to the API service, and increases the blast radius of a deletion worker bug on the API.

**Recommendation:** Either create a dedicated `deletion-worker` ECS service, or add a note that the `api` service runs the deletion worker as a background thread with explicit shutdown handling.

---

### Advisory — A4: In-memory alert matching scalability threshold

**Location:** Section 6.2

**Problem:** The full in-memory alert scan (fetching all active alerts for every ingested job) is acknowledged as a scalability concern with a `ALERT_MATCH_INDEX_THRESHOLD` escape hatch (default: 10,000). At 100k users with 10 alerts each, the worst-case is 1M active alerts. The escape hatch exists but its correctness under concurrent ingest load is not described.

**Recommendation:** Explicitly state the MongoDB query and index used when `ALERT_MATCH_USE_INDEXED_QUERY=true`. The current text says "queries MongoDB with a compound filter on `governmentLevel` and `state` first" but the `alerts` collection index section (2.7) only has `{ userId, status }` and `{ status }`. The compound index `{ status, "criteria.governmentLevels" }` mentioned as a future index in 2.7 must be documented as a required pre-condition for enabling `ALERT_MATCH_USE_INDEXED_QUERY=true`.

## Recommendations

For the implementation phase:

1. **Resolve B1 before starting implementation of the notification worker.** FCM token storage must be defined — the push notification delivery path depends on it.

2. **Standardise token hashing to sha256 for all random tokens.** This removes a subtle semantic error and simplifies the implementation.

3. **Implement startup validation (Section 10.8) as the first task.** Zod-based environment validation catches deployment errors early and is a fast win.

4. **The scraper plugin interface (Section 5) is well-designed — follow it strictly.** The injection of `robotsChecker` and `rateLimiter` via `ScraperPluginContext` correctly prevents plugins from bypassing compliance controls.

5. **Use the write alias (`jobs_write`) from day one.** Section 3.1 defines it; ensure the ES Sync Worker writes via `jobs_write` and never directly addresses a versioned index.

6. **The `deletion-queue` worker belongs in a dedicated service.** Even if deferred to a later implementation task, the service boundary decision should be made before deploying to production.

7. **Document the FCM token schema change in the L2 document before implementation begins.** The data model must be the authoritative source of truth.
