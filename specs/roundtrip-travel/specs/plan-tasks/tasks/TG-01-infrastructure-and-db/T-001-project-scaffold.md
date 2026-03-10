# T-001: Project scaffold and monorepo setup

## Metadata
- **Group:** [TG-01 — Infrastructure & Database](index.md)
- **Component:** apps/web (Next.js), backend/ (Spring Boot)
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** —
- **Blocks:** T-002, T-003, T-005, T-010, T-016, T-020
- **Requirements:** —

## Description
Initialise the monorepo with two top-level apps:
- `apps/web` — Next.js 14 frontend (TypeScript, App Router)
- `backend/` — Kotlin + Spring Boot 3 API and batch workers (Gradle multi-project)

Set up shared tooling: EditorConfig, `.gitignore`, root `docker-compose.yml`, and environment config validation in each app.

## Acceptance criteria

```gherkin
Feature: Project scaffold

  Scenario: Next.js app starts and passes health check
    Given Docker Compose is running (postgres, redis, meilisearch)
    When the Next.js dev server starts
    Then GET http://localhost:3000/api/health returns 200

  Scenario: Spring Boot app starts and passes health check
    Given Docker Compose is running
    When the Spring Boot app starts
    Then GET http://localhost:8080/actuator/health returns {"status":"UP"}

  Scenario: Spring Boot fails fast on missing env config
    Given a required environment variable (e.g. POSTGRES_URL) is unset
    When the Spring Boot app starts
    Then it exits with a clear configuration error before accepting requests
```

## Implementation notes
- **Backend build tool:** Gradle (Kotlin DSL — `build.gradle.kts`). Spring Initializr baseline: Spring Web, Spring Data JPA, Spring Batch, Spring Security, Spring Cache, Flyway, Redis, Actuator.
- **Frontend:** `create-next-app` with App Router and TypeScript strict mode.
- **Env config (backend):** Use `@ConfigurationProperties` with `@Validated` — fails fast on startup if required props missing.
- **Git hooks:** pre-commit runs `./gradlew ktlintCheck` (backend) and `next lint` (frontend).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] `./gradlew build` passes in CI
- [ ] `next build` passes in CI
