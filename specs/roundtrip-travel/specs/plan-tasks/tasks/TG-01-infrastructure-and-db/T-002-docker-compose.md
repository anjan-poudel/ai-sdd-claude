# T-002: Docker Compose services

## Metadata
- **Group:** [TG-01 — Infrastructure & Database](index.md)
- **Component:** Infrastructure
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** T-001
- **Blocks:** T-003
- **Requirements:** NFR-003

## Description
Create Docker Compose configuration for local development: PostgreSQL 16 with PostGIS, Redis 7, and Meilisearch. Include health checks and named volumes for data persistence.

## Acceptance criteria

```gherkin
Feature: Docker Compose services

  Scenario: All services start healthy
    Given Docker is running
    When `docker compose up -d` is run
    Then postgres, redis, and meilisearch containers start
    And all health checks pass within 30 seconds
    And `pg_isready` returns success for the postgres container

  Scenario: Data persists across restarts
    Given the postgres container has data
    When `docker compose restart` is run
    Then the data is still present after restart
```

## Implementation notes
- PostgreSQL image: `postgis/postgis:16-3.4`
- Redis image: `redis:7-alpine`
- Meilisearch image: `getmeili/meilisearch:v1.7`
- Expose ports: 5432, 6379, 7700 (local only)
- docker-compose.yml at project root for dev; separate docker-compose.prod.yml for production.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] CI pipeline starts services with docker compose before integration tests
