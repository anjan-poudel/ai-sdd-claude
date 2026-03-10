# T-011: Demographic scoring and stopover filtering

## Metadata
- **Group:** [TG-03 — Route Generation](index.md)
- **Component:** services/route
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** T-010
- **Blocks:** T-012
- **Requirements:** FR-002, FR-008

## Description
Implement `applyDemographicFilter()` and `scoreAttractionForParty()` functions used by the route generation service to rank stopovers based on party demographics (family/children vs couple vs solo).

## Acceptance criteria

```gherkin
Feature: Demographic scoring

  Scenario: Family with children prefers playgrounds and toilets
    Given a list of 10 attractions including 2 playgrounds and 3 generic attractions
    And the party is family with 2 children aged 3 and 6
    When scoreAttractionForParty is called for each attraction
    Then the 2 playgrounds have the highest scores
    And attractions with demographicTags.toilet = true score higher than those without

  Scenario: Solo traveller prefers bookable products
    Given a list of attractions mixing free and bookable
    And the party is solo adult
    When scoreAttractionForParty is called
    Then attractions with bookable products score higher than free-only attractions
```

## Implementation notes
- Pure functions — no side effects, no DB calls, no async.
- `applyDemographicFilter`: removes attractions entirely inappropriate for party (e.g. age 18+ attractions for family with under-18s).
- `scoreAttractionForParty`: weighted scoring as per L2 design (quality 40%, family tags 30%, distance 15%, free content 15%).
- Unit tests only — no integration required.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Pure function — 100% unit test coverage
