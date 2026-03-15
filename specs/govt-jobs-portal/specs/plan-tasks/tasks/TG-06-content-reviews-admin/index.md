# TG-06: Content, Reviews & Admin CMS

> **Jira Epic:** Content, Reviews & Admin CMS

## Description
Implements preparation content management (blog posts, hiring guides, selection criteria), agency reviews (Glassdoor + internal user reviews with moderation), and the Admin CMS operations panel (scraper source management, job curation, health dashboard, review moderation). All admin functions are RBAC-protected.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-028](T-028-content-management.md) | Content management API and CMS (preparation resources) | L | T-020, T-011 | MEDIUM |
| [T-029](T-029-agency-reviews.md) | Agency reviews (internal + Glassdoor fallback, moderation) | M | T-020, T-011 | MEDIUM |
| [T-030](T-030-admin-cms-operations.md) | Admin CMS operations (scraper config, job curation, health dashboard) | L | T-020, T-013, T-014 | MEDIUM |

## Group effort estimate
- Optimistic (full parallel): 3 days
- Realistic (2 devs): 8 days
