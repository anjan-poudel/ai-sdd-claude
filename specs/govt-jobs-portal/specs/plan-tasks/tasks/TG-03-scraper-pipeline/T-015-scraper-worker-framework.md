# T-015: Scraper Worker framework (robots.txt, rate limiter, plugin registry)

## Metadata
- **Group:** [TG-03 — Scraper Pipeline](index.md)
- **Component:** scraper-worker ECS service
- **Agent:** dev
- **Effort:** L
- **Risk:** CRITICAL
- **Depends on:** [T-004](../TG-01-infrastructure-and-project-setup/T-004-bullmq-queue-setup.md), [T-013](T-013-ingest-service.md)
- **Blocks:** T-016
- **Requirements:** [FR-001](../../../../define-requirements.md#fr-001-job-aggregation), [NFR-003](../../../../define-requirements.md#nfr-003-reliability), [NFR-005](../../../../define-requirements.md#nfr-005-compliance)

## Description
Implement the Scraper Worker BullMQ consumer for `scrape-queue`. Implements the `ScraperPlugin` interface, `RobotsChecker` (LRU cache, 500 entries, 1-hour TTL), `RateLimiter` (per-domain token bucket, configurable `minIntervalMs`), and the plugin registry keyed on `pluginId`. Per L2 §5, every plugin receives a `ScraperPluginContext` with injected logger, rate limiter, robots checker, HTTP client, and optional Playwright browser context. robots.txt must be checked before every HTTP request; violations must return `ROBOTS_DISALLOWED` error and stop the request.

## Acceptance criteria

```gherkin
Feature: Scraper Worker framework

  Scenario: Robots.txt disallow rule prevents request
    Given a source's robots.txt disallows "/jobs/*" for all user agents
    When a scraper plugin attempts to fetch a URL under "/jobs/"
    Then the RobotsChecker must return { allowed: false }
    And the plugin must NOT make the HTTP request
    And a ScraperWorkerError with code ROBOTS_DISALLOWED must be returned
    And the disallow reason must be logged

  Scenario: Crawl-delay directive is respected
    Given a source's robots.txt specifies "Crawl-delay: 5"
    When the scraper processes multiple pages on that domain in sequence
    Then the interval between consecutive requests must be at least 5000ms

  Scenario: Default crawl delay applies when robots.txt has no directive
    Given a source's robots.txt has no Crawl-delay
    When the scraper processes multiple pages on that domain
    Then the interval between consecutive requests must be at least SCRAPER_DEFAULT_CRAWL_DELAY_MS (2000ms)

  Scenario: robots.txt is cached per domain
    Given the RobotsChecker cache contains the result for "example.gov.au"
    When a second request is made to a different URL on "example.gov.au"
    Then the robots.txt must be served from cache (no HTTP fetch)
    And the cache entry must expire after ROBOTS_CACHE_TTL_SECONDS (3600s)

  Scenario: Single scraper failure does not cascade to other sources
    Given source A is configured to fail on every attempt (simulated)
    When the scheduler dispatches jobs for sources A, B, and C
    Then source A jobs must fail and be retried with exponential backoff
    And source B and C scrapes must complete successfully

  Scenario: User-Agent identifies the bot
    Given a scraper plugin makes an HTTP request to any source
    When the request is sent
    Then the User-Agent header must equal SCRAPER_USER_AGENT (GovJobsPortalBot/1.0 ...)
```

## Implementation notes
- robots.txt LRU cache: use `lru-cache` package with `max: 500` and `ttl: ROBOTS_CACHE_TTL_SECONDS * 1000`.
- Rate limiter: per-domain `lastRequestTime` map in worker process memory (not Redis).
- The Playwright browser context must be created once per BullMQ worker and shared across jobs (browser pool).
- The scraper-worker must update `scraper_runs.status`, `completedAt`, and `durationMs` after each job completes or fails.
- Per-source failure must not terminate the worker process; use BullMQ job failure callbacks.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] robots.txt compliance tested with a fixture capturing a real robots.txt response
- [ ] Rate limiter timing tested with a mock clock
- [ ] Plugin registry loads all registered plugins at startup
