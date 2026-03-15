# FR-001: Job Aggregation

## Metadata
- **Area:** Job Aggregation
- **Priority:** MUST
- **Source:** constitution.md — Functional Requirements / Job Aggregation

## Description

The system must automatically ingest government job listings from multiple source types: official government REST APIs where available, web scraping of government job boards (federal, state, territory, council, and statutory bodies), and LinkedIn jobs filtered to government employers. Each source must be assigned a configurable scrape schedule stored in the database (no code change required to adjust frequency). The system must deduplicate jobs across sources and maintain a canonical job record with full source attribution. The system must track expiry dates for each job listing and automatically reschedule high-frequency re-scans in the window before and after a listed expiry date to detect extensions or renewals.

## Acceptance criteria

```gherkin
Feature: Job Aggregation

  Scenario: Ingest a job from a government REST API
    Given a government agency publishes a REST API endpoint listing open roles
    And the source is configured in the scraper config with a valid endpoint and schedule
    When the scheduled ingestion job runs
    Then the system must fetch all job listings from the API
    And each listing must be stored as a canonical job record in MongoDB
    And the record must include source attribution (agency name, source URL, source type "api")
    And the job must be indexed in ElasticSearch within 60 seconds of storage

  Scenario: Ingest a job by scraping a government job board
    Given a government job board is configured as a scrape target
    And the target page is reachable
    When the scheduled scrape job runs for that board
    Then the scraper must extract all job listings present on the board
    And each listing must be stored as a canonical job record in MongoDB
    And the record must include source attribution (board name, source URL, source type "scrape")

  Scenario: Deduplicate a job that appears on multiple sources
    Given job "Senior Policy Officer" at "Dept of Finance" is already stored with source "apsjobs.gov.au"
    When the same job is encountered during a scrape of "seek.com.au/government"
    Then the system must not create a duplicate canonical record
    And the system must add the new source URL to the existing record's source attribution list
    And the deduplication accuracy must be greater than 99% when measured against the known-duplicate test dataset

  Scenario: Reschedule scan near a job's expiry date
    Given a canonical job record has an expiry date set to 3 days in the future
    When the expiry-tracking scheduler runs
    Then the system must enqueue a high-frequency re-scan for that job's source URL
    And re-scans must occur at least once every 12 hours in the 72-hour window before expiry
    And re-scans must continue for at least 48 hours after the listed expiry date

  Scenario: Detect a job extension after expiry
    Given a canonical job record had expiry date yesterday
    And the job has been re-scanned after expiry
    When the source page still lists the job with a new closing date
    Then the system must update the canonical record's expiry date to the new closing date
    And the job must remain active (not marked expired) in search results

  Scenario: Mark a job as expired when no longer found
    Given a canonical job record has passed its expiry date
    And multiple post-expiry re-scans have found the listing absent from the source
    When the final post-expiry re-scan threshold (48 hours after expiry) is reached without the listing reappearing
    Then the system must mark the job record as expired
    And the job must be excluded from default active-job search results

  Scenario: Scrape schedule is configurable without code changes
    Given a source's scrape schedule is stored in the database as a cron expression
    When an administrator updates the cron expression for that source via the Admin CMS
    Then the scheduler must pick up the new schedule on the next polling cycle (within 5 minutes)
    And no application redeployment must be required

  Scenario: Scraping infrastructure is isolated from the web API
    Given the scraper workers are under heavy load processing a large board
    When a user submits a search query through the web API
    Then the web API must respond within its normal latency SLA
    And the scraping workload must not block or degrade web API response times
```

## Related
- NFR: NFR-001 (performance — scraper throughput), NFR-002 (scalability), NFR-003 (reliability — scraper failure handling), NFR-005 (compliance — robots.txt)
- Depends on: none
