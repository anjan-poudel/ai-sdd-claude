# Requirements — GovJobs Portal

## Summary
- Functional requirements: 8
- Non-functional requirements: 6
- Areas covered: Job Aggregation, Search & Discovery, Notifications & Alerts, Content & Preparation, Reviews & Ratings, Revenue & Monetisation, User Accounts, Admin CMS & Operations, Performance, Scalability, Reliability, Security, Compliance, Observability

## Contents
- [FR/index.md](FR/index.md) — functional requirements
- [NFR/index.md](NFR/index.md) — non-functional requirements

## Open decisions

1. **API vs GraphQL:** The constitution lists "REST + GraphQL (TBD)" as the API layer. Until resolved, FRs assume a REST API. GraphQL adoption would affect FR-002 (search), FR-007 (user accounts), and FR-008 (admin queries) but does not change the requirements themselves.

2. **LinkedIn scraping vs API:** The constitution mentions scraping LinkedIn or using its API for government jobs. LinkedIn's API access for job aggregation is heavily restricted; if API access is unavailable, scraping LinkedIn entails legal and terms-of-service risk (see NFR-005). This decision must be made before the scraper architecture is designed.

3. **Glassdoor access mechanism:** As noted in FR-005, Glassdoor data access depends on current ToS and robots.txt. If Glassdoor disallows scraping, the internal review system (FR-005 fallback) becomes the primary path from launch. This affects the priority of the internal review feature.

4. **Phase 2 paid tier timeline:** FR-006 defines Phase 1 ad-driven revenue only. The timeline for Phase 2 (paid department self-publish) is not yet set, but the data model must accommodate it (noted as a constraint, not a requirement).

5. **GDPR scope:** The portal targets Australian users and Privacy Act compliance is required. GDPR is explicitly out of scope for Phase 1. If the user base expands to include EU residents, GDPR requirements will need to be added.

## Out of scope
- Government department self-publish and featured listing paid tier (Phase 2)
- Subscription billing infrastructure
- Mobile native apps (iOS/Android); web only for Phase 1
- Resume/CV storage or application tracking
- Direct integration with department ATS (applicant tracking systems)
- GDPR compliance for EU residents
- Automated interview scheduling
- Salary benchmarking or market analytics beyond what is surfaced from scraped data
