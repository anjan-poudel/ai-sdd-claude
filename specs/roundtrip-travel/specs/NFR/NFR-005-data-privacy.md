# NFR-005: Data Privacy

## Metadata
- **Category:** Privacy
- **Priority:** MUST

## Description
The system must comply with the Australian Privacy Act 1988 and the Privacy Principles therein. User personally identifiable information (PII) must be stored encrypted at rest and in transit. Users must be able to request deletion of all their personal data within 30 days of submitting the request.

## Acceptance criteria

```gherkin
Feature: Data Privacy

  Scenario: User PII is encrypted at rest
    Given a user has registered and provided personal data (name, email, travel party)
    When the data is stored in the database
    Then all PII fields must be stored using encryption (AES-256 or equivalent)

  Scenario: User requests data deletion
    Given a registered user submits a data deletion request via their account settings
    When 30 days have elapsed since the request was received
    Then all PII associated with the user must be permanently deleted from all systems and backups
    And the user must receive a confirmation notification upon deletion completion

  Scenario: PII is not transmitted over unencrypted connections
    Given a user interacts with the platform
    When any HTTP request containing user PII is made
    Then the request must be transmitted over HTTPS (TLS 1.2 or higher) only
```

## Related
- FR: FR-003 (User Profile), FR-008 (Demographic Filtering), FR-009 (Itinerary Save and Share)
