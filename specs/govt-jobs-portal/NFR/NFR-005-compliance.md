# NFR-005: Compliance

## Metadata
- **Category:** Compliance
- **Priority:** MUST

## Description

The system must comply with the following legal and ethical obligations:

- **robots.txt:** Every scraper target must be checked against the source's `robots.txt` before scraping commences. If the relevant path is disallowed, the scraper must not attempt to access it. This check must occur on every scrape cycle, not just at source configuration time.
- **Rate limiting:** All external HTTP requests (scraping and API calls) must respect the crawl-delay directive in `robots.txt`. In the absence of a crawl-delay, the scraper must apply a default minimum delay of 2 seconds between requests to any single domain.
- **Copyright:** Job listings must be attributed to their source. Bulk reproduction of full job descriptions beyond what is necessary for display (e.g. resale of scraped data) is out of scope.
- **Australian Privacy Act 1988:** Collection, storage, and processing of personal information about Australian individuals must comply with the Australian Privacy Principles (APPs). Users must be provided with a Privacy Policy accessible from every page. Users must be able to request deletion of their account and associated PII.
- **Glassdoor terms of service:** Glassdoor data must only be scraped or consumed via channels explicitly permitted by Glassdoor's current Terms of Service and robots.txt. If Glassdoor disallows scraping, the system must fall back to internal reviews without attempting to circumvent the restriction.
- **GDPR (out of scope):** The portal targets Australian users; GDPR compliance for EU residents is out of scope for Phase 1 but the data model must not preclude it.

## Acceptance criteria

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

## Related
- FR: FR-001 (scraper must respect robots.txt), FR-005 (Glassdoor compliance), FR-007 (user data deletion)
- NFR: NFR-004 (security/privacy — PII handling)
