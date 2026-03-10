# NFR-003: System Availability

## Metadata
- **Category:** Availability
- **Priority:** MUST

## Description
The platform must maintain at least 99.5% uptime measured on a rolling 30-day basis. Planned maintenance windows must not exceed 2 hours per month and must be scheduled outside peak usage hours (6am–10pm local time of the primary market).

## Acceptance criteria

```gherkin
Feature: System Availability

  Scenario: Platform availability meets SLA over a 30-day window
    Given the platform has been operating for 30 days
    When availability is calculated from uptime monitoring data
    Then total downtime must not exceed 3.6 hours (99.5% uptime) over the 30-day period

  Scenario: Planned maintenance is within allowed window
    Given a planned maintenance event is scheduled
    When the maintenance window is defined
    Then it must not exceed 2 hours in duration
    And it must be scheduled outside the 6am–10pm window for the primary market timezone
```

## Related
- FR: FR-001 (Road Trip Itinerary Builder)
