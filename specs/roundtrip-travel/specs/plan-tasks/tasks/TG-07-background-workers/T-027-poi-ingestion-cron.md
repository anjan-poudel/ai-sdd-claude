# T-027: POI ingestion Spring Batch job

## Metadata
- **Group:** [TG-07 — Background Workers](index.md)
- **Component:** backend/src/main/kotlin/com/roadtrip/batch
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** T-026, T-006, T-007
- **Blocks:** —
- **Requirements:** FR-005, NFR-008

## Description
Implement `PoiIngestionJob` as a Spring Batch job. The job runs all registered `PoiSourceAdapter` beans as independent steps, upserts results to PostgreSQL via JPA, and triggers Meilisearch sync. Job execution is triggered daily at 03:00 AEST via `@Scheduled`.

## Acceptance criteria

```gherkin
Feature: POI ingestion Spring Batch job

  Scenario: Daily ingestion runs all adapter steps
    Given 2 adapters are registered (national_parks_au, osm)
    When the PoiIngestionJob executes
    Then both adapter steps execute
    And upserted attractions have last_ingested_at updated to today
    And the BATCH_JOB_EXECUTION record shows status COMPLETED

  Scenario: Adapter step failure does not abort other steps
    Given the osm adapter step throws an exception
    When the PoiIngestionJob runs
    Then the national_parks_au step still completes
    And the failed step is recorded in BATCH_STEP_EXECUTION with status FAILED
    And the job completes with status COMPLETED (with skip count > 0)

  Scenario: Stale POI warning is logged
    Given an attraction whose last_ingested_at is 8 days ago
    When the ingestion job runs
    Then a WARNING log entry is emitted: "POI [id] not refreshed in 8 days"
```

## Implementation notes
- **Job structure:** One `Step` per adapter, using `ItemReader` (wraps `PoiSourceAdapter.fetchUpdates()`), `ItemProcessor` (normalise + quality score), `ItemWriter` (JPA upsert on `(source, source_id)`).
- **Skip policy:** `SkipPolicy` configured to skip malformed/invalid items and log them — a bad record does not abort the step.
- **Meilisearch sync:** After each writer chunk commits, publish domain events caught by `MeilisearchSyncListener` (Spring `@EventListener`). Async via `@Async`.
- **Staleness check:** `@Scheduled` companion method runs after ingestion to query `WHERE last_ingested_at < NOW() - INTERVAL '7 days'` and emit warnings.
- NFR-008: `last_ingested_at` updated on every upsert.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests (`@SpringBatchTest`)
- [ ] Integration test: job runs with real fixture data (H2 + embedded Meilisearch mock)
- [ ] Staleness detection tested
