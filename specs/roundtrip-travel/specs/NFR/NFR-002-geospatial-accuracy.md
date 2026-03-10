# NFR-002: Geospatial Accuracy

## Metadata
- **Category:** Reliability
- **Priority:** MUST

## Description
POI locations indexed by the system must have a position accuracy of within 100 metres of the actual physical location. Route segment driving times must be accurate to within ±15% of real-world driving time under normal traffic conditions.

## Acceptance criteria

```gherkin
Feature: Geospatial Accuracy

  Scenario: POI location accuracy is within tolerance
    Given a POI is indexed in the system with a latitude/longitude coordinate
    When the coordinate is compared to the known ground-truth position of the POI
    Then the distance between the indexed position and ground truth must not exceed 100 metres

  Scenario: Route segment driving time is within tolerance
    Given a route segment between two stopovers
    When the system calculates the estimated driving time for that segment
    Then the estimated time must be within ±15% of actual driving time under normal traffic conditions
```

## Related
- FR: FR-001 (Road Trip Itinerary Builder), FR-002 (Stopover Intelligence), FR-005 (POI Indexing)
