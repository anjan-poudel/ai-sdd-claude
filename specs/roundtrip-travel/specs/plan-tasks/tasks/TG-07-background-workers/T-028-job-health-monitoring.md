# T-028: Job health monitoring and alerts

## Metadata
- **Group:** [TG-07 — Background Workers](index.md)
- **Component:** backend/ (Spring Batch + Spring Boot Actuator)
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** T-026
- **Blocks:** —
- **Requirements:** NFR-003

## Description
Expose batch job health via Spring Boot Actuator and a custom admin endpoint. Register a `JobExecutionListener` to log failures. Expose `GET /api/admin/jobs` (admin-only) showing last execution status and step-level stats from the Spring Batch job repository.

## Acceptance criteria

```gherkin
Feature: Job health monitoring

  Scenario: Failed job step is logged with details
    Given a PoiIngestionJob step fails
    When the step failure is recorded by Spring Batch
    Then the JobExecutionListener logs the job name, step name, and exception message
    And the BATCH_STEP_EXECUTION record shows status FAILED

  Scenario: Admin can view job execution history
    Given an admin user provides a valid JWT with admin role
    When GET /api/admin/jobs is called
    Then a list of recent job executions is returned with: job name, status, start time, end time, step counts

  Scenario: Non-admin request to admin endpoint returns 403
    Given a regular authenticated user
    When GET /api/admin/jobs is called
    Then the response is 403 Forbidden
```

## Implementation notes
- **Actuator:** Expose `batch` and `health` endpoints (`management.endpoints.web.exposure.include=health,batch`). Batch actuator shows job instance history from the Spring Batch job repository.
- **Custom admin endpoint:** `GET /api/admin/jobs` — queries `JobExplorer` bean to return the last N executions per job name. Role guard: `@PreAuthorize("hasRole('ADMIN')")`.
- **JobExecutionListener:** `@Component` implementing `JobExecutionListener.afterJob()` — logs `WARN` on FAILED status with exception info from `StepExecution`.
- Phase 1: log-only alerting. Phase 2: integrate with alerting service (PagerDuty, Slack webhook).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Admin endpoint returns 403 for non-admin JWT
- [ ] Listener log output verified in integration test
