# FR-002: Stopover Intelligence

## Metadata
- **Area:** Itinerary Planning
- **Priority:** MUST
- **Source:** Constitution — "Stopover intelligence: surface towns, natural attractions, rest areas, playgrounds, parent rooms, and toilets calibrated to party demographics"

## Description
The system must surface contextually relevant stopover options calibrated to the travel party's demographics. For families with children, stopovers must include locations with playgrounds, toilets, and parent/baby rooms. For all parties, stopovers must include towns, natural attractions, and rest areas.

## Acceptance criteria

```gherkin
Feature: Stopover Intelligence

  Scenario: Family with young children requests stopover suggestions
    Given a road trip itinerary is being generated for a party including children under 12
    When the system generates stopover options
    Then each suggested stopover must include at least one location tagged with playground or toilet facilities
    And stopovers must be spaced no more than 2 hours driving time apart

  Scenario: Adult-only party requests stopover suggestions
    Given a road trip itinerary is being generated for an adult-only party
    When the system generates stopover options
    Then the system must return stopovers with towns, natural attractions, and rest areas
    And playground-specific filtering must not be applied unless requested

  Scenario: Travel party demographic changes after itinerary generation
    Given a user has an existing itinerary for an adult-only party
    When the user updates the party to include children
    Then the system must regenerate stopover suggestions appropriate for families
```

## Related
- NFR: NFR-001 (Route generation latency), NFR-002 (Geospatial accuracy)
- Depends on: FR-001 (Road Trip Itinerary Builder), FR-005 (POI Indexing)
