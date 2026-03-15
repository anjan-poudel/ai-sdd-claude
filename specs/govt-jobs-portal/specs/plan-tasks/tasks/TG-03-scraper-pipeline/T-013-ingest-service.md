# T-013: Ingest Service (dedup, upsert, queue publish)

## Metadata
- **Group:** [TG-03 — Scraper Pipeline](index.md)
- **Component:** Ingest Service (internal HTTP server)
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** [T-002](../TG-01-infrastructure-and-project-setup/T-002-mongodb-schemas-and-indexes.md), [T-004](../TG-01-infrastructure-and-project-setup/T-004-bullmq-queue-setup.md)
- **Blocks:** T-014, T-015, T-017, T-018, T-024
- **Requirements:** [FR-001](../../../../define-requirements.md#fr-001-job-aggregation), [NFR-001](../../../../define-requirements.md#nfr-001-performance), [NFR-002](../../../../define-requirements.md#nfr-002-scalability)

## Description
Implement `POST /internal/ingest` per L2 §1.3. The endpoint accepts a batch of up to 500 `RawJobInput` objects, deduplicates each against existing records using SHA-256 composite key + secondary Levenshtein fuzzy match, upserts canonical `JobDocument` records in MongoDB, and atomically publishes to `es-sync-queue`, `notification-queue` (for new/changed jobs), and `vector-queue` (for new descriptions). All three BullMQ publishes must occur within the same logical operation to maintain consistency.

## Acceptance criteria

```gherkin
Feature: Ingest Service deduplication and upsert

  Scenario: New job is created on first ingest
    Given no job record exists with the deduplication key for "Senior Policy Officer | Dept Finance | Canberra | APS 6"
    When POST /internal/ingest is called with that job
    Then HTTP 200 must be returned with action: "created"
    And a JobDocument must exist in the jobs collection with the correct deduplicationKey
    And an es-sync-queue job must have been enqueued for the new jobId
    And a notification-queue job must have been enqueued with isNew: true

  Scenario: Duplicate job from second source is not duplicated
    Given a job record already exists for "Senior Policy Officer | Dept Finance | Canberra | APS 6" from source A
    When POST /internal/ingest submits the same job from source B
    Then HTTP 200 must be returned with action: "updated"
    And only one JobDocument must exist (no new document created)
    And the job's sources array must now contain both source A and source B entries

  Scenario: Batch size exceeding 500 is rejected
    Given an ingest request with 501 job objects
    When POST /internal/ingest is called
    Then HTTP 400 must be returned with error code BATCH_TOO_LARGE

  Scenario: Ingest throughput meets NFR-001 target
    Given a batch of 500 jobs is submitted to POST /internal/ingest
    When the operation completes
    Then the response time must be less than 60000ms
    And the processed count in the response must equal 500

  Scenario: All three queues are published atomically
    Given a new valid job is submitted
    When ingest processes it successfully
    Then es-sync-queue, notification-queue, and vector-queue must each have exactly one job enqueued for that jobId
    And if any queue publish fails, the MongoDB upsert must also be rolled back
```

## Implementation notes
- Deduplication key: `sha256(normalise(agency) + "|" + normalise(title) + "|" + normalise(location) + "|" + normalise(classification))`.
- Secondary fuzzy match: Levenshtein distance ≤ 2 on key components via MongoDB text index lookup before write.
- Use MongoDB transactions (`session.startTransaction()`) for the upsert + BullMQ publish pair; BullMQ publish should use a `BulkJobsOptions` call within the session.
- `scraper_runs` document must be pre-created by the Scheduler before the scraper worker sends the ingest request.
- The Ingest Service is internal-only: bind to `0.0.0.0:3001` but do not expose on public ALB security group.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Deduplication accuracy tested against a 100-item known-duplicate test dataset (>99% accuracy)
- [ ] All three queue publishes verified by integration test
- [ ] Transaction rollback tested by simulating queue publish failure
