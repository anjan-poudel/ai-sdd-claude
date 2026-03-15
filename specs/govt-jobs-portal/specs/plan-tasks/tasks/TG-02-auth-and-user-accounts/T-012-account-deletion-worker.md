# T-012: Account deletion worker (deletion-queue consumer)

## Metadata
- **Group:** [TG-02 — Auth & User Accounts](index.md)
- **Component:** account-worker ECS service
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-002](../TG-01-infrastructure-and-project-setup/T-002-mongodb-schemas-and-indexes.md), [T-004](../TG-01-infrastructure-and-project-setup/T-004-bullmq-queue-setup.md)
- **Blocks:** —
- **Requirements:** [FR-007](../../../../define-requirements.md#fr-007-user-accounts), [NFR-005](../../../../define-requirements.md#nfr-005-compliance)

## Description
Implement the account deletion flow: `POST /api/users/me/delete` endpoint that sets `deletionRequestedAt` and `deletionScheduledFor` (now + 30 days) and enqueues a `deletion-queue` job. The `account-worker` service processes `deletion-queue` jobs by cascading deletions across: `saved_jobs`, `saved_searches`, `alerts`, `notifications`, `refresh_tokens`, and the `users` document. Per NFR-005, deletion must complete within 30 days. The worker must send a confirmation email via SES.

## Acceptance criteria

```gherkin
Feature: Account deletion

  Scenario: User requests account deletion
    Given a logged-in user navigates to account settings and confirms deletion
    When POST /api/users/me/delete is called
    Then HTTP 202 must be returned
    And users.deletionRequestedAt must be set to now
    And users.deletionScheduledFor must be set to now + 30 days
    And a deletion-queue job must be enqueued
    And the user must receive a confirmation email

  Scenario: Account deletion cascades to all user data
    Given a deletion-queue job exists for userId "abc"
    When the account-worker processes the job
    Then all saved_jobs documents for userId "abc" must be deleted
    And all saved_searches documents for userId "abc" must be deleted
    And all alerts documents for userId "abc" must be soft-deleted (status: "deleted")
    And all refresh_tokens for userId "abc" must be deleted
    And the users document for userId "abc" must be deleted

  Scenario: Deleted user cannot log in
    Given a user's deletion has been processed and their user document deleted
    When POST /api/auth/login is called with their email and password
    Then HTTP 401 must be returned
    And no session must be created

  Scenario: Deletion job is retried on transient failure
    Given a deletion-queue job fails due to a transient MongoDB write error
    When the job fails
    Then the job must be retried with exponential backoff (up to 5 attempts per L2 §4.1)
    And the user data must remain intact until deletion fully succeeds
```

## Implementation notes
- The `account-worker` is a separate ECS service that registers a BullMQ worker for `deletion-queue` only.
- Deletion must use MongoDB sessions/transactions to ensure atomicity within a single collection write.
- The `alerts` documents must use soft delete (`status: "deleted"`) rather than hard delete to preserve referential integrity with `notifications`.
- Confirmation email is sent via SES after all deletions complete, not before.
- Do not log the user's email in any deletion log entry.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Cascade deletion tested against all 6 target collections
- [ ] Retry behaviour tested by simulating transient failure on 2nd MongoDB operation
