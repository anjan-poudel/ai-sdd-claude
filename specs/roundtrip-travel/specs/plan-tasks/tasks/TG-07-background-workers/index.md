# TG-07: Background Workers

> **Jira Epic:** Background Workers

## Description
BullMQ job worker process: POI ingestion cron, Meilisearch sync, and affiliate report aggregation. Implements NFR-008 (data freshness), observability for job health.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-026](T-026-bullmq-worker-setup.md) | BullMQ worker process setup | S | T-002 | LOW |
| [T-027](T-027-poi-ingestion-cron.md) | POI ingestion cron job | M | T-026, T-006, T-007 | MEDIUM |
| [T-028](T-028-job-health-monitoring.md) | Job health monitoring and alerts | S | T-026 | LOW |

## Group effort estimate
- Optimistic: 3 days
- Realistic: 4 days
