# T-025: Notification matching engine (alert-criteria matcher)

## Metadata
- **Group:** [TG-05 — Notifications & Alerts](index.md)
- **Component:** notification-worker — matching logic
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-013](../TG-03-scraper-pipeline/T-013-ingest-service.md), [T-024](T-024-alert-management-api.md)
- **Blocks:** T-026
- **Requirements:** [FR-003](../../../../define-requirements.md#fr-003-notifications-and-alerts), [NFR-001](../../../../define-requirements.md#nfr-001-performance), [NFR-002](../../../../define-requirements.md#nfr-002-scalability)

## Description
Implement the `matchAlertsForJob` function per L2 §6.1–§6.2. Fetch all active alerts; apply in-memory criteria matching (AND across criteria types, OR within a list). When `ALERT_MATCH_USE_INDEXED_QUERY=true`, pre-filter by `governmentLevel` and `state` via MongoDB indexed query before in-memory scoring. Transition threshold: `ALERT_MATCH_INDEX_THRESHOLD` (10,000). For each matched alert, enqueue a `notification-queue` job.

## Acceptance criteria

```gherkin
Feature: Alert matching engine

  Scenario: Alert fires when all criteria match
    Given a user has an active alert for query "data analyst" and classification "APS 6"
    When a new job "Data Analyst APS 6" at "ABS" is ingested
    Then the alert must match
    And a notification-queue job must be enqueued for that alert and job

  Scenario: No false positive when job does not match subscription
    Given a user has an active alert for keyword "nurse" and location "Sydney"
    When a new job "Software Engineer Melbourne" is ingested
    Then no notification must be enqueued for that alert

  Scenario: Alert is enqueued within 15 minutes of ingestion
    Given a user has an active alert matching keyword "graduate policy"
    When a matching job is ingested and indexed
    Then a notification task must appear in the notification queue within 15 minutes

  Scenario: Paused alert does not trigger notification
    Given a user has a paused alert (status: "paused") for keyword "lawyer"
    When a new job "Senior Lawyer" is ingested
    Then no notification must be enqueued for that paused alert

  Scenario: In-memory matcher scales correctly at 10,000 alerts
    Given 10,000 active alerts are in the database
    When matchAlertsForJob runs for a new job
    Then the matching query must complete within ALERT_MATCH_QUERY_TIMEOUT_MS (5000ms)
```

## Implementation notes
- Matching logic per L2 §6.2: case-insensitive substring for `query`; normalised comparison for `agencies`, `classifications` (prefix match), `locations` (contains), `governmentLevels`, `states`; salary band range check.
- When `ALERT_MATCH_USE_INDEXED_QUERY=true`, pre-filter query: `{ status: "active", governmentLevel: { $in: [job.governmentLevel] }, state: { $in: [job.state] } }`.
- The `notification-queue` job ID dedup key: `"notify:${alertId}:${mongoJobId}"`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] False-positive rate tested against a 50-alert test dataset
- [ ] Scale test verified at 10,000 alerts within timeout
