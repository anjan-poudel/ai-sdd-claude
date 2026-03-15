# T-018: Vector Embedding Worker and VectorDbAdapter

## Metadata
- **Group:** [TG-03 — Scraper Pipeline](index.md)
- **Component:** vector-worker ECS service
- **Agent:** dev
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** [T-004](../TG-01-infrastructure-and-project-setup/T-004-bullmq-queue-setup.md), [T-003](../TG-01-infrastructure-and-project-setup/T-003-elasticsearch-index-and-migration.md)
- **Blocks:** T-021
- **Requirements:** [FR-002](../../../../define-requirements.md#fr-002-search-and-discovery), [NFR-001](../../../../define-requirements.md#nfr-001-performance)

## Description
Implement the `VectorWorker` BullMQ consumer for `vector-queue` per L2 §1.7 and §8. Implement the `VectorDbAdapter` interface with Weaviate and Pinecone concrete implementations (selected via `VECTOR_DB_PROVIDER`). Implement `OpenAiEmbeddingModel` and `LocalEmbeddingModel` (ONNX, for testing). Text prepared for embedding: `"${title} ${agency} ${classification} ${location} ${descriptionText}"` truncated to 8000 chars. Update `jobs.embeddingStatus` and `jobs.embeddingComputedAt` on completion.

## Acceptance criteria

```gherkin
Feature: Vector Embedding Worker

  Scenario: New job description is embedded and stored in Weaviate
    Given a vector-queue job exists for a new job with jobId "abc"
    When the vector-worker processes the job
    Then the job text must be embedded via OpenAI text-embedding-3-small
    And the vector must be upserted to Weaviate with jobId, title, agency, classification, location as metadata
    And jobs.embeddingStatus must be updated to "computed"
    And jobs.embeddingComputedAt must be set

  Scenario: Vector adapter is swappable without code changes
    Given VECTOR_DB_PROVIDER is set to "pinecone"
    When the vector-worker starts
    Then the PineconeVectorDbAdapter must be used for all upsert operations
    And no code changes must be required to switch providers

  Scenario: Embedding failure updates job status
    Given the OpenAI API returns an error for a specific job
    When the vector-worker processes the job
    Then jobs.embeddingStatus must be set to "failed"
    And the BullMQ job must be retried per the retry policy (3 attempts)

  Scenario: Mock adapter is used in test environment
    Given VECTOR_DB_PROVIDER is set to "mock"
    When the vector-worker processes a job
    Then no real HTTP call is made to Weaviate or Pinecone
    And the embedding result is stored in memory only
```

## Implementation notes
- `LocalEmbeddingModel` using a tiny ONNX model is activated when `VECTOR_DB_PROVIDER=mock`.
- The `VectorDbAdapter` interface must be registered in a DI container or factory so the correct adapter is instantiated at startup.
- Per L2 §8.3, default is `VECTOR_DB_PROVIDER=weaviate`; Pinecone is a configurable fallback.
- Weaviate class name: `GovJob`. Vector dimension: 1536 for `text-embedding-3-small`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Adapter swap tested by changing VECTOR_DB_PROVIDER and verifying no Weaviate calls
- [ ] embeddingStatus transitions tested: pending → computed, pending → failed
