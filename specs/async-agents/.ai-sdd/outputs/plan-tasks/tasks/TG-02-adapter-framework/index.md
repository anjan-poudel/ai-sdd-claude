# TG-02: Adapter Framework

> **Jira Epic:** Adapter Framework

## Description
Defines the four shared adapter interfaces (Notification, Document, TaskTracking, CodeReview), the Result/AdapterError types, the CollaborationAdapterFactory with fail-fast credential validation, the retry middleware with exponential backoff, and the configuration schema with Zod validation. All adapter implementations in TG-03 through TG-07 depend on this group.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-005](T-005-adapter-interfaces.md) | Shared Adapter Interfaces and Types | M | -- | LOW |
| [T-006](T-006-retry-middleware.md) | Retry Middleware (CollabHttpClient) | M | T-005 | MEDIUM |
| [T-007](T-007-config-schema.md) | Configuration Schema and YAML Parsing | M | T-005 | LOW |
| [T-008](T-008-adapter-factory.md) | CollaborationAdapterFactory | M | T-005, T-007 | MEDIUM |

## Group effort estimate
- Optimistic (full parallel): 2 days
- Realistic (2 devs): 4 days
