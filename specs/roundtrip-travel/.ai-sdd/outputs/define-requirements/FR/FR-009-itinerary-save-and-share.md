# FR-009: Itinerary Save and Share

## Metadata
- **Area:** Itinerary Planning
- **Priority:** SHOULD
- **Source:** Constitution — "Itinerary: A user-generated road trip plan: route, stopovers, attraction/product slots"

## Description
The system must allow authenticated users to save generated itineraries to their profile. Users must also be able to share itineraries via a public link, allowing non-registered users to view (but not edit) a shared itinerary.

## Acceptance criteria

```gherkin
Feature: Itinerary Save and Share

  Scenario: Logged-in user saves a generated itinerary
    Given a user has generated a road trip itinerary
    When the user clicks "Save to my trips"
    Then the itinerary must be saved to the user's profile
    And it must be accessible from their saved itineraries list

  Scenario: User shares an itinerary via a public link
    Given a user has a saved itinerary
    When the user clicks "Share"
    Then the system must generate a unique, shareable URL for the itinerary
    And a non-logged-in user who visits the link must be able to view the itinerary
    And the non-logged-in user must not be able to edit or delete the itinerary

  Scenario: User deletes a saved itinerary
    Given a user has a saved itinerary
    When the user deletes the itinerary
    Then the itinerary must be removed from their profile
    And the shared link must return a "not found" response
```

## Related
- NFR: NFR-005 (Data privacy)
- Depends on: FR-001 (Road Trip Itinerary Builder), FR-003 (User Profile)
