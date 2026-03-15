# TG-05: Notifications & Alerts

> **Jira Epic:** Notifications & Alerts

## Description
Implements alert subscription management, the notification matching engine, the Notification Worker (email via SES, push via FCM), and the expiry reminder scheduler. Deduplication prevents double-sends.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-024](T-024-alert-management-api.md) | Alert management API (CRUD) | M | T-020, T-011 | MEDIUM |
| [T-025](T-025-notification-matching-engine.md) | Notification matching engine (alert-criteria matcher) | M | T-013, T-024 | MEDIUM |
| [T-026](T-026-notification-worker.md) | Notification Worker (SES email + FCM push, dedup, retry) | L | T-004, T-024, T-025 | MEDIUM |
| [T-027](T-027-expiry-reminder-scheduler.md) | Expiry reminder scheduler (6-hour cron, dedup) | M | T-026 | MEDIUM |

## Group effort estimate
- Optimistic (full parallel): 3 days
- Realistic (2 devs): 8 days
