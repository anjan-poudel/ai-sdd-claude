# NFR-007: Affiliate Link Auditability

## Metadata
- **Category:** Compliance
- **Priority:** MUST

## Description
Every affiliate link click must be logged with a timestamp, product ID, affiliate network (Viator or GetYourGuide), and an anonymised user identifier. Logs must be retained for a minimum of 24 months and must be queryable for revenue reconciliation against OTA commission statements.

## Acceptance criteria

```gherkin
Feature: Affiliate Link Auditability

  Scenario: Affiliate link click is logged
    Given a user clicks an affiliate link to a Viator product
    When the click is processed
    Then an audit log entry must be created containing: timestamp, product ID, affiliate network name, and anonymised user ID
    And the log entry must be persisted in durable storage

  Scenario: Affiliate click logs are retained for 24 months
    Given an affiliate click log was written 24 months ago
    When a query is run against the audit log store
    Then the log entry must still be retrievable

  Scenario: Affiliate logs support revenue reconciliation
    Given an OTA commission statement covering a given date range
    When audit logs for that date range are queried
    Then all affiliate clicks that occurred during that period must be present in the query results
    And the results must be exportable in CSV or JSON format
```

## Related
- FR: FR-004 (Mixed Free and Paid Content), FR-006 (OTA Affiliate Integration)
