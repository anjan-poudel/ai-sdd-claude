# GovJobs Portal — L3 Task Breakdown

## Summary

This document provides the developer-ready L3 task breakdown for the GovJobs Portal. Each task group corresponds to a Jira Epic; each task contains enough specification detail that a developer can begin implementation without re-reading design-l2.md. Tasks are derived from the L2 component design, the L1 architecture, the requirements, and the L3 plan-tasks output. All tasks include explicit acceptance criteria, implementation notes referencing specific design-l2.md sections, and test requirements.

## Contents

- [tasks/TG-01-infrastructure-and-project-setup.md](tasks/TG-01-infrastructure-and-project-setup.md) — monorepo scaffold, MongoDB schemas, ElasticSearch index, BullMQ queues, env config, logging, secrets (T-001 to T-007)
- [tasks/TG-02-auth-and-user-accounts.md](tasks/TG-02-auth-and-user-accounts.md) — registration, login, OAuth2, RBAC middleware, account deletion worker (T-008 to T-012)
- [tasks/TG-03-scraper-pipeline.md](tasks/TG-03-scraper-pipeline.md) — ingest service, scheduler, scraper worker framework, plugins, ES sync, vector embedding, expiry tracking (T-013 to T-019)
- [tasks/TG-04-search-and-discovery.md](tasks/TG-04-search-and-discovery.md) — web API scaffold, keyword search, semantic/hybrid search, saved searches (T-020 to T-023)
- [tasks/TG-05-notifications-and-alerts.md](tasks/TG-05-notifications-and-alerts.md) — alert subscriptions API, matching engine, notification worker, expiry reminder scheduler (T-024 to T-027)
- [tasks/TG-06-content-reviews-admin.md](tasks/TG-06-content-reviews-admin.md) — content CMS, agency reviews, admin operations dashboard (T-028 to T-030)
- [tasks/TG-07-frontend-and-monetisation.md](tasks/TG-07-frontend-and-monetisation.md) — Next.js scaffold, search and job detail UI, auth flows UI, AdSense integration (T-031 to T-034)
