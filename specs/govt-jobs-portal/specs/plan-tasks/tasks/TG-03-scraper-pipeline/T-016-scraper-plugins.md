# T-016: Scraper plugins (APSJobs, NSW, VIC, QLD, generic)

## Metadata
- **Group:** [TG-03 — Scraper Pipeline](index.md)
- **Component:** scraper-worker / plugin implementations
- **Agent:** dev
- **Effort:** XL
- **Risk:** HIGH
- **Depends on:** [T-015](T-015-scraper-worker-framework.md)
- **Blocks:** —
- **Requirements:** [FR-001](../../../../define-requirements.md#fr-001-job-aggregation), [NFR-005](../../../../define-requirements.md#nfr-005-compliance)

## Description
Implement the 7 built-in scraper plugins from L2 §5.4: `apsjobs-api` (REST JSON), `nsw-public-service-api` (REST JSON), `vic-careers-scrape` (Playwright), `qld-smartjobs-scrape` (Playwright), `seek-government-scrape` (Playwright), `generic-html-scrape` (Playwright, configurable CSS selectors), and `generic-json-api` (REST JSON, configurable endpoint + field mapping). LinkedIn and Glassdoor plugins are delivered disabled by default. Each plugin must implement `ScraperPlugin` and pass a contract test that validates output structure.

## Acceptance criteria

```gherkin
Feature: Scraper plugins

  Scenario: APSJobs API plugin fetches and maps job listings
    Given the apsjobs-api plugin is registered and a mock APSJobs REST endpoint is configured
    When fetchJobs is called with a valid SourcePluginConfig
    Then an array of RawJobInput objects must be returned
    And each object must have required fields: title, agency, location, classification, sourceId, sourceUrl, sourceType

  Scenario: Playwright plugin extracts jobs from a simulated government board
    Given the generic-html-scrape plugin is configured with CSS selectors for a mock government jobs page
    When fetchJobs is called
    Then all job listings on the mock page must be extracted
    And each listing must be mapped to a RawJobInput with correct field values

  Scenario: Plugin validateConfig rejects missing required fields
    Given the apsjobs-api plugin's validateConfig is called with a config missing the "endpoint" field
    When validateConfig runs
    Then it must return a non-null string describing the missing field

  Scenario: LinkedIn plugin is disabled by default
    Given the linkedin-jobs-scrape plugin is registered
    When the Scheduler queries for enabled sources
    Then no source with pluginId "linkedin-jobs-scrape" must be enabled in the default seed data
    And the plugin code must exist but must not be invoked without explicit admin enablement

  Scenario: Scraper throughput meets 500 listings per minute
    Given 10 scraper worker ECS tasks are running
    When a bulk scrape of a mock large board with 5000 listings is triggered
    Then all 5000 listings must be ingested within 10 minutes
```

## Implementation notes
- Each plugin is a TypeScript class implementing `ScraperPlugin`; exported from `packages/scraper-worker/src/plugins/<pluginId>.ts`.
- LinkedIn (`linkedin-jobs-scrape`) and Glassdoor (`glassdoor-reviews-scrape`) must have `enabled: false` in their default seed source documents.
- Contract test fixture: a JSON file in `tests/fixtures/<pluginId>-response.json` capturing a real API response (or a representative mock).
- For Playwright plugins, use `page.waitForSelector()` with a configurable timeout to handle dynamic page loading.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Each plugin has at least one contract test against a real-format fixture
- [ ] LinkedIn and Glassdoor plugins confirmed disabled in default seed
- [ ] Throughput test run against a mock board with 5000 listings
