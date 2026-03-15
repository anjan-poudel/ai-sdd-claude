# T-019: Expiry tracking and high-frequency re-scan enqueue

## Metadata
- **Group:** [TG-03 — Scraper Pipeline](index.md)
- **Component:** scheduler ECS service (expiry scan module)
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-014](T-014-scraper-scheduler.md)
- **Blocks:** —
- **Requirements:** [FR-001](../../../../define-requirements.md#fr-001-job-aggregation)

## Description
Implement the expiry re-scan enqueue logic within the Scheduler service per L2 §1.1. Jobs with `expiryDate` within the next 72 hours (pre-expiry) are enqueued for re-scan every 12 hours. Jobs up to 48 hours past their `expiryDate` (post-expiry) continue to be re-scanned. Uses the same `ScrapeQueueJob` payload with `runType: "expiry_rescan"`. After the re-scan, the scraper worker updates `jobs.lastSeenAt` or marks the job expired if absent from source.

## Acceptance criteria

```gherkin
Feature: Expiry tracking and re-scan

  Scenario: Job approaching expiry is enqueued for high-frequency rescan
    Given a job has expiryDate 50 hours from now
    When the expiry tracking scheduler runs
    Then a ScrapeQueueJob with runType "expiry_rescan" must be enqueued for that job's source URL
    And the job must be re-enqueued every EXPIRY_RESCAN_INTERVAL_HOURS (12 hours)

  Scenario: Post-expiry job is still re-scanned
    Given a job had expiryDate 24 hours ago (within the 48-hour post-expiry window)
    When the expiry tracking scheduler runs
    Then a ScrapeQueueJob with runType "expiry_rescan" must be enqueued for that job

  Scenario: Job extension after expiry updates record
    Given a job was marked with expiryDate yesterday
    And the re-scan finds the job still listed with a new closing date 7 days from now
    When the ingest service processes the re-scraped listing
    Then jobs.expiryDate must be updated to the new closing date
    And jobs.status must remain "active"

  Scenario: Job is marked expired after 48-hour post-expiry window without reappearance
    Given a job's expiryDate passed 50 hours ago
    And no re-scan has found the listing live since expiry
    When the expiry tracking scheduler evaluates the job
    Then jobs.status must be set to "expired"
    And an es-sync-queue job must be enqueued to remove the job from active search results
```

## Implementation notes
- Query: `jobs.find({ status: "active", expiryDate: { $gte: now, $lte: now + 72h } })` for pre-expiry; `{ status: "active", expiryDate: { $gte: now - 48h, $lt: now } }` for post-expiry.
- Use the compound index `{ status, expiryDate, lastSeenAt }` for this query.
- A job is marked expired by the scheduler only if `lastSeenAt < expiryDate - 48h` (no re-scan confirmed it live after expiry).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Pre-expiry and post-expiry window enqueue logic tested with time-shifted fixtures
- [ ] Job extension scenario tested end-to-end through ingest
