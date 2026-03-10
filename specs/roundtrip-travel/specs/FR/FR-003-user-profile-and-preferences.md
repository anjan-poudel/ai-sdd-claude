# FR-003: User Profile and Preferences

## Metadata
- **Area:** User Management
- **Priority:** MUST
- **Source:** Constitution — "personalised user profile that learns traveller preferences over time"; requirements.md — "The site can remember a user profile"

## Description
The system must allow users to create and maintain a profile that stores their travel party demographics, preferences, and past itineraries. The profile must be used to personalise content recommendations and reduce repeated data entry across sessions.

## Acceptance criteria

```gherkin
Feature: User Profile and Preferences

  Scenario: User creates a profile
    Given an anonymous user accesses the platform
    When the user registers and provides demographic information (party size, age groups, interests)
    Then the system must persist this profile
    And subsequent itinerary requests must default to the saved party configuration

  Scenario: User views past itineraries from their profile
    Given a logged-in user with one or more previously saved itineraries
    When the user navigates to their profile
    Then the system must display a list of past itineraries
    And each itinerary must be accessible for viewing and re-use

  Scenario: Profile preferences influence content surfacing
    Given a user profile that records a preference for family-friendly attractions
    When the user browses destination or attraction pages
    Then family-friendly content must be ranked or highlighted above non-family content
```

## Related
- NFR: NFR-005 (Data privacy), NFR-006 (Authentication security)
- Depends on: None
