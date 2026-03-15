# TG-05: Notifications and Alerts

> **Jira Epic:** Notifications and Alerts

## Description

Implements the alert subscription management API, the in-memory alert matching engine with threshold-based indexed query switching, the Notification Worker (SES email + FCM push dispatch with deduplication and stale token pruning), and the expiry reminder scheduler that runs every 6 hours. All notification delivery is queue-driven and asynchronous per FR-003.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| T-024 | Implement alert subscription management API | S | T-020, T-002 | LOW |
| T-025 | Implement notification matching engine | M | T-002, T-024 | MEDIUM |
| T-026 | Implement Notification Worker: SES email and FCM push dispatch | L | T-004, T-025 | HIGH |
| T-027 | Implement expiry reminder scheduler (6-hour cron) | M | T-026, T-002 | MEDIUM |

---

## T-024: Implement alert subscription management API

**Design-l2 reference:** Section 2.7 (`alerts` collection), Section 9.4 (`GET/POST /api/users/me/alerts`), Section 6.1 (alert criteria)

### Description

Implement CRUD endpoints for user alert subscriptions: `GET /api/users/me/alerts`, `POST /api/users/me/alerts`, `PATCH /api/users/me/alerts/:id`, `DELETE /api/users/me/alerts/:id`. Enforce the `ALERTS_PER_USER` limit (default 10 active + paused). Validate `SearchCriteriaInput` using Zod. `DELETE` is a soft delete (sets `status: "deleted"`).

### Acceptance criteria

- `POST /api/users/me/alerts` creates an alert with `status: "active"` and returns `HTTP 201 CreateAlertResponse`.
- `POST /api/users/me/alerts` requires `channels` (at least one of `"email"` or `"push"`) and at least one non-empty criterion — otherwise returns `HTTP 422`.
- `POST /api/users/me/alerts` when user already has 10 active/paused alerts returns `HTTP 422` with `code: "VALIDATION_ERROR"` message "Alert limit (10) reached."
- `PATCH /api/users/me/alerts/:id` with `{ status: "paused" }` sets the alert to paused; a paused alert does not fire.
- `PATCH /api/users/me/alerts/:id` with `{ status: "deleted" }` sets soft-deleted status (same as DELETE).
- `DELETE /api/users/me/alerts/:id` soft-deletes the alert (sets `status: "deleted"`); subsequent `GET` does not include deleted alerts.
- `PATCH /api/users/me/alerts/:id` for an alert owned by a different user returns `HTTP 404`.
- `salaryBandMax >= salaryBandMin` is enforced by Zod validation when both are present.

### Implementation notes

- File: `services/api/src/routes/users/alerts.ts`.
- `ALERTS_PER_USER` limit check: count `{ userId, status: { $in: ['active', 'paused'] } }` before insert.
- Soft delete: `Alert.findOneAndUpdate({ _id: id, userId }, { $set: { status: 'deleted' } })`.
- `GET /api/users/me/alerts` filters out `status: "deleted"` documents.
- The Zod schema for `CreateAlertRequestBody` must use `.refine()` to check `salaryBandMax >= salaryBandMin`.
- `channels` Zod: `z.array(z.enum(['email', 'push'])).min(1)`.
- Alert `name` must be unique per user (enforced at API layer, not DB-unique index): if name already exists for this user and status is active or paused, return 422.

### Test requirements

- Integration test: create 10 alerts, 11th returns 422 alert limit message.
- Integration test: `PATCH` to pause an alert — confirm alert not included in notification matching for next ingest event.
- Integration test: `DELETE` then `GET` — deleted alert not in list.
- Unit test: Zod validation rejects `{ salaryBandMin: 100000, salaryBandMax: 50000 }` (max < min).
- Integration test: `PATCH` on another user's alert returns 404.

### Estimated complexity: S

---

## T-025: Implement notification matching engine

**Design-l2 reference:** Section 6 (Notification Matching Logic), Section 6.1 (criteria matching rules), Section 6.2 (matching algorithm), Section 6.3 (deduplication key scheme)

### Description

Implement the `matchAlertsForJob(job: JobDocument): Promise<AlertDocument[]>` function used by the Notification Worker. For each ingested job, this function fetches all active alerts and applies the in-memory matching rules from design-l2.md Section 6.2. When `ALERT_MATCH_USE_INDEXED_QUERY=true` or when alert count exceeds `ALERT_MATCH_INDEX_THRESHOLD` (10000), pre-filter using MongoDB's compound index on `{ status, governmentLevel, state }` before in-memory scoring.

### Matching rules (from Section 6.1)

- `criteria.query`: case-insensitive substring match against `title + " " + agency + " " + descriptionText`.
- `criteria.agencies`: normalised agency name must be in the list.
- `criteria.classifications`: prefix match — e.g. `"APS 5"` matches `"APS 5-6"` or `"APS 5"`.
- `criteria.locations`: location must contain at least one listed location (substring).
- `criteria.governmentLevels`: exact match.
- `criteria.states`: exact match on `job.state`.
- `criteria.salaryBandMin`: `job.salaryBand.max >= salaryBandMin` (or salary not specified).
- `criteria.salaryBandMax`: `job.salaryBand.min <= salaryBandMax` (or salary not specified).
- Empty/null criteria field: wildcard (no restriction).

### Acceptance criteria

- `matchAlertsForJob(job)` returns only alerts whose ALL specified criteria match the job (AND across criteria types, OR within a single list).
- An alert with `criteria.query = "nurse"` does NOT match a job with `title: "Software Engineer"` and `agency: "Health Department"`.
- An alert with `criteria.classifications = ["APS 5"]` DOES match a job with `classification: "APS 5-6"` (prefix match).
- An alert with `criteria.salaryBandMin = 80000` does NOT match a job with `salaryBand: { max: 75000 }`.
- An alert with `criteria.agencies = []` (empty list) matches any agency (wildcard).
- When alert count is below `ALERT_MATCH_INDEX_THRESHOLD`, `matchAlertsForJob` fetches all active alerts in one query (`{ status: "active" }`).
- When `ALERT_MATCH_USE_INDEXED_QUERY=true`, the pre-filter query uses the compound index `{ status, governmentLevel, state }` (confirmed by explain plan test).
- `matchAlertsForJob` completes within `ALERT_MATCH_QUERY_TIMEOUT_MS` (5000ms); times out with a structured error, not an unhandled rejection.

### Implementation notes

- File: `services/notification-worker/src/matching/alert-matcher.ts`.
- `normalise = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, ' ')`.
- Prefix match for classification: `normalise(job.classification).startsWith(normalise(criteriaClassification))`.
- Location contains: `normalise(job.location).includes(normalise(criteriaLocation))`.
- Salary wildcard: if `job.salaryBand.max === null`, the `salaryBandMin` check passes (unknown salary is not excluded).
- Query timeout: `Alert.find({ status: 'active', ...preFilter }).maxTimeMS(ALERT_MATCH_QUERY_TIMEOUT_MS)`.
- The function does NOT enqueue notifications — it returns matched alerts. The caller (Notification Worker) does the enqueue.

### Test requirements

- Unit test: `matchAlertsForJob` with a fixture job and 10 fixture alerts — only the 3 alerts that match all criteria are returned.
- Unit test: classification prefix match — `"APS 5"` alert matches `"APS 5-6"` job.
- Unit test: salary wildcard — alert with `salaryBandMin: 80000` matches a job where `salaryBand.max === null`.
- Unit test: empty `criteria.agencies` matches any agency.
- Unit test: case-insensitive query match — alert `query: "Policy Analyst"` matches job `title: "policy analyst canberra"`.
- Unit test: `criteria.query = "nurse"` does NOT match job `{ title: "Software Engineer", agency: "Health Department", descriptionText: "..." }` unless "nurse" appears in the text.
- Integration test: `ALERT_MATCH_USE_INDEXED_QUERY=true` — query explain plan confirms the `{ status, governmentLevel, state }` index is used.
- Performance test: 10,000 alert records in MongoDB; `matchAlertsForJob` completes in under 500ms.

### Estimated complexity: M

---

## T-026: Implement Notification Worker: SES email and FCM push dispatch

**Design-l2 reference:** Section 1.8 (Notification Worker), Section 2.8 (`notifications` collection), Section 6.3 (deduplication key scheme), Section 10.6 (Notification Worker env vars)

### Description

Implement the `notification-worker` service that consumes `notification-queue` BullMQ jobs. For each job: check the deduplication key against the `notifications` collection (unique index prevents duplicate sends); fetch the alert and user; dispatch via SES (email) or FCM (push) based on `alert.channels`; handle stale FCM token pruning; update the notification document status. Retry up to 3 times with 10s/20s/40s backoff on SES/FCM transient failures.

### FCM token management

- Per user, fan out to all `users.fcmTokens` (up to `MAX_FCM_TOKENS_PER_USER = 10`).
- After each FCM dispatch: update `fcmTokens[i].lastUsedAt`.
- On `FCM_TOKEN_INVALID` error: atomically remove the token via `User.findByIdAndUpdate({ _id: userId }, { $pull: { fcmTokens: { token: invalidToken } } })`.
- Prune stale tokens before dispatching: remove tokens where `lastUsedAt < now - 90 days`.

### Acceptance criteria

- A `notification-queue` job with `alertId` and `mongoJobId` causes the matching engine to run, and for each matching alert, a `NotificationDocument` is inserted with `status: "pending"`.
- The `deduplicationKey` for email alerts is `"alert:email:${alertId}:${mongoJobId}"`.
- Attempting to insert a `NotificationDocument` with a duplicate `deduplicationKey` causes a MongoDB unique-key error; the worker catches this, logs at DEBUG level, and marks the BullMQ job as complete (not retried).
- An SES email is sent to `user.email` via `@aws-sdk/client-ses` `SendEmailCommand` with the job title, agency, closing date, and a direct link.
- A FCM push is dispatched to all `users.fcmTokens` for the user; if FCM returns `messaging/registration-token-not-registered`, that token is removed from the user document.
- After a successful send, the `NotificationDocument.status` is updated to `"sent"` and `sentAt` is set.
- SES transient failure (e.g. `ThrottlingException`) retries up to 3 times; after 3 failures, the notification document is updated to `status: "failed"` and the BullMQ job is moved to the failed state.
- A `paused` or `deleted` alert is detected at notification processing time — if the alert status is not `"active"`, the notification is silently skipped (BullMQ job completes, notification document is NOT created).
- `ALERT_NOT_FOUND` (alert deleted between enqueue and process): skip silently.

### Implementation notes

- File: `services/notification-worker/src/worker.ts`.
- For each `notification-queue` job, the flow is:
  1. Fetch alert by `alertId` — if `status !== 'active'`, skip.
  2. Fetch user by `userId` — if not found, skip.
  3. For each channel in `alert.channels`:
     a. Compute `deduplicationKey`.
     b. `Notification.create({ deduplicationKey, ... })` — catches duplicate key error.
     c. Dispatch via SES or FCM.
     d. `Notification.findByIdAndUpdate(notifId, { status: 'sent', sentAt: now })`.
- SES send: `new SESClient({ region: AWS_SES_REGION })` + `SendEmailCommand`. Email template: inline HTML.
- FCM send: use `firebase-admin` SDK. `admin.messaging().sendToDevice(token, message)`.
- Stale token prune: `const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); await User.findByIdAndUpdate(userId, { $pull: { fcmTokens: { lastUsedAt: { $lt: cutoff } } } })`.

### Test requirements

- Unit test: deduplication — inserting a `NotificationDocument` with an existing `deduplicationKey` throws a MongoError with code 11000; worker catches and completes the job.
- Integration test with mocked SES: `notification-queue` job with valid alert and user → SES `SendEmailCommand` is called with correct recipient and content; `NotificationDocument.status === "sent"`.
- Integration test with mocked FCM: FCM dispatch fans out to all 3 tokens for a user.
- Unit test: FCM `registration-token-not-registered` error removes the invalid token from `users.fcmTokens`.
- Unit test: stale tokens (lastUsedAt > 90 days ago) are pruned before dispatch.
- Integration test: SES throttling error on first 2 attempts, success on 3rd — `NotificationDocument` ends as `"sent"`.
- Unit test: paused alert — `notification-queue` job for a paused alert is completed without creating a `NotificationDocument`.

### Estimated complexity: L

---

## T-027: Implement expiry reminder scheduler (6-hour cron)

**Design-l2 reference:** Section 6.4 (Expiry Reminder Polling Cadence, resolves A2), Section 4.5 (`expiry-reminder-queue` payload), Section 10.6 (`EXPIRY_REMINDER_CRON`)

### Description

Implement the expiry reminder BullMQ cron job that runs every 6 hours (`EXPIRY_REMINDER_CRON = "0 */6 * * *"`). The cron job queries `saved_jobs` for entries where `jobs.expiryDate` is between `now + EXPIRY_REMINDER_MIN_HOURS (24h)` and `now + EXPIRY_REMINDER_MAX_HOURS (72h)` and `jobs.expiryReminderSentAt` is null. For each match, enqueue an `ExpiryReminderQueueJob` with the 6-hour bucket-aligned deduplication key. The Notification Worker (T-026) processes these jobs and sends the reminder.

### Acceptance criteria

- The expiry reminder cron job is registered as a BullMQ cron job using `new QueueScheduler('expiry-reminder-queue')` and a repeatable job with `cron: "0 */6 * * *"`.
- When the cron runs and a user has a saved job with `expiryDate = now + 36h` and `expiryReminderSentAt = null`, an `ExpiryReminderQueueJob` is enqueued.
- The `jobId` of the enqueued job is `"expiry-reminder:${savedJobId}:${reminderWindowKey}"` where `reminderWindowKey = "YYYY-MM-DD-HH"` (HH floored to nearest 6-hour bucket).
- Running the cron twice in the same 6-hour bucket for the same saved job enqueues only one reminder (BullMQ dedup by jobId).
- The `jobs.expiryReminderSentAt` field is set to the current timestamp after the reminder notification is sent (by the Notification Worker, not the cron job).
- After `expiryReminderSentAt` is set, the same job is NOT re-queued by subsequent cron runs (the query filters `expiryReminderSentAt: null`).
- A job with `expiryDate < now` (already expired) is NOT included in the reminder query.
- The cron job handles MongoDB query failures gracefully: logs the error and exits without crashing the notification-worker process.

### Implementation notes

- File: `services/notification-worker/src/expiry-reminder.cron.ts`.
- The cron job runs within the `notification-worker` service (shares the process with the main notification BullMQ worker).
- MongoDB query:
  ```typescript
  const now = new Date();
  const minExpiry = new Date(now.getTime() + EXPIRY_REMINDER_MIN_HOURS * 3600000);
  const maxExpiry = new Date(now.getTime() + EXPIRY_REMINDER_MAX_HOURS * 3600000);
  const savedJobs = await SavedJob.find()
    .populate({ path: 'jobId', match: { status: 'active', expiryDate: { $gte: minExpiry, $lte: maxExpiry }, expiryReminderSentAt: null } });
  ```
- After Notification Worker sends the reminder email/push, it calls `Job.findByIdAndUpdate(mongoJobId, { $set: { expiryReminderSentAt: new Date() } })`.
- `reminderWindowKey` helper: `format(floor(expiryDate, '6h'), 'yyyy-MM-dd-HH')` where floor = truncate HH to 0, 6, 12, or 18.
- BullMQ cron scheduling: use the BullMQ repeatable job API — `queue.add('expiry-reminder-scan', {}, { repeat: { cron: EXPIRY_REMINDER_CRON } })`.

### Test requirements

- Unit test: `computeReminderWindowKey(new Date('2024-05-15T19:30:00Z'))` returns `"2024-05-15-18"`.
- Integration test: seed a saved job with `expiryDate = now + 36h` and `expiryReminderSentAt = null`; run the cron handler; confirm one `ExpiryReminderQueueJob` enqueued.
- Integration test: run the cron handler twice in the same 6-hour window; confirm the dedup key prevents a second enqueue.
- Integration test: saved job with `expiryDate = now + 36h` and `expiryReminderSentAt` already set — no new job enqueued.
- Integration test: saved job with `expiryDate < now` (already expired) — not included in cron run.
- Unit test: MongoDB query failure in cron handler logs error but does not crash the process (exception is caught).

### Estimated complexity: M
