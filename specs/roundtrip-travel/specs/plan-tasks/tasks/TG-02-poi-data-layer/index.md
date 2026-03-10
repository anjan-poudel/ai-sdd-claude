# TG-02: POI Data Layer

> **Jira Epic:** POI Data Layer

## Description
POI source adapters, ingestion pipeline, Meilisearch indexing, and quality scoring. Implements FR-005 and NFR-004 (vendor independence via adapter pattern).

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-005](T-005-poi-adapter-base.md) | POI adapter base interface and registry | S | T-003 | LOW |
| [T-006](T-006-national-parks-adapter.md) | National Parks AU adapter | M | T-005 | MEDIUM |
| [T-007](T-007-osm-adapter.md) | OpenStreetMap/Overpass adapter | M | T-005 | MEDIUM |
| [T-008](T-008-meilisearch-indexing.md) | Meilisearch POI indexing | S | T-005 | LOW |
| [T-009](T-009-quality-scoring.md) | POI quality score computation (NFR-011) | S | T-005 | LOW |

## Group effort estimate
- Optimistic (2 devs parallel): 4 days
- Realistic: 8 days
