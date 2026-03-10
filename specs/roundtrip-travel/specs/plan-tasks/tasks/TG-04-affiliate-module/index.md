# TG-04: Affiliate Module

> **Jira Epic:** Affiliate Module

## Description
HMAC-secured affiliate link generation, click logging, and redirect API. Implements FR-006, NFR-007 (audit trail). Revenue-critical component.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-014](T-014-affiliate-link-service.md) | Affiliate link generation service | M | T-003 | MEDIUM |
| [T-015](T-015-affiliate-redirect-api.md) | /api/affiliate/redirect endpoint | S | T-014 | HIGH |
| [T-016](T-016-affiliate-click-logging.md) | Affiliate click audit logging | S | T-015 | HIGH |

## Group effort estimate
- Optimistic: 3 days
- Realistic: 4 days
