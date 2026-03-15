# NFR-006: Observability

## Metadata
- **Category:** Observability
- **Priority:** MUST

## Description

The system must provide sufficient observability to support operational monitoring, incident response, and debugging without requiring direct database or server access. Specific requirements:

- **Structured logging:** All application services (web API, scraper workers, notification workers) must emit structured JSON logs with fields: timestamp, service name, log level, correlation/trace ID, and message.
- **Scraper metrics:** Per-source metrics must be emitted after each scrape run: source name, run start time, run end time, listings discovered, listings new, listings updated, listings unchanged, HTTP errors encountered, and final status (success/partial/failed).
- **API metrics:** The web API must expose request count, error rate (4xx and 5xx), and p50/p95/p99 latency per endpoint.
- **Alerting:** The following conditions must trigger automated alerts (e.g. AWS CloudWatch alarms or equivalent): scraper source failure rate above 20% of sources in any 1-hour window; web API error rate above 1% over 5 minutes; notification queue depth exceeding 10,000 unprocessed items; MongoDB replication lag exceeding 10 seconds.
- **Dashboard:** A CloudWatch (or equivalent) dashboard must aggregate the above metrics for operational visibility.
- **No PII in logs:** Log entries must not contain email addresses, JWT tokens, OAuth tokens, or any user-identifying information beyond an anonymised user ID.

## Acceptance criteria

```gherkin
Feature: Observability

  Scenario: Scraper emits structured metrics after each run
    Given a scraper source completes a successful run ingesting 150 listings
    When the run finishes
    Then a structured JSON log entry must be emitted containing: source_name, run_start, run_end, listings_discovered=150, listings_new (integer), listings_updated (integer), status="success"
    And the log entry must be queryable in the centralised log store within 60 seconds

  Scenario: API latency metrics are recorded per endpoint
    Given the web API has processed 100 requests to GET /api/jobs/search
    When the metrics aggregation runs
    Then p50, p95, and p99 latency values must be available for the /api/jobs/search endpoint
    And these values must be visible on the operations dashboard

  Scenario: Alert fires when scraper failure rate exceeds threshold
    Given 10 scraper sources are configured
    When 3 or more sources fail within a 1-hour window (30% failure rate)
    Then an automated alert must be triggered and delivered to the configured alerting channel within 5 minutes

  Scenario: Alert fires when API error rate exceeds threshold
    Given the web API is receiving traffic
    When the 5xx error rate exceeds 1% of all requests over any rolling 5-minute window
    Then an automated alert must be triggered and delivered to the configured alerting channel within 5 minutes

  Scenario: Alert fires when notification queue depth is too high
    Given the notification queue is being monitored
    When the number of unprocessed items exceeds 10,000
    Then an automated alert must be triggered and delivered within 5 minutes

  Scenario: No PII appears in application logs
    Given the web API handles a user registration request containing an email address
    When the request is processed and log entries are written
    Then the email address must not appear in plain text in any log entry
    And the JWT token value must not appear in any log entry
```

## Related
- FR: FR-001 (scraper metrics), FR-008 (admin scraper health dashboard uses these metrics)
- NFR: NFR-003 (reliability — alerting is the detection mechanism for reliability failures), NFR-004 (no PII in logs)
