# FR-003: Notifications and Alerts

## Metadata
- **Area:** Notifications & Alerts
- **Priority:** MUST
- **Source:** constitution.md — Functional Requirements / Notifications & Alerts

## Description

The system must allow registered users to create fine-grained job alert subscriptions. Subscriptions may be configured with any combination of: keyword, agency, classification, location, and salary band. When new jobs matching a subscription criteria are ingested, the system must notify the subscriber via their chosen channel (email via AWS SES and/or push notification via Firebase Cloud Messaging). The system must also send expiry reminders to users who have saved or marked as applied any job whose closing date is approaching. Users must be able to manage (create, pause, delete) their alert subscriptions through their account settings. All notification delivery must be asynchronous and queue-driven.

## Acceptance criteria

```gherkin
Feature: Notifications and Alerts

  Scenario: User creates a fine-grained job alert
    Given a logged-in user navigates to alert settings
    When the user creates an alert with keyword "data analyst", agency "ABS", and location "Canberra"
    Then the alert must be persisted against the user's account
    And the system must confirm creation with a summary of the alert criteria

  Scenario: Alert fires when a matching job is ingested
    Given a user has an active alert for keyword "economist" and classification "APS 6"
    When a new job titled "Senior Economist APS 6" is ingested and indexed
    Then a notification must be enqueued for delivery to the user within 15 minutes of ingestion
    And the notification must include: job title, agency, location, closing date, and a direct link

  Scenario: No false-positive alert when job does not match subscription
    Given a user has an active alert for keyword "nurse" and location "Sydney"
    When a new job titled "Software Engineer Melbourne" is ingested
    Then no notification must be sent to that user for that job

  Scenario: Email notification is delivered via AWS SES
    Given a user's alert has been triggered and email is their selected channel
    When the notification worker processes the queued notification
    Then an email must be sent via AWS SES to the user's registered address
    And the email must contain a working direct link to the job listing on the portal

  Scenario: Push notification is delivered via FCM
    Given a user has enabled push notifications and has a registered FCM token
    When the user's alert is triggered
    Then a push notification must be dispatched via Firebase Cloud Messaging to the user's token
    And the notification payload must include job title and agency

  Scenario: Expiry reminder is sent for a saved job
    Given a logged-in user has saved a job with a closing date 2 days from now
    When the expiry reminder scheduler runs
    Then the user must receive an expiry reminder notification via their preferred channel
    And the reminder must include the job title and exact closing date

  Scenario: User pauses an alert subscription
    Given a user has an active job alert
    When the user sets the alert status to "paused" in their account settings
    Then no further notifications must be sent for that alert while it is paused
    And the alert configuration must be retained so the user can re-activate it

  Scenario: User deletes an alert subscription
    Given a user has an active job alert
    When the user deletes the alert
    Then the alert must be removed from the system
    And no further notifications must be sent for that alert
```

## Related
- NFR: NFR-001 (notification delivery latency), NFR-003 (queue reliability), NFR-004 (no PII leakage in notifications)
- Depends on: FR-001 (jobs must exist to trigger alerts), FR-007 (user accounts required for subscriptions)
