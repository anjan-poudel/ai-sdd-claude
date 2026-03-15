# T-004: BullMQ queue setup and DLQ inspector

## Metadata
- **Group:** [TG-01 — Infrastructure & Project Setup](index.md)
- **Component:** BullMQ / Redis
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-001](T-001-project-scaffold-and-infra.md)
- **Blocks:** T-012, T-013, T-016, T-017, T-025, T-026, T-027
- **Requirements:** [FR-001](../../../../define-requirements.md#fr-001-job-aggregation), [FR-003](../../../../define-requirements.md#fr-003-notifications-and-alerts), [NFR-002](../../../../define-requirements.md#nfr-002-scalability), [NFR-003](../../../../define-requirements.md#nfr-003-reliability)

## Description
Initialise all 6 BullMQ queues defined in L2 Section 4: `scrape-queue`, `es-sync-queue`, `notification-queue`, `expiry-reminder-queue`, `vector-queue`, `deletion-queue`. Configure retry policies, backoff, and job TTL per L2 §4.1. Implement the DLQ Inspector cron job that runs every 6 hours, logs structured JSON for each failed job, and triggers a CloudWatch alarm when `notification-queue` failed count exceeds 100.

## Acceptance criteria

```gherkin
Feature: BullMQ queue setup

  Scenario: BullMQ jobs survive a Redis restart
    Given 100 scraper jobs are enqueued in scrape-queue
    When the Redis instance is restarted
    Then all 100 jobs must still be present in the queue after Redis comes back online
    And the workers must resume processing them without manual intervention

  Scenario: Failed scraper job is retried with exponential backoff
    Given a scrape-queue job is configured to fail on the first two attempts
    When the job fails for the first time
    Then it must be re-enqueued with a delay of at least 30000ms
    And after a second failure the delay must be at least 60000ms
    And after 3 consecutive failures the job must move to the failed set

  Scenario: DLQ inspector logs structured JSON for failed jobs
    Given a scrape-queue job has failed and exhausted retries
    When the DLQ inspector cron runs
    Then a structured JSON log entry must be emitted containing source_queue, job_id, failure_reason, and attempt_count
```

## Implementation notes
- Redis must be configured with AOF persistence (`appendonly yes`) to satisfy NFR-003.
- BullMQ `jobId` dedup: pass `{ jobId: "scrape:${sourceId}:${bucketedTime}" }` as job options to prevent double-enqueue (L2 §4.2).
- The DLQ inspector must use BullMQ's `Queue.getFailed()` method.
- CloudWatch alarm creation can be a separate `scripts/setup-alarms.ts` script; the inspector emits the metric.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] All 6 queues initialised with correct retry policies
- [ ] Redis AOF persistence verified in Docker Compose configuration
- [ ] DLQ inspector integration test passes
