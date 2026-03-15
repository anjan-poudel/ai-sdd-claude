# T-001: Project scaffold, Docker Compose & CI/CD

## Metadata
- **Group:** [TG-01 — Infrastructure & Project Setup](index.md)
- **Component:** Project infrastructure
- **Agent:** dev
- **Effort:** M
- **Risk:** LOW
- **Depends on:** —
- **Blocks:** T-002, T-003, T-004, T-005, T-006, T-007
- **Requirements:** [NFR-003](../../../../define-requirements.md#nfr-003-reliability), [NFR-006](../../../../define-requirements.md#nfr-006-observability)

## Description
Create the monorepo structure with one package per ECS service (api, scheduler, scraper-worker, ingest, es-sync-worker, vector-worker, notification-worker, account-worker). Provide a Docker Compose file for local development (MongoDB replica set, Redis, OpenSearch, Weaviate mock). Set up GitHub Actions CI pipeline with build, typecheck, lint, test, and dependency vulnerability scan gates.

## Acceptance criteria

```gherkin
Feature: Project scaffold and CI/CD

  Scenario: All services build without errors
    Given the monorepo is checked out fresh
    When `npm run build` (or equivalent) is executed for each service
    Then each service must compile without TypeScript errors
    And no circular dependency warnings must appear

  Scenario: Docker Compose local stack starts
    Given Docker and Docker Compose are installed
    When `docker compose up -d` is run from the project root
    Then MongoDB (3-node replica set), Redis, OpenSearch, and Weaviate containers must all reach healthy state within 60 seconds
    And the api service must start and respond to `GET /health` with HTTP 200

  Scenario: CI pipeline fails on high-severity dependency vulnerability
    Given a dependency with a known high-severity CVE is added to package.json
    When the GitHub Actions pipeline runs
    Then the vulnerability scan step must fail with an actionable error message identifying the package
    And the pipeline must not proceed to deploy
```

## Implementation notes
- Use `npm workspaces` or `turborepo` for monorepo management.
- MongoDB replica set is required in Docker Compose because transactions are used (Ingest Service upsert).
- Use `bitnami/mongodb` image with `MONGODB_REPLICA_SET_MODE=primary` for easy replica set bootstrap.
- CI vulnerability scan: use `npm audit --audit-level=high` or `snyk test`.
- TypeScript strict mode must be enabled in every `tsconfig.json`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] `docker compose up` starts a fully functional local stack
- [ ] CI pipeline passes on main branch
- [ ] README documents how to run locally
