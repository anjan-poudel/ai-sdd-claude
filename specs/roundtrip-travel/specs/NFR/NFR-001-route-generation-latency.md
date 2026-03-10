# NFR-001: Route Generation Latency

## Metadata
- **Category:** Performance
- **Priority:** MUST

## Description
The system must generate a complete road trip itinerary (route + stopover suggestions) and return results to the user within 5 seconds for routes up to 1,000 km under normal load (up to 100 concurrent users).

## Acceptance criteria

```gherkin
Feature: Route Generation Latency

  Scenario: Itinerary generated within acceptable time under normal load
    Given the system is under normal load (up to 100 concurrent users)
    When a user submits a road trip request for a route of up to 1,000 km
    Then the system must return the complete itinerary within 5 seconds
    And the response must include at least one stopover suggestion per 2-hour driving segment
```

## Related
- FR: FR-001 (Road Trip Itinerary Builder)
