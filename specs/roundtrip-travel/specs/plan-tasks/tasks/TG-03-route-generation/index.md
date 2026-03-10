# TG-03: Route Generation

> **Jira Epic:** Route Generation

## Description
The core differentiation: road-trip itinerary generator with demographic-aware stopover intelligence. Implements FR-001, FR-002, FR-008.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-010](T-010-route-generation-service.md) | Route generation service (Google Maps + PostGIS) | L | T-004, T-009 | HIGH |
| [T-011](T-011-demographic-scoring.md) | Demographic scoring and stopover filtering | M | T-010 | MEDIUM |
| [T-012](T-012-route-api-endpoint.md) | /api/itinerary/generate endpoint | S | T-011 | MEDIUM |
| [T-013](T-013-itinerary-builder-ui.md) | Itinerary builder UI (React) | L | T-012 | MEDIUM |

## Group effort estimate
- Optimistic (2 devs parallel): 5 days
- Realistic: 7 days
