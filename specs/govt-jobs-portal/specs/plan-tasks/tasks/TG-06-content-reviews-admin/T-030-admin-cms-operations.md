# T-030: Admin CMS operations (scraper config, job curation, health dashboard)

## Metadata
- **Group:** [TG-06 — Content, Reviews & Admin CMS](index.md)
- **Component:** api ECS service — admin routes
- **Agent:** dev
- **Effort:** L
- **Risk:** MEDIUM
- **Depends on:** [T-020](../TG-04-search-and-discovery/T-020-web-api-middleware-stack.md), [T-013](../TG-03-scraper-pipeline/T-013-ingest-service.md), [T-014](../TG-03-scraper-pipeline/T-014-scraper-scheduler.md)
- **Blocks:** —
- **Requirements:** [FR-008](../../../../define-requirements.md#fr-008-admin-cms-and-operations), [NFR-006](../../../../define-requirements.md#nfr-006-observability)

## Description
Implement admin-only endpoints for: scraper source management (`GET`, `POST`, `PATCH`, `DELETE /api/admin/scraper-sources`), job curation (`POST /api/admin/jobs/:id/force-expire`, `PATCH /api/admin/jobs/:id`), and the scraper health dashboard (`GET /api/admin/scraper-health`). Dashboard data: last run time, status, job counts, next scheduled run per source (max 5 minutes stale, cached in Redis). All endpoints require admin JWT + admin DB double-check.

## Acceptance criteria

```gherkin
Feature: Admin CMS operations

  Scenario: Admin adds a new scraper source without redeployment
    Given a logged-in admin
    When POST /api/admin/scraper-sources is called with { name, url, type, pluginId, cronExpression, enabled: true }
    Then HTTP 201 must be returned
    And the source must be persisted in the sources collection
    And the scheduler must include it in the next polling cycle (within 5 minutes)
    And no application redeployment must be required

  Scenario: Admin disables a scraper source
    Given an active scraper source
    When PATCH /api/admin/scraper-sources/:id is called with { enabled: false }
    Then the source must have enabled: false in the database
    And the scheduler must not enqueue any further jobs for that source

  Scenario: Admin force-expires a stale job
    Given a job listing is incorrectly showing as active
    When POST /api/admin/jobs/:id/force-expire is called
    Then jobs.status must be set to "admin_expired"
    And an es-sync-queue job must be enqueued
    And the job must be removed from active search results within 60 seconds

  Scenario: Admin-only endpoints return 403 for regular users
    Given a logged-in user with role "user"
    When GET /api/admin/scraper-sources is called
    Then HTTP 403 must be returned

  Scenario: Scraper health dashboard data is no more than 5 minutes stale
    Given the last scraper run for source "APSJobs" completed 3 minutes ago
    When GET /api/admin/scraper-health is called
    Then the response must include APSJobs with its last run time, status, job count, and next scheduled run
    And the data must be no more than 5 minutes old
```

## Implementation notes
- Health dashboard: aggregate recent `scraper_runs` per `sourceId` with `lastRunAt`, `lastRunStatus`, `listingsNew`, `nextRunAt`. Cache result in Redis with TTL = 300 seconds (5 minutes).
- Cron expression validation: use `cron-parser.parseExpression(expression)` and catch errors before saving.
- `force-expire`: update `jobs.status = "admin_expired"` AND enqueue `es-sync-queue` job in a single transaction.
- Admin double-check required on ALL admin endpoints.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Scheduler pickup of new source tested (add source → wait polling cycle → verify enqueue)
- [ ] Force-expire ES sync verified within 60 seconds
- [ ] Dashboard cache stale-at-5-minutes test
