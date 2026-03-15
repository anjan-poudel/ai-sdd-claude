# T-027: Expiry reminder scheduler (6-hour cron, dedup)

## Metadata
- **Group:** [TG-05 — Notifications & Alerts](index.md)
- **Component:** notification-worker — expiry reminder cron
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-026](T-026-notification-worker.md)
- **Blocks:** —
- **Requirements:** [FR-003](../../../../define-requirements.md#fr-003-notifications-and-alerts)

## Description
Implement the expiry reminder BullMQ cron job per L2 §6.4. Runs every `EXPIRY_REMINDER_CRON` (default: `"0 */6 * * *"` — every 6 hours). Queries `saved_jobs` for jobs where `expiryDate` is between `now + EXPIRY_REMINDER_MIN_HOURS` (24h) and `now + EXPIRY_REMINDER_MAX_HOURS` (72h), `expiryReminderSentAt` is null, and `status === "active"`. Enqueues `ExpiryReminderQueueJob` with dedup key `"expiry-reminder:${savedJobId}:${reminderWindowKey}"` where `reminderWindowKey` is the date rounded to the nearest 6-hour bucket.

## Acceptance criteria

```gherkin
Feature: Expiry reminder scheduler

  Scenario: Expiry reminder is sent for a saved job within the reminder window
    Given a user has saved a job with expiryDate 48 hours from now
    And jobs.expiryReminderSentAt is null
    When the expiry reminder scheduler runs
    Then an ExpiryReminderQueueJob must be enqueued for that savedJob
    And the notification must eventually be delivered via the user's preferred channel

  Scenario: No duplicate reminder in same 6-hour window
    Given a reminder has already been enqueued for savedJob "xyz" in the current 6-hour window
    When the scheduler runs again within the same 6-hour window
    Then no second ExpiryReminderQueueJob must be enqueued for savedJob "xyz"
    And the duplicate-key error must be silently swallowed

  Scenario: Job already past reminder window is not reminded
    Given a job has expiryDate 1 hour from now (below EXPIRY_REMINDER_MIN_HOURS = 24h)
    When the scheduler runs
    Then no reminder must be enqueued for that job

  Scenario: Reminder is sent within the 2-day window even for late-saved jobs
    Given a user saves a job 2.5 days before its expiry date
    When the next 6-hour scheduler cycle runs
    Then an expiry reminder must be enqueued
    And the user must receive the reminder at least 24 hours before expiry
```

## Implementation notes
- Reminder window query: `savedJobs.find({ 'job.expiryDate': { $gte: new Date(now + 24*3600000), $lte: new Date(now + 72*3600000) } })` joined with `jobs.status === "active"` and `jobs.expiryReminderSentAt === null`.
- 6-hour bucket: `const h = Math.floor(new Date().getHours() / 6) * 6; reminderWindowKey = YYYY-MM-DD-${String(h).padStart(2,'0')}`.
- After `processExpiryReminderJob` succeeds, update `jobs.expiryReminderSentAt = now`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] 6-hour bucket dedup key calculation tested with multiple time fixtures
- [ ] Late-save scenario tested with a job saved 2.5 days before expiry
