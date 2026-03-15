# T-003: ElasticSearch index mapping and migration tooling

## Metadata
- **Group:** [TG-01 — Infrastructure & Project Setup](index.md)
- **Component:** ElasticSearch
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-001](T-001-project-scaffold-and-infra.md)
- **Blocks:** T-016, T-018, T-019
- **Requirements:** [FR-002](../../../../define-requirements.md#fr-002-search-and-discovery), [NFR-001](../../../../define-requirements.md#nfr-001-performance), [NFR-002](../../../../define-requirements.md#nfr-002-scalability)

## Description
Create the `jobs_v1` ElasticSearch index with the full mapping from L2 Section 3 (custom analyzers: `australian_english`, `classification_keyword`, `agency_autocomplete`; all field mappings). Create the `jobs` read alias and `jobs_write` write alias. Implement the `scripts/es-migrate.ts` migration script that creates a new versioned index, runs the Reindex API, and atomically swaps the alias. Record schema version in `es_schema_versions` collection.

## Acceptance criteria

```gherkin
Feature: ElasticSearch index and migration

  Scenario: Index is created with correct analyzer on startup
    Given the ElasticSearch bootstrap script has run
    When the mapping for the jobs_v1 index is retrieved via the ES Mapping API
    Then the title field must use the australian_english analyzer
    And the agency field must use the agency_autocomplete analyzer with agency_search search_analyzer
    And the governmentLevel field must be of type keyword

  Scenario: Read alias points to current index
    Given the jobs_v1 index exists and the jobs alias has been created
    When a query is run against the jobs alias
    Then results must be served from jobs_v1

  Scenario: Zero-downtime migration swaps alias atomically
    Given jobs_v1 contains 100 documents and is live under the jobs alias
    When es-migrate.ts is run to create jobs_v2
    Then queries to the jobs alias must continue to succeed during reindex
    And after migration completes the jobs alias must point to jobs_v2
    And all 100 documents must be present in jobs_v2

  Scenario: es_schema_versions records the active version
    Given migration has completed successfully
    When the es_schema_versions collection is queried for status: "active"
    Then exactly one document must be returned with version: 2 and aliasName: "jobs"
```

## Implementation notes
- Use the ES Aliases API `POST /_aliases` with `actions: [{ remove: ... }, { add: ... }]` for atomic alias swap.
- The write alias `jobs_write` must support dual-write during migration (pointing to both old and new index temporarily).
- `scripts/es-migrate.ts` must accept `--dry-run` flag to print the migration plan without executing.
- Use `ES_MIGRATION_TIMEOUT_MS` (default: 3600000) for the reindex operation.
- The `es_schema_versions` MongoDB update must use `{ w: "majority" }`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Migration script tested against a real OpenSearch instance
- [ ] Alias swap verified to be zero-downtime in integration test
