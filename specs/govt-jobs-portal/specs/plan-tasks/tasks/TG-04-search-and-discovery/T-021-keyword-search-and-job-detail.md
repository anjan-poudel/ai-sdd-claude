# T-021: Keyword search (ES), faceted filtering, and job detail API

## Metadata
- **Group:** [TG-04 — Search & Discovery](index.md)
- **Component:** api ECS service — search routes
- **Agent:** dev
- **Effort:** L
- **Risk:** MEDIUM
- **Depends on:** [T-017](../TG-03-scraper-pipeline/T-017-es-sync-worker.md), [T-020](T-020-web-api-middleware-stack.md)
- **Blocks:** T-022, T-031
- **Requirements:** [FR-002](../../../../define-requirements.md#fr-002-search-and-discovery), [NFR-001](../../../../define-requirements.md#nfr-001-performance), [NFR-002](../../../../define-requirements.md#nfr-002-scalability)

## Description
Implement `GET /api/jobs/search` (keyword mode) and `GET /api/jobs/:id` per L2 §§9.1, 9.2. Keyword search uses ES `bool/multi_match` across `title^3`, `agency^2`, `classification^1.5`, `descriptionText^1` with `fuzziness: "AUTO:4,8"`. Filter by facets: governmentLevel, state, classification, agency, salary band, status. Return facet buckets. Job detail is fetched from MongoDB (source of truth). Contextual preparation resources surfaced alongside job detail.

## Acceptance criteria

```gherkin
Feature: Keyword search and job detail

  Scenario: Keyword search returns results within 500ms
    Given 50,000 active job records are indexed in ElasticSearch
    And 200 concurrent users are submitting search queries
    When latency is measured across 1000 requests
    Then p95 response time must be less than 500ms

  Scenario: Faceted filter narrows results correctly
    Given jobs exist for multiple states and classification levels
    When a search is made with governmentLevels=federal&states=ACT
    Then all returned results must have governmentLevel: "federal" and state: "ACT"
    And the result count must match the actual ES hit count

  Scenario: Anonymous user can search without login
    Given an unauthenticated visitor makes GET /api/jobs/search?q=policy+analyst
    When the request is processed
    Then HTTP 200 must be returned with search results
    And no login prompt must be returned

  Scenario: Job detail page shows source attribution
    Given a job with two source entries (APSJobs and Seek)
    When GET /api/jobs/:id is called
    Then the response must include both source entries with sourceName, sourceType, and sourceUrl
    And the data must be fetched from MongoDB (not ElasticSearch)

  Scenario: Invalid ObjectId in job detail returns 404
    Given a request is made with id "not-an-objectid"
    When GET /api/jobs/not-an-objectid is called
    Then HTTP 404 must be returned with code NOT_FOUND
```

## Implementation notes
- ElasticSearch query pattern per L2 §3.3: `bool.must` for keyword, `bool.filter` for facets.
- Facet aggregations: use ES `terms` aggregation for `governmentLevel`, `state`, `classification.keyword`, `agency.keyword` (top 20 by count).
- `GET /api/jobs/:id`: always read from MongoDB; include `preparationResources` populated by matching `content` documents with `associatedAgencies` containing the job's agency.
- `isSaved` field: query `saved_jobs` for `{ userId, jobId }` if user is authenticated; `false` for anonymous.
- Degraded mode: if ES throws `SEARCH_UNAVAILABLE` error type, return 503 per middleware error handler.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] p95 latency test run against a 50,000-document ES index
- [ ] Facet accuracy verified by comparing ES aggregation counts with direct DB counts
