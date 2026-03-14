# TG-01: Infrastructure & Project Scaffold

> **Jira Epic:** Infrastructure & Project Scaffold

## Description
Establishes the monorepo layout, Docker Compose development environment, CI pipeline, and dependency manifests for both the Python backend and React frontend. All subsequent tasks depend on this group being complete.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-001](T-001-monorepo-scaffold.md) | Monorepo scaffold and Docker Compose | M | — | LOW |
| [T-002](T-002-backend-dependency-manifest.md) | Backend dependency manifest and virtual environment | S | T-001 | LOW |
| [T-003](T-003-ci-pipeline.md) | CI pipeline (lint, typecheck, test gate) | S | T-001 | MEDIUM |

## Group effort estimate
- Optimistic (full parallel): 2 days
- Realistic (2 devs): 3–4 days
