# NFR-004: POI Data Vendor Independence

## Metadata
- **Category:** Reliability
- **Priority:** MUST

## Description
The POI data ingestion layer must be implemented through an abstracted adapter interface such that any single data source can be replaced or removed without requiring changes to the core platform code. No vendor-specific data model or SDK must be used directly in the core domain.

## Acceptance criteria

```gherkin
Feature: POI Data Vendor Independence

  Scenario: A data source adapter is replaced without core code changes
    Given the platform uses a specific government data source via an adapter
    When that data source is replaced with a new provider
    Then only the adapter implementation must change
    And the core POI indexing, querying, and display logic must require zero code modifications

  Scenario: A data source is removed without breaking the platform
    Given the platform indexes data from three sources (government, OpenStreetMap, scraped)
    When one source is disabled
    Then the platform must continue to operate using the remaining sources
    And no errors or exceptions must propagate to the user
```

## Related
- FR: FR-005 (POI Indexing)
