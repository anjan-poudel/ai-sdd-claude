# FR-005: POI Indexing and Data Ingestion

## Metadata
- **Area:** Data Ingestion
- **Priority:** MUST
- **Source:** Constitution — "POI indexing: aggregate Points of Interest from government sources, open data (OpenStreetMap / Google-led consortia), and scraped sources"

## Description
The system must maintain a continuously updated index of Points of Interest (POIs) aggregated from multiple sources: government datasets (national parks, rest areas, playgrounds), open data consortia (OpenStreetMap, Google Places), and scraped sources. The data layer must be replaceable without vendor lock-in.

## Acceptance criteria

```gherkin
Feature: POI Indexing

  Scenario: Government POI data is ingested
    Given a government data source provides a feed of rest areas and national parks
    When the ingestion pipeline runs
    Then all POIs from the feed must be indexed in the system
    And each POI must be tagged with its source and category

  Scenario: Open data source POI is deduplicated against existing records
    Given the same physical location exists in both OpenStreetMap and a government dataset
    When both datasets are ingested
    Then the system must create a single deduplicated POI record
    And the record must reference both source identifiers

  Scenario: Scraped POI data is ingested with error handling
    Given a scraping job for a third-party source runs
    When the scraper encounters malformed or partial data
    Then the ingestion pipeline must log the error and skip the malformed record
    And the successfully scraped records must still be indexed
```

## Related
- NFR: NFR-002 (Geospatial accuracy), NFR-004 (Data vendor independence), NFR-008 (Data freshness)
- Depends on: None
