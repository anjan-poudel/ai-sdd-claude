# T-009: POI quality score computation

## Metadata
- **Group:** [TG-02 — POI Data Layer](index.md)
- **Component:** services/poi
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** T-005
- **Blocks:** T-010 (used in ranking)
- **Requirements:** NFR-011

## Description
Implement `computeQualityScore(attraction)` function that scores each attraction 0.0–1.0 based on required field completeness (60%) and enrichment fields (40%). Apply on every upsert.

## Acceptance criteria

```gherkin
Feature: POI quality scoring

  Scenario: Fully enriched attraction scores 1.0
    Given an attraction with name, lat, lon, description, openingHours, toilet, parking, accessibility
    When computeQualityScore is called
    Then the score is 1.0

  Scenario: Minimal attraction scores below 0.6
    Given an attraction with only name and coordinates (no description, no enrichment)
    When computeQualityScore is called
    Then the score is 0.6 (required fields: 4/4 * 0.6 = 0.6; enrichment: 0/4 * 0.4 = 0)

  Scenario: Quality score is saved on upsert
    Given an attraction is ingested
    When the attraction is retrieved from the database
    Then the qualityScore field matches the computed score
```

## Implementation notes
- Required fields (60%): name, lat, lon, description (each 15%).
- Enrichment fields (40%): openingHours, toilet, parking, accessibility (each 10%).
- Score range: 0.0–1.0 (clamped).
- Used in route generation scoring (`scoreAttractionForParty`).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Score persisted to `Attraction.qualityScore` on every ingestion
