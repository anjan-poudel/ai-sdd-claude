# NFR-008: POI Data Freshness

## Metadata
- **Category:** Reliability
- **Priority:** SHOULD

## Description
The POI index must be refreshed from all active data sources at least once every 7 days. Government data sources that provide real-time or daily feeds must be ingested within 24 hours of publication. The system must surface the data ingestion timestamp on each POI record to allow data freshness to be audited.

## Acceptance criteria

```gherkin
Feature: POI Data Freshness

  Scenario: POI data is refreshed on schedule
    Given the data ingestion pipeline is configured
    When 7 days have elapsed since the last full refresh
    Then the system must have initiated and completed a refresh from all active sources

  Scenario: Government daily feed is ingested within 24 hours
    Given a government data source publishes a daily update at midnight
    When 24 hours have elapsed since publication
    Then the updated records must be reflected in the POI index

  Scenario: POI record shows data freshness timestamp
    Given a user or API client queries a POI record
    When the response is returned
    Then the response must include a last_updated_at timestamp indicating when the record was last refreshed
```

## Related
- FR: FR-005 (POI Indexing), FR-004 (Mixed Free and Paid Content)
