# T-007: OpenStreetMap/Overpass adapter

## Metadata
- **Group:** [TG-02 — POI Data Layer](index.md)
- **Component:** services/poi/adapters/osm
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** T-005
- **Blocks:** —
- **Requirements:** FR-005, NFR-004, NFR-008

## Description
Implement the `OpenStreetMapAdapter` that queries the Overpass API for playgrounds, rest areas, and tourism attractions within Australia's bounding box. Normalises OSM tags to `NormalisedAttraction` with correct demographic tags.

## Acceptance criteria

```gherkin
Feature: OpenStreetMap adapter

  Scenario: Adapter fetches playgrounds and rest areas
    Given a fixture of Overpass API response for AU bounding box
    When the adapter processes the fixture
    Then playground nodes have demographicTags.playground = true
    And amenity=toilets nodes have demographicTags.toilet = true
    And all coordinates are within the AU bounding box

  Scenario: Overpass rate limiting is handled
    Given the Overpass API returns 429 Too Many Requests
    When the adapter encounters the 429
    Then it retries after a backoff delay
    And logs a warning with retry count
```

## Implementation notes
- Overpass query: `[out:json]; (node["leisure"="playground"](AU_BBOX); node["amenity"="toilets"](AU_BBOX); node["tourism"~"attraction|museum"](AU_BBOX);); out;`
- AU bounding box: south=-44.0, west=112.0, north=-10.5, east=154.0
- Rate limit handling: exponential backoff (1s, 2s, 4s, max 3 retries).
- Test against a real captured fixture from overpass-api.de.
- `source = "osm"`, `sourceId = "osm:" + element.id`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Integration test uses real Overpass fixture file
- [ ] Adapter registered in AdapterRegistry
