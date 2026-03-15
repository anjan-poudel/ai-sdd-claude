# NFR-002: Scalability

## Metadata
- **Category:** Performance
- **Priority:** MUST

## Description

The system must be designed to scale to the following volumes without architectural rework:

- **Job volume:** At least 500,000 canonical job records stored in MongoDB; at least 100,000 active (non-expired) job records indexed in ElasticSearch at any given time.
- **Concurrent users:** The web API and frontend must support at least 500 concurrent active users without degradation of response times beyond the SLAs defined in NFR-001.
- **Scraper sources:** At least 200 distinct scraper sources must be manageable without performance degradation of the scheduler.
- **User accounts:** At least 100,000 registered user accounts must be supportable.
- **Notifications throughput:** The notification worker must be capable of dispatching at least 10,000 notification emails per hour.
- **Horizontal scaling:** Scraper workers, the web API, and notification workers must be independently horizontally scalable via ECS task count adjustments without code changes.

## Acceptance criteria

```gherkin
Feature: Scalability

  Scenario: ElasticSearch handles 100,000 active job index without latency regression
    Given 100,000 active job documents are indexed in ElasticSearch
    When a user performs a keyword search with two filters applied
    Then the search API must respond within the p95 500 ms SLA defined in NFR-001

  Scenario: Web API sustains 500 concurrent users
    Given the web API is running with its standard ECS task configuration
    When a load test simulates 500 concurrent users performing mixed search and page-view operations
    Then the p95 response time must remain under 500 ms for search endpoints
    And the error rate must be less than 0.1%

  Scenario: Scraper scheduler manages 200 sources without degradation
    Given 200 scraper source configurations are stored in the database
    When the scheduler's polling cycle runs
    Then all 200 sources must be evaluated for due jobs within one 5-minute polling window
    And no source must be silently skipped due to scheduler throughput limits

  Scenario: Notification worker dispatches 10,000 emails per hour
    Given 10,000 notification tasks are enqueued simultaneously
    When the notification worker processes the queue
    Then all 10,000 notifications must be dispatched within 60 minutes
    And the worker must not crash or require manual intervention

  Scenario: Scraper workers scale horizontally
    Given the ECS task count for the scraper service is increased from 2 to 8
    When the new tasks start
    Then all 8 tasks must pick up jobs from the Bull/BullMQ queue without double-processing
    And the aggregate throughput must increase proportionally
```

## Related
- FR: FR-001 (job volume), FR-002 (concurrent users), FR-003 (notification throughput)
- NFR: NFR-001 (performance SLAs must hold at scale)
