# GovJobs Portal — Implementation Review Report

## Summary

The L3 task breakdown is thorough, developer-ready, and faithfully derived from the L2 component design. All five MUST-priority functional requirements (FR-001 through FR-003, FR-007, FR-008) are covered by at least one named task; every task carries a title, description, explicit acceptance criteria (≥3), implementation file paths, dependency table, complexity estimate, and test requirements. No circular dependencies were found, and the sequencing of task groups is sound. The breakdown is approved for developer handoff.

## Decision

**Decision:** GO

---

## Evidence Checklist

### Criterion 1 — Coverage: all MUST-priority FRs traceable to at least one L3 task

| FR | Title | Priority | Covering Tasks |
|----|-------|----------|----------------|
| FR-001 | Job Aggregation | MUST | T-013 (Ingest), T-014 (Scheduler), T-015 (Scraper Worker), T-016 (Plugins), T-019 (Expiry tracking) |
| FR-002 | Search and Discovery | MUST | T-021 (keyword search), T-022 (semantic/hybrid search), T-023 (saved searches) |
| FR-003 | Notifications and Alerts | MUST | T-024 (alerts API), T-025 (matching engine), T-026 (Notification Worker), T-027 (expiry reminder) |
| FR-007 | User Accounts | MUST | T-008 (registration), T-009 (login/JWT), T-010 (OAuth2), T-011 (RBAC/profile), T-012 (account deletion) |
| FR-008 | Admin CMS and Operations | MUST | T-028 (content CMS), T-029 (agency reviews), T-030 (admin ops dashboard) |

**Result: PASS**

---

### Criterion 2 — Completeness: every L3 task has all required fields

Verified all 34 tasks across all 7 task groups. Each task includes:

- Title: present on all 34 tasks.
- Description: present on all 34 tasks.
- Acceptance criteria: all tasks have ≥3 explicit, testable acceptance criteria. Many have 6–8.
- Implementation notes with file paths: all tasks name specific files (e.g. `services/api/src/routes/auth/register.ts`, `services/scraper-worker/src/worker.ts`).
- Dependencies: dependency table in the task group header; individual tasks reference design-l2 sections explicitly.
- Complexity: every task carries an `Estimated complexity` label (S / M / L).
- Test requirements: every task has a dedicated `Test requirements` section with ≥3 named tests.

**Result: PASS**

---

### Criterion 3 — Critical path validity: no circular dependencies; T-001 is the root

Dependency graph check (forward edges only):

- **T-001** has no dependencies — correctly the root.
- TG-01 tasks (T-002 through T-007) all depend on T-001 only, or on each other in a linear chain (T-007 depends on T-005, T-006).
- TG-02 tasks (T-008 to T-012) depend on TG-01 outputs; T-009 depends on T-008; T-010 on T-009; T-011 on T-009; T-012 on T-004 and T-011. No backwards edges.
- TG-03 tasks (T-013 to T-019) depend on TG-01 infrastructure; T-015 depends on T-013; T-016 on T-015; T-017 on T-003 + T-004 + T-006; T-018 on T-004 + T-006; T-019 on T-014 + T-002. No backwards edges.
- TG-04 tasks (T-020 to T-023) depend on TG-01 + TG-02 outputs; T-021 on T-003 + T-020; T-022 on T-018 + T-021; T-023 on T-020 + T-002. No backwards edges.
- TG-05 tasks (T-024 to T-027) depend on TG-04 and TG-01 outputs; T-025 on T-002 + T-024; T-026 on T-004 + T-025; T-027 on T-026 + T-002. No backwards edges.
- TG-06 tasks (T-028 to T-030) all depend on T-011 + T-002. No backwards edges.
- TG-07 tasks (T-031 to T-034) depend on TG-04 (T-021, T-022) and TG-02 (T-008, T-009, T-010); T-032 depends on T-008/T-009/T-010; T-033 on T-031; T-034 on T-031 + T-032 + T-033. No backwards edges.

No cycles detected. T-001 is the topological root. Sequencing is valid.

**Result: PASS**

---

### Criterion 4 — Test coverage: scraper tasks have fixture-based unit tests; auth tasks have integration tests; no task is test-free

**Scraper tasks (TG-03) with fixture-based unit tests:**
- T-013: unit test with a "batch of 3 jobs where job[1] and job[2] have the same deduplication key" fixture.
- T-015: `robots.txt` fixture file in unit tests; `UNKNOWN_PLUGIN` unit test.
- T-016: `apsjobs-fixture.json` and `nsw-fixture.json` fixture files explicitly required; `mapApsJobsResponseToRawInput` and `mapNswJobResponseToRawInput` are the fixture-tested units.

**Auth tasks (TG-02) with integration tests:**
- T-008: integration tests for register → verify-email → duplicate email.
- T-009: integration tests for login, token expiry, refresh rotation, reuse detection, and login lockout.
- T-010: end-to-end OAuth flow using `nock` to intercept provider HTTP calls.
- T-011: integration test for stale-token admin role bypass and saved-job duplicate handling.
- T-012: integration test for account deletion cascade and login block.

**No test-free tasks:** every task has a `Test requirements` section with at least 3 named tests. Count confirmed across all 34 tasks.

**Result: PASS**

---

### Criterion 5 — Risk tasks: T-013, T-014, T-015, T-009 have sufficient detail

**T-013 (dedup >99%):**
- SHA-256 composite key formula is specified verbatim with normalisation function.
- Levenshtein secondary pass (distance ≤ 2) specified with `fastest-levenshtein` package named.
- Fixture-based unit test for exact duplicates and near-duplicates (typo scenario) both required.
- Acceptance criteria explicitly cover dedup counts (`created`, `updated`, `duplicatesSkipped`).
- MongoDB transaction pattern code snippet provided.
- **Sufficient.**

**T-014 (scheduler leader lock):**
- Redis `SET NX EX` locking with UUID instance value specified in implementation notes.
- Heartbeat (`PEXPIRE` every 30s) to prevent lock expiry during long cycles is specified.
- Lock release safety (value-match before `DEL`) is specified.
- Integration test: two Scheduler instances confirmed to produce exactly one set of enqueues per cycle.
- Integration test: lock heartbeat — confirms lock survives a 60-second cycle.
- All TTLs and intervals are configurable via named environment variables (`SCHEDULER_LOCK_TTL_MS`, `SCHEDULER_LOCK_HEARTBEAT_INTERVAL_MS`, `SOURCE_POLL_INTERVAL_SECONDS`). Not hardcoded.
- **Sufficient.**

**T-015 (Playwright robots.txt):**
- `RobotsChecker` uses `robots-parser` npm package with LRU cache (max 500, TTL `ROBOTS_CACHE_TTL_SECONDS`).
- `ROBOTS_DISALLOWED` causes the BullMQ job to be marked complete (not failed) — intentional skip behaviour specified.
- `SCRAPER_USER_AGENT` is a named configurable env var.
- Fixture `robots.txt` with `Disallow: /jobs/` and `Crawl-delay: 5` are separate fixture-tested unit tests.
- Cache hit test (second call for same domain makes no HTTP request) specified.
- **Sufficient.**

**T-009 (token reuse detection):**
- Reuse detection logic specified at acceptance-criteria level: replay of the same raw token causes ALL tokens for the user to be revoked (`revokedAt = now`) and `HTTP 401 REFRESH_TOKEN_REUSE_DETECTED`.
- Implementation note: `findOneAndUpdate` with `usedAt` field set in the same operation prevents race conditions.
- Login lockout (5 attempts in 15 minutes → 15-minute lockout) fully specified with Redis key pattern and configurable via `LOGIN_LOCKOUT_DURATION_MS`.
- Integration test explicitly covers the reuse detection scenario.
- **Sufficient.**

**Result: PASS**

---

### Criterion 6 — No scope creep: no tasks reference features not in requirements

Reviewed all 34 tasks for out-of-scope elements:

- **GDPR**: Not referenced. The lock file includes NFR-004 (Security and Privacy) and NFR-005 (Compliance); T-006 implements PII log redaction and T-008/T-009 implement email hashing. These are traceable to NFR-004/NFR-005, not to any GDPR-specific requirement beyond what is locked.
- **Mobile apps**: Not referenced anywhere in the task breakdown.
- **GraphQL**: Not referenced. The constitution's tech stack notes "REST + GraphQL (TBD)" but no task introduces a GraphQL layer. All API tasks implement REST. No scope creep.
- **Paid tier / government department self-publishing**: Not referenced. T-033 implements AdSense (FR-006 Phase 1 ad-driven revenue only). No paid-tier tasks appear.
- **Glassdoor scraping**: Not referenced. T-029 implements an internal review/rating system, which maps to FR-005. No Glassdoor scraper tasks appear.
- **LinkedIn scraping**: The constitution mentions "Scrape LinkedIn jobs filtered to government employers" as a job aggregation feature. No LinkedIn scraper plugin is included in T-016 (which covers APSjobs + NSW PSC only). This is an accepted omission for an MVP scope — it is not an added feature, it is a deferred feature that does not violate the lock file (FR-001 is still covered by T-013/T-015/T-016). Not scope creep.
- **`forgot-password` endpoint**: T-032 stubs `/auth/forgot-password` as a "coming soon" route. The stub is explicitly called out as out-of-scope for MVP and does not add functional behaviour. Acceptable.

No tasks reference features beyond the locked requirements.

**Result: PASS**

---

### Criterion 7 — Sequencing: TG-01 precedes all; auth (TG-02) precedes user-dependent features; scraper pipeline (TG-03) precedes search (TG-04)

- **TG-01 before all:** Every task in TG-02 through TG-07 depends on at least one TG-01 task (T-001, T-002, T-004, T-005, or T-006). Confirmed.
- **TG-02 before user-dependent features:** Search tasks that have user-specific behaviour (T-021 `isSaved`, T-022 authenticated search) depend on T-020 which depends on T-009 and T-011. Notifications (T-024) depend on T-020. Frontend auth (T-032) depends on T-008/T-009/T-010. Confirmed.
- **TG-03 before TG-04 search:** T-021 (keyword search) depends on T-003 (ES index). T-022 (semantic search) depends on T-018 (Vector Worker) which is in TG-03. The ES Sync Worker (T-017) must be in place before search can return documents — T-021 depends on T-003 (the index), and T-017 depends on T-004 + T-003. T-017 itself is not a direct dependency of T-021, but the index definition (T-003) is, and T-017 shares that foundation. For the full pipeline to work end-to-end, T-017 must be complete before live search data is available. This is a runtime sequencing concern (T-017 must be deployed before T-021 produces results), not a build-time dependency. The task dependency graph does not create an explicit T-021 → T-017 edge, but the design-l2 reference on T-017 makes the relationship clear and documented.
- **No infrastructure tasks ordered after application tasks.** Confirmed.

**Result: PASS** (minor advisory: T-021 does not explicitly declare T-017 as a dependency — developers should be informed that the ES Sync Worker must be running before search integration tests are meaningful, even if T-021 compiles independently).

---

## Issues

None. No blockers found. All seven criteria passed.

---

## Recommendations

The following non-blocking observations are offered to developer agents picking up tasks:

1. **T-021 runtime dependency on T-017**: The keyword search task (T-021) can be coded and unit-tested against a mocked ES client without T-017 being complete. However, integration tests that expect real documents in the ES index require the ES Sync Worker (T-017) to be running and processing `es-sync-queue` jobs. Developer agents implementing T-021 should stage integration tests to run after T-017 is deployed in the shared development environment.

2. **MongoDB replica set in Docker Compose (T-001)**: The `mongo-setup` init container must successfully run `rs.initiate()` before any service starts. Verify the init container health check is blocking (not just waiting a fixed number of seconds) to avoid race conditions in CI.

3. **T-013 BullMQ enqueue after MongoDB commit**: The implementation note in T-013 explicitly acknowledges that BullMQ enqueues happen outside the MongoDB transaction (Redis is not part of the transaction). Developers must implement the ES Sync backfill job (T-019/T-017) as the recovery path for the at-most-once risk window between `commitTransaction()` and the BullMQ enqueues. This is documented and the risk is accepted.

4. **T-016 fixture files must be committed**: The `apsjobs-fixture.json` and `nsw-fixture.json` files referenced in TG-03 test requirements must be committed to `services/scraper-worker/src/plugins/__fixtures__/`. Do not rely on live API calls in CI — fixture files provide the external schema fixture required by Development Standard 4 (external schema fixtures).

5. **T-015 Playwright stealth plugin compatibility**: `playwright-extra` with `puppeteer-extra-plugin-stealth` adapted for Playwright should be validated against the target Playwright version early in T-015 implementation. Stealth plugin version mismatches are a common integration issue with Playwright upgrades.

6. **T-022 embedding model initialisation**: `embeddingModel` and `vectorDb` instances are initialised once at startup and injected via `app.set(...)`. Ensure the vector worker startup sequence completes the embedding model warm-up before accepting requests to avoid cold-start latency spikes on the first semantic search.

7. **T-030 CloudWatch alarm check stub**: The `alarmsActive` field is stubbed when `AWS_CLOUDWATCH_ALARM_NAMES` is unset. This is acceptable for MVP. When the CloudWatch integration is implemented, ensure the alarm check timeout is configurable — a slow CloudWatch API call must not degrade the health dashboard endpoint response time.

8. **T-034 Lighthouse CI**: The `.lighthouserc.json` file must be committed before the CI pipeline is activated. The `lighthouse-ci` step should run against a local development server (not a production URL) to keep CI self-contained.
