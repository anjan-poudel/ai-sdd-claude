# T-012: /api/itinerary/generate endpoint

## Metadata
- **Group:** [TG-03 — Route Generation](index.md)
- **Component:** apps/web/app/api/itinerary/generate
- **Agent:** dev
- **Effort:** S
- **Risk:** MEDIUM
- **Depends on:** T-011
- **Blocks:** T-013, T-017
- **Requirements:** FR-001, NFR-001

## Description
Implement the Next.js API route handler for `GET /api/itinerary/generate`. Validates query params via Zod, calls RouteGenerationService, and returns the ItineraryPlan JSON. Handles all error cases.

## Acceptance criteria

```gherkin
Feature: Itinerary generate API

  Scenario: Valid request returns itinerary
    Given a valid request with origin, destination, and partyType
    When GET /api/itinerary/generate is called
    Then a 200 response with ItineraryPlan JSON is returned
    And the response includes at least 1 stopover slot

  Scenario: Missing required params returns 422
    Given a request missing the origin parameter
    When GET /api/itinerary/generate is called
    Then a 422 response with field-level Zod errors is returned

  Scenario: Route service timeout returns 504
    Given the route generation service takes over 5 seconds
    When GET /api/itinerary/generate is called
    Then a 504 response is returned within 6 seconds
```

## Implementation notes
- Zod schema for query params: `{ origin, destination, partyType, adults?, children? }`.
- Set `export const maxDuration = 30` (Vercel function timeout config) to allow for uncached Maps API call.
- Trace ID: inject `x-trace-id` header, propagate to service layer logs.
- No auth required for this endpoint (anonymous itinerary generation allowed).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Integration test using real service (in-process, not HTTP mock)
