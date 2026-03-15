# TG-07: Frontend & Monetisation

> **Jira Epic:** Frontend & Monetisation

## Description
Implements the client-side portal: job search and results page, job detail page (with contextual preparation content, reviews, save-job), user authentication flows (register, login, OAuth), and Google AdSense ad unit integration. Includes performance optimisation to meet FCP < 2s on 4G.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-031](T-031-frontend-scaffold-and-search.md) | Frontend scaffold, search page, and job detail page | XL | T-021, T-022, T-028, T-029 | MEDIUM |
| [T-032](T-032-auth-flows-frontend.md) | Frontend authentication flows (register, login, OAuth, account management) | L | T-031, T-009, T-010 | MEDIUM |
| [T-033](T-033-adsense-integration.md) | Google AdSense ad unit integration | S | T-031 | LOW |
| [T-034](T-034-performance-and-privacy.md) | Performance optimisation (FCP < 2s) and Privacy Policy page | M | T-031 | LOW |

## Group effort estimate
- Optimistic (full parallel): 4 days
- Realistic (2 devs): 8 days
