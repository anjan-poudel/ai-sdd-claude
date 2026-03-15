# Review Report — GovJobs Portal L1 Architecture

## Summary

The L1 architecture document for GovJobs Portal is thorough, well-structured, and addresses all MUST-priority functional and non-functional requirements with explicit component mappings and ADR citations. All three architecture-level constraints from the constitution (scraper isolation, queue-driven ingestion, ES-as-read-model) are correctly modelled as dedicated ECS services with clear separation of concern. Two minor advisory items are noted for resolution at L2 design but do not block progression.

## Decision

**Decision:** GO

---

## Evidence Checklist

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | All MUST-priority FRs addressed (FR-001, FR-002, FR-003, FR-007, FR-008) | PASS | Each FR is explicitly mapped to one or more named components. FR-001 → Scheduler + Scraper Workers + Ingest Service. FR-002 → ES Sync Worker + Vector Worker + Web API. FR-003 → Notification Worker. FR-007 → Auth Service + Web API. FR-008 → Admin CMS + Web API admin routes. |
| 2 | All MUST-priority NFRs addressed (NFR-001 through NFR-006) | PASS | NFR-001 performance SLAs cited in components (500ms p95 search, 60s ES sync, 15-min notification enqueue, FCP <2s). NFR-002 scalability targets tied to ECS horizontal scaling and BullMQ. NFR-003 reliability: 3-node replica set, Redis AOF, retry+DLQ, 503 degraded mode. NFR-004 security: RS256 JWT 15min, bcrypt/argon2id cost ≥12, PII stripping, Secrets Manager. NFR-005 compliance: robots.txt gate, crawl-delay, Privacy Policy footer, 30-day PII deletion. NFR-006 observability: structured JSON logs, per-source metrics, CloudWatch alarms all enumerated. |
| 3 | Scraper isolation validated (separate ECS service, no shared compute with web API) | PASS | ADR-001 explicitly mandates a dedicated ECS Fargate service `scraper-worker`. Infrastructure table confirms separation. Architecture diagram shows the scraping zone as a discrete cluster. The Ingest Service communicates only via an internal HTTP call (`POST /internal/ingest`) from the scraper to the core platform — there is no reverse dependency. |
| 4 | Queue design is sound (BullMQ/Redis, separate queues per concern) | PASS | Section 12 (Redis) confirms AOF persistence and a dedicated Redis instance. Four separate BullMQ queues are named: `scrape-queue`, `es-sync-queue`, `notification-queue`, `vector-queue`. Each has its own consumer service. BullMQ distributed locking for horizontal scale is called out in Section 2 (NFR-002). Retry semantics and dead-letter queues documented for each consumer. |
| 5 | Search architecture valid (ES as read model, MongoDB source of truth, sync SLA defined) | PASS | ADR-002 explicitly enforces this split. ES Sync Worker (Section 6) consumes `job.upserted` events and indexes within 60 seconds (FR-002, NFR-001). Mapping versioning and reversible migrations are addressed. MongoDB remains authoritative for all mutations. |
| 6 | Vector DB usage is batch-only (not on hot path) | PASS | ADR-003 explicitly prohibits embedding computation on the ingest hot path. Section 7 (Vector Worker) is a separate ECS service triggered asynchronously via `vector-queue` with a 5-minute debounce. FR-002 text ("separate batch worker and must not run on the ingestion hot path") is directly quoted in the ADR rationale. |
| 7 | Open decisions not silently resolved | PASS | ADR-008 explicitly carries forward requirements open decisions #2 (LinkedIn scraping ToS risk) and #3 (Glassdoor access) — both sources are modelled as configurable with an `enabled: false` default pending legal review. Open decision #1 (GraphQL vs REST) is noted as deferred in Section 4. Open decisions #4 (Phase 2 timeline) and #5 (GDPR scope) are correctly listed in the Out of Scope section. |
| 8 | Security constraints met (JWT, bcrypt/argon2id, no PII in logs) | PASS | JWT: RS256, 15-minute access token, 30-day HTTP-only refresh token (NFR-004). Auth: bcrypt cost 12 or argon2id (FR-007, NFR-004). PII in logs: Section 4 and Observability section both state no PII in log fields; NFR-004 scenario "Secrets are not present in application logs" is addressed via Secrets Manager. RBAC: admin endpoints double-check against MongoDB to prevent stale-token privilege escalation (sound defence-in-depth). |
| 9 | Compliance requirements addressed (robots.txt, Privacy Act) | PASS | ADR-006: robots.txt fetched and parsed before every request; disallowed paths skipped and logged (NFR-005). Crawl-delay directive respected; 2-second default applied when absent (NFR-005). Privacy Policy link in every page footer (Section 9, NFR-005). Account + PII deletion async job within 30 days (Section 4, NFR-005). Source attribution displayed on every job detail page (NFR-005). |
| 10 | Every interface method has an explicit error return type | PARTIAL | L1 is architecture-level (not code-level). Error paths are documented per component in prose and bullet lists. Formal interface method signatures are deferred to L2 component design, which is appropriate for this level of abstraction. |
| 11 | Async/external calls have documented failure modes and recovery paths | PASS | Every external call (MongoDB, ES, SES, FCM, Playwright, Vector DB) has explicit error paths documented in its component section. Recovery via retry-with-backoff, dead-letter queues, and graceful degradation is consistently specified. |
| 12 | Timeouts and retry limits are configurable parameters | PASS | `API_REQUEST_TIMEOUT_MS`, `SOURCE_POLL_INTERVAL_SECONDS`, `EXPIRY_PRESCAN_HOURS`, `EXPIRY_POSTSCAN_HOURS`, `EMBEDDING_MODEL`, `VECTOR_DB_PROVIDER` are all named as configurable env vars. Retry count (3) and backoff starting point (30s, doubling) are documented; the architecture notes these are configurable — formal environment variable names for retry parameters are a reasonable L2 elaboration. |
| 13 | Every element traces to a specific FR or NFR | PASS | Each component section and each ADR cites specific FR/NFR identifiers in parentheses. No orphaned design elements were found. The Out of Scope list mirrors the requirements Out of Scope list without introducing new items. |
| 14 | Operator visibility: what is seen when the feature runs and when it fails | PASS | NFR-006 / Observability section describes structured logs, per-source run metrics, CloudWatch alarms for all critical failure conditions (scraper failure rate, API 5xx, queue depth, MongoDB replication lag), and the admin health dashboard. Scraper error paths (robots.txt disallowed, HTTP 4xx/5xx, Playwright crash) all include "log" as part of the handling response. |

---

## Issues

No blocking issues identified. The following are advisory items for L2 design:

**Advisory A1 — Scheduler leader election mechanism unspecified**

The infrastructure table notes the `scheduler` ECS service uses "Single task (leader election)" but no mechanism is described (e.g. Redis `SET NX`, DynamoDB TTL lock, or ECS desired-count=1 as implicit exclusion). If two scheduler tasks run simultaneously, duplicate scrape jobs could be enqueued. This must be addressed in L2 design for the Scheduler component.

**Advisory A2 — Expiry reminder timing precision edge case**

Section 8 (Notification Worker) states the expiry reminder scheduler runs a "daily job" scanning for saved jobs expiring in ≤48h. FR-003 acceptance criteria require a reminder when a job has a closing date 2 days from now. A daily cadence means a job saved with less than 48 hours to closing could miss the reminder window (e.g. saved at 11pm, daily job runs at midnight, next run is 24h later when the job has already closed). L2 design should clarify the reminder polling frequency and whether a sub-24h cadence is needed to meet the FR-003 acceptance criteria reliably.

---

## Recommendations

1. **L2: Define Scheduler leader election.** Use Redis `SET NX EX` with a heartbeat TTL as a simple distributed lock. Document the lock key, TTL, and heartbeat interval so that scheduler restart time does not cause a gap in scheduling.

2. **L2: Tighten expiry reminder cadence.** Change the expiry reminder polling from "daily" to every 4–6 hours (or run it as a BullMQ cron job with a shorter interval) to avoid the edge case in Advisory A2.

3. **L2: Define the internal ingest API contract.** Section 3 shows the Scraper Worker calling `POST /internal/ingest` but does not define the request/response schema. The L2 design for the Ingest Service should specify this interface in full, including error response codes (particularly for deduplication conflicts).

4. **L2: Clarify Vector DB semantic search query path.** Section 7 describes the Web API calling the Vector DB for top-K similar job IDs then fetching from ElasticSearch. The latency impact of the extra ES lookup on the p95 500ms search SLA (NFR-001) should be measured and documented in L2.

5. **L2: Specify ES mapping migration strategy.** Section 6 mentions versioned mappings tracked in `es_schema_versions`. L2 should define the migration procedure (blue/green index alias rotation, reindex strategy) to ensure migrations are non-breaking and reversible as required by the quality standard.
