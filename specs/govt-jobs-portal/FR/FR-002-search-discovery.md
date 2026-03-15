# FR-002: Search and Discovery

## Metadata
- **Area:** Search & Discovery
- **Priority:** MUST
- **Source:** constitution.md — Functional Requirements / Search & Discovery

## Description

The system must provide full-text job search powered by ElasticSearch (AWS OpenSearch), supporting keyword search and faceted filtering by government level (federal, state, territory, council), location, classification/grade, salary band, and agency. The system must additionally support semantic (vector) similarity search via a vector database, enabling users to find jobs by meaning rather than exact keywords. Vector embeddings must be computed by a separate batch worker and must not run on the ingestion hot path. The system must support saved searches (persisted per user account) and maintain per-user search history. ElasticSearch is the designated read model; MongoDB is the source of truth.

## Acceptance criteria

```gherkin
Feature: Search and Discovery

  Scenario: Full-text keyword search returns relevant results
    Given at least 1000 active job records are indexed in ElasticSearch
    When a user submits the search query "policy analyst canberra"
    Then the system must return results within 500 ms (p95)
    And results must be ranked by relevance score descending
    And each result must include: job title, agency, location, salary band, closing date

  Scenario: Faceted filter narrows results correctly
    Given active job records exist across multiple states and classification levels
    When a user applies the filter "location: Victoria" and "level: APS 5-6"
    Then all returned results must match both filter conditions
    And the result count displayed must match the actual number of documents returned

  Scenario: Semantic search surfaces conceptually related jobs
    Given a job "Legislative Drafting Officer" is indexed with its description
    When a user performs a semantic search for "legal writing government"
    Then the result set must include "Legislative Drafting Officer"
    And results must appear even if the exact phrase "legal writing" is absent from the job title

  Scenario: Saved search is persisted per user
    Given a logged-in user has set filters "agency: ATO" and "classification: EL1"
    When the user saves the search with the name "ATO EL1 roles"
    Then the search must be stored against the user's account
    And when the user returns to the site and navigates to saved searches
    Then the saved search "ATO EL1 roles" must be listed and re-executable with one click

  Scenario: Search history is maintained per user
    Given a logged-in user has executed three searches in the current session
    When the user navigates to their search history page
    Then the three searches must be listed in reverse chronological order
    And each entry must show the query string and any applied filters

  Scenario: Anonymous user can search without an account
    Given an unauthenticated visitor accesses the portal
    When the visitor submits a keyword search
    Then the system must return results without requiring login
    And no search history must be persisted for anonymous users

  Scenario: ElasticSearch index reflects MongoDB source of truth
    Given a job record is updated in MongoDB (e.g. expiry date extended)
    When the index sync process runs
    Then the corresponding ElasticSearch document must reflect the updated field within 60 seconds
```

## Related
- NFR: NFR-001 (search latency SLA), NFR-002 (concurrent users, job volume)
- Depends on: FR-001 (jobs must be ingested before they can be searched)
