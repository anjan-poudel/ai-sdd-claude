# T-003: Flyway migrations, JPA entities, and seed data

## Metadata
- **Group:** [TG-01 — Infrastructure & Database](index.md)
- **Component:** backend/src/main/resources/db/migration, backend/src/main/kotlin/.../domain
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** T-002
- **Blocks:** T-004, T-005, T-010, T-016, T-020, T-023
- **Requirements:** FR-001, FR-002, FR-003, FR-005, FR-006, NFR-005, NFR-007

## Description
Implement the full database schema via Flyway SQL migrations (all 7 tables from L1 design), map to Kotlin JPA entities with Hibernate Spatial for PostGIS geometry types, and create seed data for local development.

## Acceptance criteria

```gherkin
Feature: Flyway migrations and JPA entities

  Scenario: Migrations run cleanly on a fresh database
    Given PostgreSQL with PostGIS extension is running
    When the Spring Boot app starts
    Then Flyway applies all migrations without errors
    And all 7 tables exist: destinations, attractions, products, users, user_preferences, saved_itineraries, affiliate_clicks
    And all spatial indexes are created on geography columns

  Scenario: Seed data inserts correctly
    Given a clean migrated database
    When the dev seed script runs
    Then at least 3 destination records exist
    And at least 10 attraction records exist with valid geography coordinates
    And the affiliate_clicks table has no rows

  Scenario: affiliate_clicks table rejects updates and deletes
    Given an existing affiliate_clicks row
    When an UPDATE or DELETE is attempted on that row
    Then the database raises an exception and rolls back
```

## Implementation notes
- **Migrations:** `backend/src/main/resources/db/migration/V1__initial_schema.sql` (and subsequent Vn__ files). Flyway runs automatically on Spring Boot startup.
- **Entities:** Kotlin data classes annotated with `@Entity`. Use `org.hibernate.spatial` for `Geography` type mapping on `location` columns.
- **`affiliate_clicks` immutability:** Implement via PostgreSQL trigger (`BEFORE UPDATE OR DELETE → RAISE EXCEPTION`). Include trigger DDL in the Flyway migration, not application code.
- **Seed data:** Spring Boot `ApplicationRunner` bean, active only under `spring.profiles.active=dev`. Idempotent (upsert on unique constraints).
- NFR-005: no real PII in seed data (use synthetic names/emails).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests (DataJpaTest slice)
- [ ] `./gradlew flywayInfo` shows all migrations applied in CI
- [ ] Seed script is idempotent
