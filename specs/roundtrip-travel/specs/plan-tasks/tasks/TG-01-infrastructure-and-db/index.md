# TG-01: Infrastructure & Database

> **Jira Epic:** Infrastructure & Database

## Description
Project scaffolding, Docker Compose services, Prisma schema, migrations, and PostGIS spatial extension. All other task groups depend on T-001 completing.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-001](T-001-project-scaffold.md) | Project scaffold and monorepo setup | M | — | MEDIUM |
| [T-002](T-002-docker-compose.md) | Docker Compose services (DB, Redis, Meilisearch) | S | T-001 | LOW |
| [T-003](T-003-prisma-schema-and-migrations.md) | Prisma schema, migrations, and seed data | M | T-002 | MEDIUM |
| [T-004](T-004-postgis-spatial-index.md) | PostGIS extension and spatial index | S | T-003 | MEDIUM |

## Group effort estimate
- Optimistic (1 dev, full parallel where possible): 4 days
- Realistic: 6 days
