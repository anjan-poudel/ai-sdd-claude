# TG-04: Search & Discovery

> **Jira Epic:** Search & Discovery

## Description
Implements the search and discovery API: keyword search via ElasticSearch with faceted filtering, semantic vector search, saved searches, and search history. The Web API middleware stack (rate limiting, auth, RBAC, error handling) is also implemented here.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-020](T-020-web-api-middleware-stack.md) | Web API Express app and middleware stack | M | T-009, T-011 | MEDIUM |
| [T-021](T-021-keyword-search-and-job-detail.md) | Keyword search (ES), faceted filtering, and job detail API | L | T-017, T-020 | MEDIUM |
| [T-022](T-022-semantic-search.md) | Semantic vector search and hybrid mode | M | T-018, T-021 | HIGH |
| [T-023](T-023-saved-searches-and-history.md) | Saved searches and search history | S | T-020 | LOW |

## Group effort estimate
- Optimistic (full parallel): 3 days
- Realistic (2 devs): 7 days
