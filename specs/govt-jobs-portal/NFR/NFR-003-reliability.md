# NFR-003: Reliability

## Metadata
- **Category:** Reliability
- **Priority:** MUST

## Description

The system must meet the following reliability targets:

- **Web application uptime:** The public-facing portal must achieve at least 99.5% monthly uptime (allowing no more than approximately 3.6 hours of downtime per month).
- **Scraper failure isolation:** A failure in any single scraper source must not cause failures in other scraper sources, the web API, or the notification pipeline. Failed scraper jobs must be automatically retried up to 3 times with exponential backoff before being marked as failed.
- **Data durability:** All canonical job records and user data must be stored in MongoDB with replication enabled (minimum replica set of 3 nodes); no data loss on single-node failure.
- **Queue durability:** Bull/BullMQ jobs must be persisted in Redis with AOF (Append-Only File) persistence enabled; jobs must survive a Redis restart.
- **Notification delivery guarantee:** Failed notification delivery attempts must be retried up to 3 times; undeliverable notifications must be moved to a dead-letter queue for manual inspection.
- **ElasticSearch degraded mode:** If ElasticSearch is temporarily unavailable, the portal must serve a graceful degraded state (display a "search temporarily unavailable" message) rather than returning an unhandled error.

## Acceptance criteria

```gherkin
Feature: Reliability

  Scenario: Portal achieves 99.5% monthly uptime
    Given the portal is deployed on AWS ECS Fargate with health checks enabled
    When uptime is measured over a 30-day calendar month
    Then total downtime must not exceed 216 minutes (99.5% = 3.6 hours per 30-day month)

  Scenario: Single scraper failure does not cascade
    Given the scraper for source A is configured to fail on every attempt (simulated)
    When the scraper scheduler runs and dispatches jobs for sources A, B, and C
    Then source A jobs must fail and be retried with exponential backoff
    And source B and source C scrapes must complete successfully
    And the web API must remain responsive throughout

  Scenario: Failed scraper job is retried with exponential backoff
    Given a scraper job fails due to a transient network error
    When the job fails for the first time
    Then it must be re-enqueued with a delay of at least 30 seconds
    And after a second failure the delay must at least double
    And after 3 consecutive failures the job must be marked as "failed" in the scheduler

  Scenario: Job records survive a MongoDB node failure
    Given a MongoDB replica set of 3 nodes is running
    When the primary node is stopped
    Then the replica set must elect a new primary within 30 seconds
    And all previously written canonical job records must be readable from the new primary
    And no job records must be lost

  Scenario: Bull/BullMQ jobs survive a Redis restart
    Given 100 scraper jobs are enqueued in Bull/BullMQ
    When the Redis instance is restarted (simulated)
    Then all 100 jobs must still be present in the queue after Redis comes back online
    And the workers must resume processing them

  Scenario: Portal serves degraded state when ElasticSearch is unavailable
    Given ElasticSearch is unreachable (simulated network failure)
    When a user submits a search query on the portal
    Then the portal must return a user-friendly message: "Search is temporarily unavailable. Please try again shortly."
    And the server must return an HTTP 503 status
    And no unhandled exception stack trace must be exposed to the user
```

## Related
- FR: FR-001 (scraper isolation), FR-002 (search degraded mode), FR-003 (notification retry)
- NFR: NFR-006 (observability must detect and alert on reliability failures)
