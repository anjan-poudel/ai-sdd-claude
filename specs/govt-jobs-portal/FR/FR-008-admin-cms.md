# FR-008: Admin CMS and Operations

## Metadata
- **Area:** Admin CMS & Operations
- **Priority:** MUST
- **Source:** constitution.md — Standards / Scraper schedules must be configurable without code changes; Functional Requirements (implied by curation and moderation needs)

## Description

The system must provide an administration interface accessible only to users with the "admin" role. The Admin CMS must support the following operations without requiring code changes or redeployment: managing scraper source configurations (add, edit, disable, set schedule), manually curating or overriding job records (e.g. correcting misclassified jobs, force-expiring stale listings), publishing and managing preparation content and blog articles, moderating user-submitted agency reviews, and viewing system health and scraper status dashboards. The admin interface must enforce role-based access control; no admin functions must be accessible to regular users or unauthenticated visitors.

## Acceptance criteria

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

## Related
- NFR: NFR-004 (admin access must be secured), NFR-006 (observability — scraper health feeds the dashboard)
- Depends on: FR-007 (admin accounts use the same auth system with an elevated role)
