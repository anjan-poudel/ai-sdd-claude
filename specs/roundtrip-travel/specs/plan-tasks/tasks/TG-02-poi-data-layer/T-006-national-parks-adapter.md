# T-006: National Parks AU adapter

## Metadata
- **Group:** [TG-02 — POI Data Layer](index.md)
- **Component:** services/poi/adapters/national-parks-au
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** T-005
- **Blocks:** T-010 (first real POI data)
- **Requirements:** FR-005, NFR-004, NFR-008

## Description
Implement the `NationalParksAUAdapter` that fetches national park GeoJSON from data.gov.au, normalises to `NormalisedAttraction`, and upserts via the ingestion pipeline. Tested against a real API fixture file.

## Acceptance criteria

```gherkin
Feature: National Parks AU adapter

  Scenario: Adapter fetches and normalises parks
    Given a fixture file of data.gov.au national parks GeoJSON
    When the adapter processes the fixture
    Then each park is normalised to a NormalisedAttraction
    And source is "national_parks_au"
    And lat/lon are valid coordinates

  Scenario: Duplicate ingestion is idempotent
    Given a park has already been ingested
    When the same park is ingested again
    Then the attraction is updated, not duplicated
    And lastIngestedAt is updated
```

## Implementation notes
- Test against a real captured fixture from data.gov.au (not a mock schema).
- `@@unique([source, sourceId])` on Attraction — use Prisma upsert.
- Do NOT hardcode the API URL — make it configurable via env var.
- If data.gov.au is unreachable, log warning and exit gracefully (do not throw).
- NFR-008: record `lastIngestedAt` on every upsert.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Integration test uses real fixture file (not mock)
- [ ] Adapter registered in AdapterRegistry
