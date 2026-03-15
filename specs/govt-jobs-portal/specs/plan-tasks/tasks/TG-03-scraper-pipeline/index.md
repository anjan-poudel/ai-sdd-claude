# TG-03: Scraper Pipeline

> **Jira Epic:** Scraper Pipeline

## Description
Implements the full job ingestion pipeline: Scraper Scheduler (with Redis leader election), Scraper Workers (with Playwright, robots.txt compliance, and rate limiting), Ingest Service (deduplication and MongoDB upsert), ES Sync Worker, and Vector Embedding Worker. This group is the core data production engine for the portal.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-013](T-013-ingest-service.md) | Ingest Service (dedup, upsert, queue publish) | L | T-002, T-004 | HIGH |
| [T-014](T-014-scraper-scheduler.md) | Scraper Scheduler with Redis leader election | L | T-002, T-004 | HIGH |
| [T-015](T-015-scraper-worker-framework.md) | Scraper Worker framework (robots.txt, rate limiter, plugin registry) | L | T-004, T-013 | CRITICAL |
| [T-016](T-016-scraper-plugins.md) | Scraper plugins (APSJobs, NSW, VIC, QLD, generic) | XL | T-015 | HIGH |
| [T-017](T-017-es-sync-worker.md) | ES Sync Worker and index alias management | M | T-003, T-004 | MEDIUM |
| [T-018](T-018-vector-embedding-worker.md) | Vector Embedding Worker and VectorDbAdapter | M | T-004, T-003 | HIGH |
| [T-019](T-019-expiry-tracking-and-rescan.md) | Expiry tracking and high-frequency re-scan enqueue | M | T-014 | MEDIUM |

## Group effort estimate
- Optimistic (full parallel): 6 days
- Realistic (2 devs): 14 days
