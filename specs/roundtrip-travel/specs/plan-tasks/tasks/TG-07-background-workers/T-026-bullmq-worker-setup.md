# T-026: Spring Batch job configuration and scheduler setup

## Metadata
- **Group:** [TG-07 — Background Workers](index.md)
- **Component:** backend/src/main/kotlin/.../batch
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** T-002
- **Blocks:** T-027, T-028
- **Requirements:** NFR-003

## Description
Configure the Spring Batch job infrastructure and Spring Scheduler cron triggers within the Spring Boot application. Define job beans for `PoiIngestionJob` and `AffiliateReportJob`, wire the Spring Batch `JobRepository` to the existing PostgreSQL datasource, and register `@Scheduled` cron triggers for each job.

No separate worker process or Redis job queue is needed — Spring Batch uses PostgreSQL as its job repository and Spring Scheduler handles triggering.

## Acceptance criteria

```gherkin
Feature: Spring Batch job infrastructure

  Scenario: Batch job tables are created on startup
    Given PostgreSQL is running with Flyway migrations applied
    When the Spring Boot app starts with batch enabled
    Then the Spring Batch metadata tables exist (BATCH_JOB_INSTANCE, BATCH_JOB_EXECUTION, etc.)

  Scenario: PoiIngestionJob is scheduled and executes
    Given the app is running with batch scheduler enabled
    When the scheduled cron fires (or job is triggered manually via Actuator)
    Then a BATCH_JOB_EXECUTION record is created with status COMPLETED or FAILED
    And no unhandled exceptions propagate to the application context

  Scenario: App shuts down gracefully during a running job
    Given a batch job is executing
    When the app receives SIGTERM
    Then the current job step completes its current chunk
    And the app exits cleanly (exit code 0)
    And the job execution record shows status STOPPED (resumable)
```

## Implementation notes
- **JobRepository:** Configure via `@EnableBatchProcessing` — Spring Boot auto-configures using the primary `DataSource` (PostgreSQL). Batch schema created by Flyway migration (include `org/springframework/batch/core/schema-postgresql.sql` content in a migration file).
- **Scheduler:** `@EnableScheduling` on `@Configuration` class. Use `@Scheduled(cron = "0 0 3 * * *", zone = "Australia/Sydney")` for poi-ingest trigger.
- **Graceful shutdown:** Spring Boot's `spring.batch.job.enabled=false` (don't auto-run on startup); jobs triggered only via scheduler or Actuator. Register `JobOperator` bean to support stop requests.
- **No Redis dependency** for job coordination — this replaces BullMQ.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests (using `@SpringBatchTest`)
- [ ] Batch tables included in Flyway migrations
- [ ] Graceful shutdown verified in integration test
