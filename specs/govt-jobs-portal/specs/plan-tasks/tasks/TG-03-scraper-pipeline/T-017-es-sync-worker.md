# T-017: ES Sync Worker and index alias management

## Metadata
- **Group:** [TG-03 — Scraper Pipeline](index.md)
- **Component:** es-sync-worker ECS service
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-003](../TG-01-infrastructure-and-project-setup/T-003-elasticsearch-index-and-migration.md), [T-004](../TG-01-infrastructure-and-project-setup/T-004-bullmq-queue-setup.md)
- **Blocks:** T-020
- **Requirements:** [FR-002](../../../../define-requirements.md#fr-002-search-and-discovery), [NFR-001](../../../../define-requirements.md#nfr-001-performance)

## Description
Implement the `EsSyncWorker` BullMQ consumer for `es-sync-queue` per L2 §1.6. Each job fetches the full `JobDocument` from MongoDB and upserts it to the ES `jobs_write` alias via the ES Bulk API. Batch mode: flush accumulated jobs in a single ES bulk request when batch reaches `ES_SYNC_CONCURRENCY` or a 5-second timeout. ES sync must complete within 60 seconds of a MongoDB write (NFR-001).

## Acceptance criteria

```gherkin
Feature: ES Sync Worker

  Scenario: Job record syncs to ElasticSearch within 60 seconds
    Given a job record's expiry date is updated in MongoDB
    When 60 seconds have elapsed
    Then the corresponding ElasticSearch document must reflect the updated expiry date
    And the document must be accessible via the jobs alias

  Scenario: ES sync worker retries on ES unavailability
    Given ElasticSearch is unreachable (simulated)
    When an es-sync-queue job is processed
    Then the worker must retry with exponential backoff (up to 5 attempts per L2 §4.1)
    And the job must move to the failed set after exhausting retries

  Scenario: Document deleted in MongoDB is handled gracefully
    Given a job document has been deleted from MongoDB before the sync job runs
    When the es-sync-worker processes the sync job for that jobId
    Then the worker must log a DOCUMENT_NOT_FOUND error at WARN level
    And the BullMQ job must complete successfully (not fail)
    And the ES document must be removed if it still exists
```

## Implementation notes
- Always fetch fresh from MongoDB (do not trust `changedFields` hint for the actual values).
- Use the `jobs_write` alias for all writes (never address versioned index directly).
- Batch flush: collect jobs in an in-memory buffer; flush on batch-full or 5-second idle timeout.
- `DOCUMENT_NOT_FOUND`: attempt `es.delete(jobId)` to remove the stale ES document; log if not found.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] 60-second sync SLA verified by integration test with real MongoDB and OpenSearch
