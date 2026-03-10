# T-010: Route generation service

## Metadata
- **Group:** [TG-03 — Route Generation](index.md)
- **Component:** services/route
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** T-004, T-009
- **Blocks:** T-011, T-012
- **Requirements:** FR-001, FR-002, NFR-001, NFR-002

## Description
Implement `RouteGenerationService.generateItinerary()`: fetch route from Google Maps Directions API, sample stopover points every ~120 minutes drive time, query PostGIS for nearby attractions, and cache in Redis. Core differentiating feature of the platform.

## Acceptance criteria

```gherkin
Feature: Route generation

  Scenario: Generates itinerary with stopovers
    Given origin "Sydney, NSW" and destination "Brisbane, QLD"
    When generateItinerary is called
    Then a route with 2-4 stopover slots is returned
    And each slot has at least 3 ranked POIs
    And the total drive time is approximately 1000 minutes

  Scenario: Cached response returned for identical requests
    Given an itinerary was previously generated for a route
    When the same route is requested again within 1 hour
    Then the response is returned from Redis cache (no Google Maps API call)
    And the response time is under 200ms

  Scenario: Graceful degradation when Google Maps is unavailable
    Given Google Maps API returns a 503 error
    When generateItinerary is called
    Then a 504 error response is returned with message "Route generation unavailable"
    And the error is logged with trace ID
```

## Implementation notes
- Google Maps Directions API: use `@googlemaps/google-maps-services-js`.
- Polyline sampling: decode polyline, partition by accumulated drive-time waypoints.
- Cache key: `route:${hash(origin+destination+partyType)}` — TTL 3600s.
- PostGIS query: use `ST_DWithin` with `geography` type (not `geometry`) for correct km-distance.
- MAX stopovers per route: 6 (performance guard).
- NFR-001: target end-to-end response ≤5s (including Maps API call uncached).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Load test: 10 concurrent requests complete in under 10s (with cache warm)
- [ ] Google Maps API call mocked in unit tests; integration test uses real API (once)
