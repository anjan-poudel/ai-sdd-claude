# T-022: Semantic vector search and hybrid mode

## Metadata
- **Group:** [TG-04 — Search & Discovery](index.md)
- **Component:** api ECS service — semantic search
- **Agent:** dev
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** [T-018](../TG-03-scraper-pipeline/T-018-vector-embedding-worker.md), [T-021](T-021-keyword-search-and-job-detail.md)
- **Blocks:** T-031
- **Requirements:** [FR-002](../../../../define-requirements.md#fr-002-search-and-discovery), [NFR-001](../../../../define-requirements.md#nfr-001-performance)

## Description
Implement semantic search mode (`mode=semantic`) and hybrid mode (`mode=hybrid`) for `GET /api/jobs/search` per L2 §8.2. When mode=semantic: embed query text via `EmbeddingModel`, query `VectorDbAdapter.querySimilar`, extract job IDs, enrich from ES with facet filters. Hybrid: merge vector similarity scores with ES relevance for re-ranking. If vector DB call exceeds `VECTOR_QUERY_TIMEOUT_MS` (3000ms), fall back to keyword search and set `searchMode: "degraded_keyword"`.

## Acceptance criteria

```gherkin
Feature: Semantic vector search

  Scenario: Semantic search surfaces conceptually related jobs
    Given "Legislative Drafting Officer" is indexed with embedding computed
    When GET /api/jobs/search?q=legal+writing+government&mode=semantic is called
    Then the result set must include "Legislative Drafting Officer"
    And the exact phrase "legal writing" need not appear in the job title for it to match

  Scenario: Semantic search completes within 500ms p95
    Given 100,000 jobs are in the vector database
    And the embedding API responds within 100ms
    And the vector DB responds within 100ms
    When GET /api/jobs/search?mode=semantic is called with a typical query
    Then the p95 total response time must be less than 500ms

  Scenario: Vector DB timeout falls back to keyword search
    Given VECTOR_QUERY_TIMEOUT_MS is set to 100ms
    And the vector DB is configured to respond slowly (simulated)
    When GET /api/jobs/search?mode=semantic is called
    Then HTTP 200 must be returned with keyword search results
    And searchMode in the response must be "degraded_keyword"
    And a WARN-level log must record the vector DB fallback

  Scenario: Hybrid mode merges vector and ES scores
    Given mode=hybrid is requested
    When the search processes
    Then both ES relevance scores and vector similarity scores must be combined for result ranking
    And jobs with high scores in both systems must rank higher than those with high scores in only one
```

## Implementation notes
- Latency budget: embedding ≤ 100ms, vector DB ≤ 100ms, ES enrichment ≤ 200ms, overhead ≤ 100ms (per L2 §8.2).
- Vector fallback: `Promise.race([vectorQuery, timeout(VECTOR_QUERY_TIMEOUT_MS)])`.
- Hybrid re-ranking: `combinedScore = α * esScore + (1-α) * vectorScore` where `α = 0.5` (configurable via `SEARCH_HYBRID_WEIGHT`).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Timeout fallback tested by injecting a slow vector DB mock
- [ ] Semantic relevance test: verify conceptually related job surfaces in results
