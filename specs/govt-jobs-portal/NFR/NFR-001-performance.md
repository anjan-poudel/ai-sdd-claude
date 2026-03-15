# NFR-001: Performance

## Metadata
- **Category:** Performance
- **Priority:** MUST

## Description

The system must meet the following specific performance targets:

- **Search latency:** ElasticSearch query API must respond with results in under 500 ms at the 95th percentile (p95) under normal load (up to 200 concurrent search users).
- **Page load:** Core user-facing pages (home, search results, job detail) must achieve a Time to First Contentful Paint (FCP) of under 2 seconds on a simulated 4G mobile connection.
- **Scraper throughput:** The scraper fleet must be capable of processing at least 500 job listings per minute in aggregate across all sources during a scheduled bulk run.
- **Notification delivery:** Job alert notifications must be enqueued for delivery within 15 minutes of a matching job being ingested and indexed.
- **ElasticSearch sync:** Changes to job records in MongoDB must be reflected in ElasticSearch within 60 seconds.
- **Ad load:** Ad unit loading must not delay First Contentful Paint; ads must load asynchronously.

## Acceptance criteria

```gherkin
Feature: Performance

  Scenario: Search API meets p95 latency target under load
    Given the ElasticSearch index contains at least 50,000 active job records
    And 200 concurrent users are each submitting search queries
    When latency is measured across 1000 requests
    Then the p95 response time must be less than 500 ms
    And the p99 response time must be less than 1000 ms

  Scenario: Job detail page meets FCP target on 4G
    Given the portal is running in production configuration with CDN enabled
    When a Lighthouse audit simulates a 4G mobile connection loading a job detail page
    Then the First Contentful Paint must be under 2000 ms
    And the Largest Contentful Paint must be under 4000 ms

  Scenario: Scraper fleet meets throughput target
    Given 10 scraper worker instances are running
    When a bulk scrape of a large government board (5000 listings) is triggered
    Then the entire job set must be ingested and stored within 10 minutes
    And the per-minute throughput must average at least 500 listings per minute

  Scenario: Alert notification is enqueued promptly after ingestion
    Given a user has an active alert matching keyword "graduate policy"
    When a matching job is ingested and indexed
    Then a notification task must appear in the notification queue within 15 minutes
    And the task must be delivered to the user within a further 5 minutes under normal queue load

  Scenario: MongoDB to ElasticSearch sync completes within SLA
    Given a job record's expiry date is updated in MongoDB
    When 60 seconds have elapsed
    Then the corresponding ElasticSearch document must reflect the updated expiry date
```

## Related
- FR: FR-001 (scraper throughput), FR-002 (search latency), FR-003 (notification delivery), FR-008 (admin dashboard staleness)
