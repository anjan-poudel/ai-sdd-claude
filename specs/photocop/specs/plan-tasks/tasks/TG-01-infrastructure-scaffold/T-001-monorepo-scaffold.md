# T-001: Monorepo scaffold and Docker Compose

## Metadata
- **Group:** [TG-01 — Infrastructure & Project Scaffold](index.md)
- **Component:** Project root, Docker Compose
- **Agent:** dev
- **Effort:** M
- **Risk:** LOW
- **Depends on:** —
- **Blocks:** [T-002](T-002-backend-dependency-manifest.md), [T-003](T-003-ci-pipeline.md), [T-004](../TG-02-backend-core/T-004-app-factory-config.md)
- **Requirements:** [FR-001](../../../define-requirements/FR/FR-001-image-upload.md), [NFR-003](../../../define-requirements/NFR/NFR-003-performance.md)

## Description
Create the top-level monorepo directory layout with `backend/` and `frontend/` sub-directories, a `docker-compose.yml` that builds and wires both services, and a root `.env.example` documenting all required environment variables. The Docker Compose file must define `ANALYSIS_TIMEOUT_SECONDS`, `MAX_UPLOAD_BYTES`, `CORS_ORIGINS`, and `LOG_LEVEL` for the backend service, and expose the backend health check at `GET /health`.

## Acceptance criteria

```gherkin
Feature: Monorepo scaffold

  Scenario: Docker Compose brings up both services successfully
    Given the repository is cloned fresh with no pre-existing .env file
    And docker-compose.yml is present at the root
    When the developer runs "docker compose up --build"
    Then the backend service becomes healthy (GET /health returns 200)
    And the frontend service is reachable on the configured port

  Scenario: Environment variable defaults are documented
    Given the .env.example file is present at the project root
    When it is inspected
    Then it contains entries for ANALYSIS_TIMEOUT_SECONDS, MAX_UPLOAD_BYTES, CORS_ORIGINS, LOG_LEVEL, FRONTEND_PORT, and BACKEND_PORT
    And each entry has an inline comment describing its purpose and default value
```

## Implementation notes
- Backend service: `build: ./backend`, ports `"${BACKEND_PORT:-8000}:8000"`, `depends_on: []`.
- Frontend service: `build: ./frontend`, ports `"${FRONTEND_PORT:-5173}:5173"`, `depends_on: [backend]`.
- Backend health check: `test: ["CMD","curl","-f","http://localhost:8000/health"]`, `interval: 30s`, `timeout: 5s`, `retries: 3`.
- No database, cache, or object-storage service should be present.
- The `backend/` directory must contain a placeholder `app/__init__.py` so Python imports resolve.
- The `frontend/` directory must contain a Vite + React TypeScript scaffold (`npm create vite`).

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] `docker compose up --build` succeeds in CI with no pre-existing state
- [ ] `.env.example` checked into source control
- [ ] No PII in logs
