# T-008: Meilisearch POI indexing

## Metadata
- **Group:** [TG-02 — POI Data Layer](index.md)
- **Component:** services/poi, workers/poi-ingest
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** T-005
- **Blocks:** T-019 (search UI)
- **Requirements:** NFR-001, NFR-009

## Description
Configure Meilisearch index settings (searchable attributes, filterable attributes, geo), implement the sync worker that pushes new/updated Attractions to Meilisearch, and write search query helper.

## Acceptance criteria

```gherkin
Feature: Meilisearch POI indexing

  Scenario: Attraction is searchable after upsert
    Given a new attraction is saved to PostgreSQL
    When the Meilisearch sync job runs
    Then the attraction is findable by name search in Meilisearch

  Scenario: Geo-filtered search returns nearby results
    Given 5 attractions with known coordinates
    When a geo search is run for a point within 10km of 2 of them
    Then exactly 2 results are returned
```

## Implementation notes
- Index name: `attractions`
- Searchable: `['name', 'description', 'categories']`
- Filterable: `['categories', 'isFree', 'qualityScore', 'demographicTags.family']`
- Sortable: `['qualityScore', '_geo']`
- Ranking rule: add `_geo` ranking rule for geo-proximity boost.
- BullMQ job: `meilisearch-sync` queue, processed after each upsert.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Index configured via Meilisearch admin API at startup
