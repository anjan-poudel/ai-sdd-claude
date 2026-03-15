# T-026: Notification Worker (SES email + FCM push, dedup, retry)

## Metadata
- **Group:** [TG-05 — Notifications & Alerts](index.md)
- **Component:** notification-worker ECS service
- **Agent:** dev
- **Effort:** L
- **Risk:** MEDIUM
- **Depends on:** [T-004](../TG-01-infrastructure-and-project-setup/T-004-bullmq-queue-setup.md), [T-024](T-024-alert-management-api.md), [T-025](T-025-notification-matching-engine.md)
- **Blocks:** T-027
- **Requirements:** [FR-003](../../../../define-requirements.md#fr-003-notifications-and-alerts), [NFR-002](../../../../define-requirements.md#nfr-002-scalability), [NFR-004](../../../../define-requirements.md#nfr-004-security-and-privacy)

## Description
Implement `NotificationWorkerInterface` per L2 §1.8. Consume `notification-queue` and `expiry-reminder-queue`. Send email via AWS SES and push via FCM. FCM fan-out to all registered tokens (up to `MAX_FCM_TOKENS_PER_USER = 10`). On `FCM_TOKEN_INVALID` error, atomically remove the token from `users.fcmTokens`. Prune stale tokens (lastUsedAt > 90 days) before dispatch. All sends record a `notifications` document with deduplication key (L2 §6.3). Duplicate-key error on insert = silently complete (legitimate dedup). 10,000 emails/hour throughput (NFR-002).

## Acceptance criteria

```gherkin
Feature: Notification Worker

  Scenario: Email notification is delivered via SES
    Given a notification-queue job exists for an email alert
    When the notification worker processes the job
    Then an email must be sent via AWS SES to the user's registered address
    And the email must contain a working direct link to the job listing
    And a notifications document must be created with status: "sent"

  Scenario: Push notification fans out to all user FCM tokens
    Given a user has 3 registered FCM tokens
    When a push notification-queue job is processed for that user
    Then the notification must be dispatched to all 3 tokens
    And fcmTokens[i].lastUsedAt must be updated for each token

  Scenario: Invalid FCM token is removed atomically
    Given a user has an FCM token that FCM reports as invalid
    When the notification worker attempts to dispatch to that token
    Then the FCM_TOKEN_INVALID error must be caught
    And the specific token must be removed from users.fcmTokens via atomic $pull
    And the other tokens must remain

  Scenario: Stale FCM token is pruned before dispatch
    Given a user has a token where lastUsedAt is 91 days ago
    When the notification worker processes a push notification for that user
    Then the stale token must be removed before the dispatch loop runs
    And no push attempt must be made to the stale token

  Scenario: Duplicate notification is silently deduplicated
    Given a notifications document already exists with deduplicationKey "alert:email:alertId:jobId"
    When the notification worker attempts to insert a duplicate
    Then the MongoDB duplicate-key error must be caught
    And the BullMQ job must complete as successful (not fail)
    And no additional email must be sent

  Scenario: Notification worker dispatches 10,000 emails per hour
    Given 10,000 notification tasks are enqueued
    When the notification worker processes the queue with NOTIFICATION_CONCURRENCY (20)
    Then all 10,000 notifications must be dispatched within 60 minutes
```

## Implementation notes
- SES: use `@aws-sdk/client-ses` `SendEmailCommand`. `SES_FROM_ADDRESS` must be a verified SES sender.
- FCM: use `firebase-admin` SDK. Initialise with `FCM_PROJECT_ID`, `FCM_PRIVATE_KEY`, `FCM_CLIENT_EMAIL` from Secrets Manager.
- Stale token prune: `users.fcmTokens.filter(t => now - t.lastUsedAt.getTime() <= 90 * 86400000)`.
- Deduplication key insert: catch MongoDB error code 11000; log at DEBUG level; mark BullMQ job complete.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] FCM token removal verified by checking users.fcmTokens after invalid token dispatch
- [ ] SES delivery tested against a mock SES client
- [ ] Deduplication tested by attempting two identical notification inserts
