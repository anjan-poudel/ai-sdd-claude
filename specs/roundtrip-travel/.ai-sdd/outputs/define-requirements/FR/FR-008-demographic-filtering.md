# FR-008: Demographic-Based Filtering

## Metadata
- **Area:** Discovery & Personalisation
- **Priority:** MUST
- **Source:** Constitution — "free content, highly tailored local attractions and things-to-do, filterable by demographics (family, singles, age groups, children's needs)"

## Description
The system must allow users to filter all attraction and content listings by demographic criteria, including: family with children (with sub-options for age ranges), singles, adults-only, accessibility needs, and age group. Filters must be persistable within the user's profile.

## Acceptance criteria

```gherkin
Feature: Demographic-Based Filtering

  Scenario: User filters by family with young children
    Given a user is browsing an attraction list for a destination
    When the user selects "Family — children under 5" as their demographic filter
    Then the system must return only attractions tagged as suitable for children under 5
    And must highlight facilities such as playgrounds, baby change rooms, and enclosed areas

  Scenario: User saves demographic filter to profile
    Given a logged-in user has set a demographic filter to "Family — children aged 5-12"
    When the user returns to the platform in a new session
    Then the saved demographic filter must be pre-applied to their browsing

  Scenario: No matching attractions for demographic filter
    Given a user has applied a highly specific demographic filter
    When no attractions match the selected criteria
    Then the system must display a "no results" message with an option to broaden the filter
```

## Related
- NFR: NFR-005 (Data privacy)
- Depends on: FR-003 (User Profile), FR-005 (POI Indexing)
