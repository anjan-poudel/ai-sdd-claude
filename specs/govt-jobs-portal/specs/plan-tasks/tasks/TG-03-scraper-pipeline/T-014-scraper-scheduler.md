# T-014: Scraper Scheduler with Redis leader election

## Metadata
- **Group:** [TG-03 — Scraper Pipeline](index.md)
- **Component:** scheduler ECS service
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** [T-002](../TG-01-infrastructure-and-project-setup/T-002-mongodb-schemas-and-indexes.md), [T-004](../TG-01-infrastructure-and-project-setup/T-004-bullmq-queue-setup.md)
- **Blocks:** T-015, T-016, T-019
- **Requirements:** [FR-001](../../../../define-requirements.md#fr-001-job-aggregation), [FR-008](../../../../define-requirements.md#fr-008-admin-cms-and-operations), [NFR-002](../../../../define-requirements.md#nfr-002-scalability), [NFR-003](../../../../define-requirements.md#nfr-003-reliability)

## Description
Implement the `SchedulerService` per L2 §1.1. The scheduler polls MongoDB every `SOURCE_POLL_INTERVAL_SECONDS` (300s) for enabled sources with `nextRunAt <= now`. Before each cycle it acquires a Redis leader lock using `SET NX EX` with a heartbeat goroutine. Enqueue `ScrapeQueueJob` for each due source with BullMQ dedup key `"scrape:${sourceId}:${bucketedTime}"`. Update `sources.nextRunAt`, `sources.lastRunAt`, and `sources.lastRunStatus` after each enqueue. Pre-create a `scraper_runs` document before enqueuing.

## Acceptance criteria

```gherkin
Feature: Scraper Scheduler

  Scenario: Only one scheduler instance runs a cycle at a time
    Given two scheduler instances are running simultaneously
    When both attempt to start a scheduling cycle at the same time
    Then only one must acquire the Redis lock and run the cycle
    And the other must log "lock acquisition failed" at INFO level and skip the cycle
    And the scrape-queue must have each source enqueued exactly once

  Scenario: Scheduler picks up new source within 5 minutes
    Given a new source is added to the sources collection with enabled: true
    When the scheduler's polling cycle runs
    Then a ScrapeQueueJob for the new source must be enqueued within SOURCE_POLL_INTERVAL_SECONDS (300s)
    And no code redeployment must be required

  Scenario: Disabled source is not enqueued
    Given a source has enabled: false
    When the scheduler's polling cycle runs
    Then no ScrapeQueueJob must be enqueued for that source
    And sources.nextRunAt must not be updated for the disabled source

  Scenario: Lock heartbeat extends TTL while cycle is running
    Given the scheduler has acquired the leader lock
    And the cycle is running (longer than SCHEDULER_LOCK_HEARTBEAT_INTERVAL_MS)
    When SCHEDULER_LOCK_HEARTBEAT_INTERVAL_MS passes
    Then the lock TTL must be extended via PEXPIRE
    And the lock must not expire while the cycle is still running

  Scenario: Lock is released on graceful shutdown
    Given the scheduler is running and holds the leader lock
    When a SIGTERM signal is received
    Then the scheduler must finish the current cycle
    And then delete the leader lock key via DEL scheduler:leader-lock
    And exit with code 0

  Scenario: Scheduler manages 200 sources in one cycle
    Given 200 enabled source configurations are in the database
    When the scheduler's polling cycle runs
    Then all 200 due sources must be evaluated within one 5-minute window
    And no source must be silently skipped
```

## Implementation notes
- Leader lock: Redis `SET scheduler:leader-lock ${instanceUUID} NX EX ${SCHEDULER_LOCK_TTL_MS/1000}`.
- Heartbeat: `setInterval(() => redis.pexpire('scheduler:leader-lock', SCHEDULER_LOCK_TTL_MS), SCHEDULER_LOCK_HEARTBEAT_INTERVAL_MS)`.
- Lock value must be the instance UUID to prevent foreign DEL (only the lock holder can delete its own lock).
- BullMQ jobId bucket: `const bucket = Math.floor(Date.now() / 900000) * 900000` (15-minute bucket).
- `scraper_runs` pre-creation: insert with `status: "running"`, `startedAt: now` before enqueue.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Leader election race condition tested by running two scheduler instances in parallel
- [ ] BullMQ dedup key tested to prevent double-enqueue
- [ ] Graceful shutdown tested with SIGTERM
