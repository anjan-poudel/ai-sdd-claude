# TG-01: Infrastructure & Project Setup

> **Jira Epic:** Infrastructure & Project Setup

## Description
Establishes the foundational infrastructure components: MongoDB schemas, ElasticSearch index, Redis BullMQ queues, project scaffolding, and environment configuration. All other task groups depend on this group completing first.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-001](T-001-project-scaffold-and-infra.md) | Project scaffold, Docker Compose & CI/CD | M | — | LOW |
| [T-002](T-002-mongodb-schemas-and-indexes.md) | MongoDB schemas and indexes (Mongoose) | M | T-001 | MEDIUM |
| [T-003](T-003-elasticsearch-index-and-migration.md) | ElasticSearch index mapping and migration tooling | M | T-001 | MEDIUM |
| [T-004](T-004-bullmq-queue-setup.md) | BullMQ queue setup and DLQ inspector | M | T-001 | MEDIUM |
| [T-005](T-005-env-config-validation.md) | Environment variable validation (Zod startup check) | S | T-001 | LOW |
| [T-006](T-006-structured-logging.md) | Structured JSON logging and request trace ID propagation | S | T-001 | LOW |
| [T-007](T-007-aws-secrets-and-ci-security.md) | AWS Secrets Manager integration and CI security gate | M | T-001 | MEDIUM |

## Group effort estimate
- Optimistic (full parallel): 4 days
- Realistic (2 devs): 8 days
