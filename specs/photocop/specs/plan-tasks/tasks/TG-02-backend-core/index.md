# TG-02: Backend Core

> **Jira Epic:** Backend Core

## Description
Implements the FastAPI application factory, Pydantic settings, CORS and size-limit middleware, global error handlers, and the Image Ingestion Service. These components form the entry point for all API requests and must be complete before any analysis engine or output pipeline component can be integrated.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-004](T-004-app-factory-config.md) | App factory, config, and middleware | M | T-001, T-002 | HIGH |
| [T-005](T-005-error-handlers.md) | Global error handlers and ProblemDetail model | S | T-004 | MEDIUM |
| [T-006](T-006-image-ingestion-service.md) | Image Ingestion Service | M | T-004, T-005 | HIGH |
| [T-007](T-007-api-router-health.md) | API router and health endpoint | S | T-005, T-006 | LOW |

## Group effort estimate
- Optimistic (full parallel): 3 days
- Realistic (2 devs): 5–6 days
