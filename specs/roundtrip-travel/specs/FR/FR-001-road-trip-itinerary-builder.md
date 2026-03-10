# FR-001: Road Trip Itinerary Builder

## Metadata
- **Area:** Itinerary Planning
- **Priority:** MUST
- **Source:** Constitution — "Road-trip itinerary builder: given origin, destination, and travel party, generate a recommended route with stopovers every ~2 hours"

## Description
The system must allow a user to enter an origin, destination, and travel party composition, and generate a recommended road trip route with suggested stopover locations spaced approximately every 2 hours of driving time.

## Acceptance criteria

```gherkin
Feature: Road Trip Itinerary Builder

  Scenario: User generates a road trip itinerary
    Given a user has specified an origin location, a destination, and a travel party
    When the user requests a road trip itinerary
    Then the system must return a route with stopover suggestions spaced approximately 2 hours apart
    And each stopover must include at least one suggested attraction or rest area
    And the route must be driveable via standard road network

  Scenario: Itinerary cannot be generated due to invalid origin or destination
    Given a user has entered an unrecognisable or out-of-range location
    When the user requests a road trip itinerary
    Then the system must display a clear error message explaining the issue
    And must prompt the user to correct the input
```

## Related
- NFR: NFR-001 (Route generation latency), NFR-002 (Geospatial accuracy)
- Depends on: FR-002 (Stopover Intelligence), FR-005 (POI Indexing)
