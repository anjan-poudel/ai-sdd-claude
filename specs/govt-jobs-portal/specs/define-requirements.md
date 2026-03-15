# Requirements — GovJobs Portal

## Summary

GovJobs Portal is a purpose-built web application that aggregates government job listings from all levels of Australian government (federal, state, territory, council, and statutory bodies) into a single searchable portal. It addresses the problem that job seekers today must visit over 100 separate government job boards, while existing aggregators are incomplete and stale. The portal provides best-in-class search (ElasticSearch + semantic vector search), fine-grained job alerts, preparation content, and agency reviews, with an ad-driven revenue model in Phase 1.

## Contents

- [FR/index.md](FR/index.md) — functional requirements (8 requirements)
- [NFR/index.md](NFR/index.md) — non-functional requirements (6 requirements)

---

## Open Decisions

1. **API vs GraphQL:** The constitution lists "REST + GraphQL (TBD)". FRs assume REST. GraphQL adoption would affect FR-002, FR-007, FR-008 but not the requirement substance.
2. **LinkedIn scraping vs API:** LinkedIn API access for job aggregation is restricted. If unavailable, scraping LinkedIn carries legal and ToS risk. Decision needed before architecture is designed.
3. **Glassdoor access mechanism:** Glassdoor data access depends on current ToS/robots.txt. If disallowed, the internal review fallback (FR-005) becomes the primary path from launch.
4. **Phase 2 paid tier timeline:** Not yet set. Data model must accommodate it but it is not implemented in Phase 1.
5. **GDPR scope:** Out of scope for Phase 1. Data model must not preclude it.

## Out of Scope

- Government department self-publish and featured listing paid tier (Phase 2)
- Subscription billing infrastructure
- Mobile native apps (iOS/Android)
- Resume/CV storage or application tracking
- Direct ATS integration
- GDPR compliance for EU residents
- Automated interview scheduling
- Salary benchmarking analytics beyond scraped data

---

## Functional Requirements

### FR-001: Job Aggregation
- **Area:** Job Aggregation
- **Priority:** MUST
- **Source:** constitution.md — Functional Requirements / Job Aggregation

The system must automatically ingest government job listings from: official government REST APIs where available; web scraping of government job boards (federal, state, territory, council, statutory bodies); and LinkedIn jobs filtered to government employers. Each source must have a configurable scrape schedule stored in the database (no code change required). The system must deduplicate jobs across sources and maintain a canonical job record with full source attribution. The system must track expiry dates and auto-reschedule high-frequency re-scans in the 72-hour window before and 48-hour window after expiry to detect extensions.

**Acceptance criteria:**

```gherkin
Feature: Job Aggregation

  Scenario: Ingest a job from a government REST API
    Given a government agency publishes a REST API endpoint listing open roles
    And the source is configured in the scraper config with a valid endpoint and schedule
    When the scheduled ingestion job runs
    Then the system must fetch all job listings from the API
    And each listing must be stored as a canonical job record in MongoDB
    And the record must include source attribution (agency name, source URL, source type "api")
    And the job must be indexed in ElasticSearch within 60 seconds of storage

  Scenario: Ingest a job by scraping a government job board
    Given a government job board is configured as a scrape target
    And the target page is reachable
    When the scheduled scrape job runs for that board
    Then the scraper must extract all job listings present on the board
    And each listing must be stored as a canonical job record in MongoDB
    And the record must include source attribution (board name, source URL, source type "scrape")

  Scenario: Deduplicate a job that appears on multiple sources
    Given job "Senior Policy Officer" at "Dept of Finance" is already stored with source "apsjobs.gov.au"
    When the same job is encountered during a scrape of "seek.com.au/government"
    Then the system must not create a duplicate canonical record
    And the system must add the new source URL to the existing record's source attribution list
    And the deduplication accuracy must be greater than 99% when measured against the known-duplicate test dataset

  Scenario: Reschedule scan near a job's expiry date
    Given a canonical job record has an expiry date set to 3 days in the future
    When the expiry-tracking scheduler runs
    Then the system must enqueue a high-frequency re-scan for that job's source URL
    And re-scans must occur at least once every 12 hours in the 72-hour window before expiry
    And re-scans must continue for at least 48 hours after the listed expiry date

  Scenario: Detect a job extension after expiry
    Given a canonical job record had expiry date yesterday
    And the job has been re-scanned after expiry
    When the source page still lists the job with a new closing date
    Then the system must update the canonical record's expiry date to the new closing date
    And the job must remain active (not marked expired) in search results

  Scenario: Mark a job as expired when no longer found
    Given a canonical job record has passed its expiry date
    And multiple post-expiry re-scans have found the listing absent from the source
    When the final post-expiry re-scan threshold (48 hours after expiry) is reached without the listing reappearing
    Then the system must mark the job record as expired
    And the job must be excluded from default active-job search results

  Scenario: Scrape schedule is configurable without code changes
    Given a source's scrape schedule is stored in the database as a cron expression
    When an administrator updates the cron expression for that source via the Admin CMS
    Then the scheduler must pick up the new schedule on the next polling cycle (within 5 minutes)
    And no application redeployment must be required

  Scenario: Scraping infrastructure is isolated from the web API
    Given the scraper workers are under heavy load processing a large board
    When a user submits a search query through the web API
    Then the web API must respond within its normal latency SLA
    And the scraping workload must not block or degrade web API response times
```

**Related:** NFR-001, NFR-002, NFR-003, NFR-005

---

### FR-002: Search and Discovery
- **Area:** Search & Discovery
- **Priority:** MUST
- **Source:** constitution.md — Functional Requirements / Search & Discovery

The system must provide full-text job search powered by ElasticSearch (AWS OpenSearch), supporting keyword search and faceted filtering by government level, location, classification/grade, salary band, and agency. The system must additionally support semantic vector similarity search via a vector database (Weaviate or Pinecone). Vector embeddings must be computed by a separate batch worker and must not run on the ingestion hot path. The system must support saved searches (persisted per user account) and per-user search history. ElasticSearch is the designated read model; MongoDB is the source of truth.

**Acceptance criteria:**

```gherkin
Feature: Search and Discovery

  Scenario: Full-text keyword search returns relevant results
    Given at least 1000 active job records are indexed in ElasticSearch
    When a user submits the search query "policy analyst canberra"
    Then the system must return results within 500 ms (p95)
    And results must be ranked by relevance score descending
    And each result must include: job title, agency, location, salary band, closing date

  Scenario: Faceted filter narrows results correctly
    Given active job records exist across multiple states and classification levels
    When a user applies the filter "location: Victoria" and "level: APS 5-6"
    Then all returned results must match both filter conditions
    And the result count displayed must match the actual number of documents returned

  Scenario: Semantic search surfaces conceptually related jobs
    Given a job "Legislative Drafting Officer" is indexed with its description
    When a user performs a semantic search for "legal writing government"
    Then the result set must include "Legislative Drafting Officer"
    And results must appear even if the exact phrase "legal writing" is absent from the job title

  Scenario: Saved search is persisted per user
    Given a logged-in user has set filters "agency: ATO" and "classification: EL1"
    When the user saves the search with the name "ATO EL1 roles"
    Then the search must be stored against the user's account
    And when the user returns to the site and navigates to saved searches
    Then the saved search "ATO EL1 roles" must be listed and re-executable with one click

  Scenario: Search history is maintained per user
    Given a logged-in user has executed three searches in the current session
    When the user navigates to their search history page
    Then the three searches must be listed in reverse chronological order
    And each entry must show the query string and any applied filters

  Scenario: Anonymous user can search without an account
    Given an unauthenticated visitor accesses the portal
    When the visitor submits a keyword search
    Then the system must return results without requiring login
    And no search history must be persisted for anonymous users

  Scenario: ElasticSearch index reflects MongoDB source of truth
    Given a job record is updated in MongoDB (e.g. expiry date extended)
    When the index sync process runs
    Then the corresponding ElasticSearch document must reflect the updated field within 60 seconds
```

**Related:** NFR-001, NFR-002; Depends on: FR-001

---

### FR-003: Notifications and Alerts
- **Area:** Notifications & Alerts
- **Priority:** MUST
- **Source:** constitution.md — Functional Requirements / Notifications & Alerts

The system must allow registered users to create fine-grained job alert subscriptions by any combination of: keyword, agency, classification, location, and salary band. When matching jobs are ingested the system must notify the subscriber via email (AWS SES) and/or push notification (FCM). The system must send expiry reminders for saved/applied jobs approaching their closing date. Users must be able to create, pause, and delete alert subscriptions. All notification delivery must be asynchronous and queue-driven.

**Acceptance criteria:**

```gherkin
Feature: Notifications and Alerts

  Scenario: User creates a fine-grained job alert
    Given a logged-in user navigates to alert settings
    When the user creates an alert with keyword "data analyst", agency "ABS", and location "Canberra"
    Then the alert must be persisted against the user's account
    And the system must confirm creation with a summary of the alert criteria

  Scenario: Alert fires when a matching job is ingested
    Given a user has an active alert for keyword "economist" and classification "APS 6"
    When a new job titled "Senior Economist APS 6" is ingested and indexed
    Then a notification must be enqueued for delivery to the user within 15 minutes of ingestion
    And the notification must include: job title, agency, location, closing date, and a direct link

  Scenario: No false-positive alert when job does not match subscription
    Given a user has an active alert for keyword "nurse" and location "Sydney"
    When a new job titled "Software Engineer Melbourne" is ingested
    Then no notification must be sent to that user for that job

  Scenario: Email notification is delivered via AWS SES
    Given a user's alert has been triggered and email is their selected channel
    When the notification worker processes the queued notification
    Then an email must be sent via AWS SES to the user's registered address
    And the email must contain a working direct link to the job listing on the portal

  Scenario: Push notification is delivered via FCM
    Given a user has enabled push notifications and has a registered FCM token
    When the user's alert is triggered
    Then a push notification must be dispatched via Firebase Cloud Messaging to the user's token
    And the notification payload must include job title and agency

  Scenario: Expiry reminder is sent for a saved job
    Given a logged-in user has saved a job with a closing date 2 days from now
    When the expiry reminder scheduler runs
    Then the user must receive an expiry reminder notification via their preferred channel
    And the reminder must include the job title and exact closing date

  Scenario: User pauses an alert subscription
    Given a user has an active job alert
    When the user sets the alert status to "paused" in their account settings
    Then no further notifications must be sent for that alert while it is paused
    And the alert configuration must be retained so the user can re-activate it

  Scenario: User deletes an alert subscription
    Given a user has an active job alert
    When the user deletes the alert
    Then the alert must be removed from the system
    And no further notifications must be sent for that alert
```

**Related:** NFR-001, NFR-003, NFR-004; Depends on: FR-001, FR-007

---

### FR-004: Content and Preparation Resources
- **Area:** Content & Preparation
- **Priority:** SHOULD
- **Source:** constitution.md — Functional Requirements / Preparation Content

The system must host preparation resources for government job seekers: blog posts, department-specific hiring guides, selection criteria writing guides, and interview preparation articles. Content must be associated with departments and surfaced contextually alongside job listings. Insider hiring process information must be manually curated per department by administrators. The CMS must allow authorised administrators to create, edit, publish, and unpublish content without engineering intervention.

**Acceptance criteria:**

```gherkin
Feature: Content and Preparation Resources

  Scenario: Content is surfaced contextually alongside a job listing
    Given a user is viewing a job listing for "APS 5 Policy Officer" at the "Department of Home Affairs"
    And at least one preparation guide is associated with the "Department of Home Affairs"
    When the job detail page renders
    Then the page must display a "Preparation Resources" section linking to relevant guides
    And the link must navigate to the full content article

  Scenario: Selection criteria writing guide is accessible
    Given the selection criteria writing guide has been published by an administrator
    When any visitor navigates to the preparation resources section
    Then the guide must be displayed in full without requiring a user account

  Scenario: Department-specific insider hiring information is displayed
    Given an administrator has published insider hiring information for "Australian Taxation Office"
    When a user views any job listing from the "Australian Taxation Office"
    Then a link to the ATO-specific hiring guide must appear on the job detail page

  Scenario: Administrator publishes a new content article
    Given a logged-in administrator navigates to the CMS content editor
    When the administrator creates a new blog post, sets its category, associates it with a department, and publishes it
    Then the article must appear on the portal's content section immediately after publication
    And the article must be discoverable via the portal's search function

  Scenario: Administrator unpublishes a content article
    Given a published article exists
    When the administrator sets the article status to "unpublished"
    Then the article must no longer be accessible to public visitors
    And the article must be retained in the CMS in draft state for future re-publication

  Scenario: Content article does not require engineering intervention to update
    Given an administrator has access to the CMS
    When the administrator edits and republishes an existing article
    Then the updated content must be live on the portal without any code deployment or server restart
```

**Related:** NFR-001, NFR-004; Depends on: FR-008

---

### FR-005: Agency Reviews and Ratings
- **Area:** Reviews & Ratings
- **Priority:** SHOULD
- **Source:** constitution.md — Functional Requirements / Reviews & Ratings

The system must display employer reviews and ratings for government agencies. Phase 1 surfaces Glassdoor data where permitted by Glassdoor's ToS and robots.txt; where unavailable, an internal user-submitted review system is the fallback. Internal reviews must be moderated before publication. Each agency profile must aggregate and display ratings and review excerpts.

**Acceptance criteria:**

```gherkin
Feature: Agency Reviews and Ratings

  Scenario: Agency profile displays Glassdoor review data where permitted
    Given Glassdoor data for "Australian Bureau of Statistics" is available and ingestion is permitted
    When a user navigates to the ABS agency profile page
    Then the page must display the aggregated Glassdoor rating (out of 5)
    And the page must display at least 3 recent review excerpts with their date and rating

  Scenario: Fallback to internal reviews when Glassdoor data is unavailable
    Given no Glassdoor data is available for "Geoscience Australia"
    When a user navigates to the Geoscience Australia agency profile page
    Then the page must display the internal rating aggregated from user-submitted reviews
    And a message must indicate the data source is "Community Reviews"

  Scenario: Authenticated user submits an internal agency review
    Given a logged-in user navigates to the "Department of Defence" agency profile
    When the user submits a rating of 4 out of 5 and a written review
    Then the review must be stored with status "pending moderation"
    And the review must not appear publicly until approved by an administrator

  Scenario: Administrator approves a submitted review
    Given an internal review is in "pending moderation" status
    When an administrator approves the review via the Admin CMS
    Then the review must appear publicly on the relevant agency profile page
    And the agency's aggregate rating must be recalculated to include the new review

  Scenario: Unauthenticated visitor cannot submit a review
    Given an unauthenticated visitor is on an agency profile page
    When the visitor attempts to submit a review
    Then the system must prompt the visitor to log in or register
    And no review data must be stored

  Scenario: Administrator rejects a submitted review
    Given an internal review is in "pending moderation" status and contains inappropriate content
    When an administrator rejects the review via the Admin CMS
    Then the review must be marked as rejected and must not appear publicly
    And the submitting user must not be notified of the rejection (no PII leakage)
```

**Related:** NFR-004, NFR-005; Depends on: FR-007, FR-008

---

### FR-006: Revenue and Monetisation
- **Area:** Revenue & Monetisation
- **Priority:** SHOULD
- **Source:** constitution.md — Functional Requirements / Revenue

Phase 1 requires integration with Google AdSense (or equivalent) to display ads on job listing, search results, and content pages. Ad placements must not interfere with core job search or application flows. Phase 2 paid tier is out of scope.

**Acceptance criteria:**

```gherkin
Feature: Revenue and Monetisation

  Scenario: Ad unit renders on a job listing page
    Given Google AdSense (or equivalent) is configured with a valid publisher ID
    When a visitor loads a job detail page
    Then an ad unit must render in the designated ad placement zone
    And the ad must load asynchronously without blocking the rendering of the job listing content

  Scenario: Ad does not interfere with the job application flow
    Given an ad unit is active on a job detail page
    When a user clicks the "Apply" or "View on source" button
    Then the user must be navigated directly to the source job listing
    And the ad must not intercept or redirect the click

  Scenario: Ad is suppressed when AdSense is not configured
    Given no AdSense publisher ID is configured in the environment
    When a visitor loads any page that would normally carry an ad unit
    Then no ad request must be made
    And the page layout must render without a broken or empty ad container

  Scenario: Ad unit renders on a search results page
    Given AdSense is configured and the user has performed a keyword search
    When the search results page loads
    Then an ad unit must appear in the designated placement zone on the results page
    And the ad must not displace or obscure any search result entries

  Scenario: Ad unit renders on a content/blog page
    Given AdSense is configured and a published content article exists
    When a visitor loads the article page
    Then an ad unit must appear in the designated placement zone
    And the article text must remain fully readable around the ad
```

**Related:** NFR-001, NFR-004; Depends on: FR-002, FR-004

---

### FR-007: User Accounts
- **Area:** User Accounts
- **Priority:** MUST
- **Source:** constitution.md — Tech Stack / Auth

The system must support user registration and authentication via email/password (JWT) and OAuth2 social sign-in (Google, LinkedIn). Users must be able to manage saved jobs, saved searches, alert subscriptions, and notification preferences. The system must store only the minimum PII required for notification delivery. Passwords must be hashed using bcrypt or argon2.

**Acceptance criteria:**

```gherkin
Feature: User Accounts

  Scenario: User registers with email and password
    Given an unregistered visitor provides a valid email address and a password of at least 10 characters
    When the visitor submits the registration form
    Then a new user account must be created with the email stored and password hashed (bcrypt/argon2)
    And the plain-text password must never be stored or logged
    And the user must receive a verification email with a confirmation link

  Scenario: User logs in with email and password
    Given a registered user with a verified email address
    When the user submits valid credentials on the login page
    Then the system must issue a JWT access token and a refresh token
    And the user must be redirected to the page they were attempting to access (or the home page)

  Scenario: User signs in via Google OAuth2
    Given an unregistered or registered visitor selects "Sign in with Google"
    When the visitor completes the Google OAuth2 flow and grants consent
    Then the system must create or retrieve the user account linked to the Google identity
    And the user must be logged in with a valid JWT session

  Scenario: User signs in via LinkedIn OAuth2
    Given an unregistered or registered visitor selects "Sign in with LinkedIn"
    When the visitor completes the LinkedIn OAuth2 flow and grants consent
    Then the system must create or retrieve the user account linked to the LinkedIn identity
    And the user must be logged in with a valid JWT session

  Scenario: User saves a job listing
    Given a logged-in user is viewing a job detail page
    When the user clicks "Save job"
    Then the job must be added to the user's saved jobs list
    And the saved jobs list must be accessible from the user's account area

  Scenario: User removes a saved job
    Given a logged-in user has a job in their saved jobs list
    When the user clicks "Remove" on that job
    Then the job must be removed from the saved jobs list
    And the removal must take effect without a page reload

  Scenario: User updates notification preferences
    Given a logged-in user navigates to notification preferences
    When the user toggles email notifications off and push notifications on
    Then the updated preferences must be stored
    And subsequent alert notifications must be sent only via the push channel

  Scenario: Unauthenticated user is prompted to log in for personalised features
    Given an unauthenticated visitor attempts to save a job
    When the visitor clicks "Save job"
    Then the system must display a prompt to log in or register
    And after successful login the save action must be completed automatically

  Scenario: JWT access token expires and is refreshed
    Given a logged-in user's JWT access token has expired
    When the user makes an authenticated API request
    Then the system must automatically use the refresh token to issue a new access token
    And the user must not be required to log in again within the refresh token validity window
```

**Related:** NFR-004, NFR-005; foundational requirement

---

### FR-008: Admin CMS and Operations
- **Area:** Admin CMS & Operations
- **Priority:** MUST
- **Source:** constitution.md — Standards (scraper schedules must be configurable without code changes)

The system must provide an administration interface restricted to users with the "admin" role. The Admin CMS must support (without code changes or redeployment): managing scraper source configurations, manually curating job records, publishing and managing preparation content, moderating user-submitted agency reviews, and viewing system health and scraper status dashboards. RBAC must be enforced at the API layer.

**Acceptance criteria:**

```gherkin
Feature: Admin CMS and Operations

  Scenario: Admin adds a new scraper source
    Given a logged-in admin navigates to the scraper configuration section
    When the admin provides a source name, URL, source type (api/scrape), and cron schedule and saves
    Then the new source must be persisted in the database
    And the scheduler must include the new source in the next scheduling cycle (within 5 minutes)
    And no application redeployment must be required

  Scenario: Admin disables a scraper source
    Given an existing active scraper source configuration
    When the admin sets the source status to "disabled"
    Then the scheduler must not enqueue further jobs for that source
    And existing ingested jobs from that source must remain in the system

  Scenario: Admin force-expires a stale job listing
    Given a job listing is incorrectly showing as active
    When the admin selects the listing and clicks "Force expire"
    Then the job record must be updated to expired status in MongoDB
    And the job must be removed from active search results in ElasticSearch within 60 seconds

  Scenario: Admin corrects a misclassified job
    Given a job record has an incorrect classification field
    When the admin edits the classification via the CMS and saves
    Then the updated classification must be reflected in MongoDB and re-indexed in ElasticSearch within 60 seconds

  Scenario: Admin-only pages are inaccessible to regular users
    Given a logged-in regular user attempts to navigate to an admin URL
    When the request is received by the server
    Then the server must return a 403 Forbidden response
    And no admin data or functionality must be exposed

  Scenario: Admin-only pages are inaccessible to unauthenticated visitors
    Given an unauthenticated visitor attempts to access an admin URL
    When the request is received by the server
    Then the server must redirect the visitor to the login page
    And no admin data or functionality must be exposed

  Scenario: Admin views scraper health dashboard
    Given the admin navigates to the scraper health dashboard
    When the page loads
    Then the dashboard must display: last run time, last run status (success/failure), job count ingested, and next scheduled run for each configured source
    And data must be no more than 5 minutes stale

  Scenario: Admin moderates a pending user review
    Given one or more user-submitted reviews are in "pending moderation" status
    When the admin navigates to the review moderation queue
    Then all pending reviews must be listed with their content visible to the admin
    And the admin must be able to approve or reject each review individually
```

**Related:** NFR-004, NFR-006; Depends on: FR-007

---

## Non-Functional Requirements

### NFR-001: Performance
- **Category:** Performance
- **Priority:** MUST

Specific targets: search API p95 under 500 ms at 200 concurrent users; page FCP under 2 seconds on 4G; scraper fleet throughput at least 500 listings per minute; alert notifications enqueued within 15 minutes of ingestion; ElasticSearch sync within 60 seconds of MongoDB write; ad units load asynchronously.

**Acceptance criteria:**

```gherkin
Feature: Performance

  Scenario: Search API meets p95 latency target under load
    Given the ElasticSearch index contains at least 50,000 active job records
    And 200 concurrent users are each submitting search queries
    When latency is measured across 1000 requests
    Then the p95 response time must be less than 500 ms
    And the p99 response time must be less than 1000 ms

  Scenario: Job detail page meets FCP target on 4G
    Given the portal is running in production configuration with CDN enabled
    When a Lighthouse audit simulates a 4G mobile connection loading a job detail page
    Then the First Contentful Paint must be under 2000 ms
    And the Largest Contentful Paint must be under 4000 ms

  Scenario: Scraper fleet meets throughput target
    Given 10 scraper worker instances are running
    When a bulk scrape of a large government board (5000 listings) is triggered
    Then the entire job set must be ingested and stored within 10 minutes
    And the per-minute throughput must average at least 500 listings per minute

  Scenario: Alert notification is enqueued promptly after ingestion
    Given a user has an active alert matching keyword "graduate policy"
    When a matching job is ingested and indexed
    Then a notification task must appear in the notification queue within 15 minutes
    And the task must be delivered to the user within a further 5 minutes under normal queue load

  Scenario: MongoDB to ElasticSearch sync completes within SLA
    Given a job record's expiry date is updated in MongoDB
    When 60 seconds have elapsed
    Then the corresponding ElasticSearch document must reflect the updated expiry date
```

**Related:** FR-001, FR-002, FR-003, FR-008

---

### NFR-002: Scalability
- **Category:** Performance
- **Priority:** MUST

Targets: 500,000 canonical job records in MongoDB; 100,000 active records in ElasticSearch; 500 concurrent users without SLA degradation; 200 configurable scraper sources; 100,000 registered user accounts; 10,000 notification emails per hour; independent horizontal scaling of scraper workers, web API, and notification workers.

**Acceptance criteria:**

```gherkin
Feature: Scalability

  Scenario: ElasticSearch handles 100,000 active job index without latency regression
    Given 100,000 active job documents are indexed in ElasticSearch
    When a user performs a keyword search with two filters applied
    Then the search API must respond within the p95 500 ms SLA defined in NFR-001

  Scenario: Web API sustains 500 concurrent users
    Given the web API is running with its standard ECS task configuration
    When a load test simulates 500 concurrent users performing mixed search and page-view operations
    Then the p95 response time must remain under 500 ms for search endpoints
    And the error rate must be less than 0.1%

  Scenario: Scraper scheduler manages 200 sources without degradation
    Given 200 scraper source configurations are stored in the database
    When the scheduler's polling cycle runs
    Then all 200 sources must be evaluated for due jobs within one 5-minute polling window
    And no source must be silently skipped due to scheduler throughput limits

  Scenario: Notification worker dispatches 10,000 emails per hour
    Given 10,000 notification tasks are enqueued simultaneously
    When the notification worker processes the queue
    Then all 10,000 notifications must be dispatched within 60 minutes
    And the worker must not crash or require manual intervention

  Scenario: Scraper workers scale horizontally
    Given the ECS task count for the scraper service is increased from 2 to 8
    When the new tasks start
    Then all 8 tasks must pick up jobs from the Bull/BullMQ queue without double-processing
    And the aggregate throughput must increase proportionally
```

**Related:** FR-001, FR-002, FR-003; NFR-001

---

### NFR-003: Reliability
- **Category:** Reliability
- **Priority:** MUST

Targets: 99.5% monthly uptime for the web portal; scraper failures isolated per source with automatic retry (up to 3 times, exponential backoff); MongoDB 3-node replica set, no data loss on single-node failure; BullMQ jobs persisted with Redis AOF; notification delivery retry up to 3 times with dead-letter queue; graceful degraded mode when ElasticSearch is unavailable.

**Acceptance criteria:**

```gherkin
Feature: Reliability

  Scenario: Portal achieves 99.5% monthly uptime
    Given the portal is deployed on AWS ECS Fargate with health checks enabled
    When uptime is measured over a 30-day calendar month
    Then total downtime must not exceed 216 minutes (99.5% = 3.6 hours per 30-day month)

  Scenario: Single scraper failure does not cascade
    Given the scraper for source A is configured to fail on every attempt (simulated)
    When the scraper scheduler runs and dispatches jobs for sources A, B, and C
    Then source A jobs must fail and be retried with exponential backoff
    And source B and source C scrapes must complete successfully
    And the web API must remain responsive throughout

  Scenario: Failed scraper job is retried with exponential backoff
    Given a scraper job fails due to a transient network error
    When the job fails for the first time
    Then it must be re-enqueued with a delay of at least 30 seconds
    And after a second failure the delay must at least double
    And after 3 consecutive failures the job must be marked as "failed" in the scheduler

  Scenario: Job records survive a MongoDB node failure
    Given a MongoDB replica set of 3 nodes is running
    When the primary node is stopped
    Then the replica set must elect a new primary within 30 seconds
    And all previously written canonical job records must be readable from the new primary
    And no job records must be lost

  Scenario: Bull/BullMQ jobs survive a Redis restart
    Given 100 scraper jobs are enqueued in Bull/BullMQ
    When the Redis instance is restarted (simulated)
    Then all 100 jobs must still be present in the queue after Redis comes back online
    And the workers must resume processing them

  Scenario: Portal serves degraded state when ElasticSearch is unavailable
    Given ElasticSearch is unreachable (simulated network failure)
    When a user submits a search query on the portal
    Then the portal must return a user-friendly message: "Search is temporarily unavailable. Please try again shortly."
    And the server must return an HTTP 503 status
    And no unhandled exception stack trace must be exposed to the user
```

**Related:** FR-001, FR-002, FR-003; NFR-006

---

### NFR-004: Security and Privacy
- **Category:** Security / Privacy
- **Priority:** MUST

Requirements: JWT access tokens max 15-minute lifetime; refresh tokens expire after 30 days; passwords hashed with bcrypt (cost 12+) or argon2id; PII limited to email, display name (optional), OAuth identifiers, notification preferences; admin RBAC enforced at API layer; TLS 1.2+ required, HTTP redirects to HTTPS; scraper User-Agent must identify the bot; secrets stored in AWS Secrets Manager; dependency vulnerability scanning on every CI build.

**Acceptance criteria:**

```gherkin
Feature: Security and Privacy

  Scenario: Expired JWT is rejected
    Given a user holds a JWT access token that expired 1 minute ago
    When the user makes a request to an authenticated API endpoint using the expired token
    Then the server must return HTTP 401 Unauthorized
    And the response must not include any user data

  Scenario: Password is not stored in plain text
    Given a user registers with password "hunter2"
    When the user record is written to MongoDB
    Then the stored credential field must be a bcrypt or argon2id hash
    And the string "hunter2" must not appear anywhere in the stored document or application logs

  Scenario: Role escalation via API input is blocked
    Given a regular user attempts to set their role to "admin" via an API request body
    When the request is processed
    Then the server must ignore the role field from user-supplied input
    And the user's role must remain "user"
    And the server must return HTTP 403 if the user attempts to access an admin endpoint

  Scenario: HTTP redirects to HTTPS
    Given the portal is deployed with TLS configured
    When a client sends an HTTP (non-TLS) request to any portal URL
    Then the server must respond with HTTP 301 redirecting to the HTTPS equivalent URL

  Scenario: PII fields beyond the permitted set are rejected
    Given a user registration request includes a "phone_number" field
    When the request is processed
    Then the phone number must not be stored in any database or log
    And the response must not acknowledge the presence of the field

  Scenario: Secrets are not present in application logs
    Given the application is running with AWS Secrets Manager integration
    When the application logs are inspected across a full scrape cycle
    Then no database connection strings, API keys, or OAuth secrets must appear in plain text in the logs

  Scenario: CI build fails on known high-severity dependency vulnerability
    Given a new dependency with a known high-severity CVE is added to package.json
    When the CI pipeline runs its dependency vulnerability scan
    Then the build must fail with an actionable error message identifying the vulnerable package
```

**Related:** FR-007, FR-008; NFR-005

---

### NFR-005: Compliance
- **Category:** Compliance
- **Priority:** MUST

Requirements: robots.txt checked before every scrape; crawl-delay directive respected (minimum 2 seconds default); job listings attributed to source; Australian Privacy Act 1988 (APPs) compliance; Privacy Policy accessible from every page; user PII deletion on request within 30 days; Glassdoor data only via permitted channels; GDPR out of scope for Phase 1.

**Acceptance criteria:**

```gherkin
Feature: Compliance

  Scenario: Scraper respects robots.txt disallow rules
    Given a scraper source has a robots.txt that disallows "/jobs/*" for all user agents
    When the scraper scheduler enqueues a job for a URL under "/jobs/"
    Then the scraper worker must fetch and parse robots.txt before making the request
    And the scraper must abort the request and log a "robots.txt disallowed" reason
    And no content from the disallowed path must be stored

  Scenario: Scraper applies crawl-delay directive
    Given a source's robots.txt specifies "Crawl-delay: 5"
    When the scraper processes multiple pages on that domain in sequence
    Then the interval between consecutive requests to that domain must be at least 5 seconds

  Scenario: Scraper applies default delay when no crawl-delay is specified
    Given a source's robots.txt does not specify a crawl-delay
    When the scraper processes multiple pages on that domain
    Then the interval between consecutive requests must be at least 2 seconds

  Scenario: Privacy Policy is accessible from every page
    Given the portal is rendered on any page (home, search results, job detail, content)
    When the page HTML is inspected
    Then a link to the Privacy Policy must be present in the page footer
    And the Privacy Policy page must be publicly accessible without login

  Scenario: User account and PII is deleted on request
    Given a logged-in user navigates to account settings and requests account deletion
    When the deletion is confirmed
    Then the user's email, display name, saved jobs, saved searches, and alert subscriptions must be deleted from MongoDB within 30 days
    And the user must receive a confirmation email that deletion is in progress
    And the user must not be able to log in after deletion is processed

  Scenario: Glassdoor data is not scraped when disallowed
    Given Glassdoor's robots.txt disallows scraping for the path used to access reviews
    When the Glassdoor review ingestion task runs
    Then the scraper must detect the disallow rule and skip the request
    And the system must fall back to displaying internal user-submitted reviews for affected agencies
    And no Glassdoor data must be fetched or stored

  Scenario: Job listings are attributed to their source
    Given a job listing is displayed on the portal
    When the job detail page renders
    Then the page must display the original source name (e.g. "Source: APSJobs") and a link to the original listing
```

**Related:** FR-001, FR-005, FR-007; NFR-004

---

### NFR-006: Observability
- **Category:** Observability
- **Priority:** MUST

Requirements: structured JSON logging (timestamp, service, level, trace ID, message) from all services; per-source scraper metrics after each run; web API p50/p95/p99 latency per endpoint; automated alerts for: scraper failure rate above 20% in any 1-hour window, API 5xx rate above 1% over 5 minutes, notification queue depth above 10,000, MongoDB replication lag above 10 seconds; CloudWatch (or equivalent) operations dashboard; no PII in log entries.

**Acceptance criteria:**

```gherkin
Feature: Observability

  Scenario: Scraper emits structured metrics after each run
    Given a scraper source completes a successful run ingesting 150 listings
    When the run finishes
    Then a structured JSON log entry must be emitted containing: source_name, run_start, run_end, listings_discovered=150, listings_new (integer), listings_updated (integer), status="success"
    And the log entry must be queryable in the centralised log store within 60 seconds

  Scenario: API latency metrics are recorded per endpoint
    Given the web API has processed 100 requests to GET /api/jobs/search
    When the metrics aggregation runs
    Then p50, p95, and p99 latency values must be available for the /api/jobs/search endpoint
    And these values must be visible on the operations dashboard

  Scenario: Alert fires when scraper failure rate exceeds threshold
    Given 10 scraper sources are configured
    When 3 or more sources fail within a 1-hour window (30% failure rate)
    Then an automated alert must be triggered and delivered to the configured alerting channel within 5 minutes

  Scenario: Alert fires when API error rate exceeds threshold
    Given the web API is receiving traffic
    When the 5xx error rate exceeds 1% of all requests over any rolling 5-minute window
    Then an automated alert must be triggered and delivered to the configured alerting channel within 5 minutes

  Scenario: Alert fires when notification queue depth is too high
    Given the notification queue is being monitored
    When the number of unprocessed items exceeds 10,000
    Then an automated alert must be triggered and delivered within 5 minutes

  Scenario: No PII appears in application logs
    Given the web API handles a user registration request containing an email address
    When the request is processed and log entries are written
    Then the email address must not appear in plain text in any log entry
    And the JWT token value must not appear in any log entry
```

**Related:** FR-001, FR-008; NFR-003, NFR-004
