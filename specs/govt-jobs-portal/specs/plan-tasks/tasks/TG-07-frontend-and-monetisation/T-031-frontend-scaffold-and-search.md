# T-031: Frontend scaffold, search page, and job detail page

## Metadata
- **Group:** [TG-07 — Frontend & Monetisation](index.md)
- **Component:** Frontend SPA (React / Next.js)
- **Agent:** dev
- **Effort:** XL
- **Risk:** MEDIUM
- **Depends on:** [T-021](../TG-04-search-and-discovery/T-021-keyword-search-and-job-detail.md), [T-022](../TG-04-search-and-discovery/T-022-semantic-search.md), [T-028](../TG-06-content-reviews-admin/T-028-content-management.md), [T-029](../TG-06-content-reviews-admin/T-029-agency-reviews.md)
- **Blocks:** T-032, T-033, T-034
- **Requirements:** [FR-002](../../../../define-requirements.md#fr-002-search-and-discovery), [FR-004](../../../../define-requirements.md#fr-004-content-and-preparation-resources), [FR-005](../../../../define-requirements.md#fr-005-agency-reviews-and-ratings), [NFR-001](../../../../define-requirements.md#nfr-001-performance), [NFR-005](../../../../define-requirements.md#nfr-005-compliance)

## Description
Scaffold the frontend application (React with Next.js for SSR/SSG). Implement: home page with search bar, search results page with faceted filter sidebar, job detail page (title, agency, classification, salary, description, source attribution, expiry date, apply button, save-job, contextual preparation resources, agency reviews). Privacy Policy link must be in every page footer (NFR-005).

## Acceptance criteria

```gherkin
Feature: Frontend search and job detail

  Scenario: Search results load with faceted filters
    Given a user navigates to the search page and types "policy analyst canberra"
    When the search form is submitted
    Then search results must be displayed within 500ms (API response)
    And the facet sidebar must show governmentLevel, state, classification buckets with counts
    And clicking a facet must refine the results without page reload

  Scenario: Job detail page displays source attribution
    Given a user clicks a job from search results
    When the job detail page renders
    Then the page must show: title, agency, location, classification, salary band, description, expiry date
    And a "Source: APSJobs" label with link to the original listing must be visible
    And a "Preparation Resources" section must appear if associated content exists

  Scenario: Anonymous user can search and view jobs
    Given an unauthenticated visitor loads the portal
    When the visitor submits a search and clicks a job
    Then search results and the job detail page must render without requiring login

  Scenario: Privacy Policy link is present on every page
    Given the portal is loaded on any page (home, search, job detail, content)
    When the page HTML is inspected
    Then a link to /privacy-policy must be present in the page footer
    And the Privacy Policy page must be publicly accessible without login

  Scenario: Save job prompts login for unauthenticated user
    Given an unauthenticated visitor is on a job detail page
    When the visitor clicks "Save job"
    Then a login/register prompt must appear
    And after successful login the save action must complete automatically
```

## Implementation notes
- Next.js App Router or Pages Router — either is acceptable. Use SSR for job detail pages for SEO.
- Apply button: open `job.applyUrl` in a new tab; do not intercept or redirect via ad network.
- Faceted filters: use URL query params (`?governmentLevels=federal&states=ACT`) for shareable links.
- Privacy Policy page: static content at `/privacy-policy`; no login required.
- Use `next/image` for any images to satisfy LCP performance target.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] Privacy Policy footer link present on home, search, and job detail pages (automated check)
- [ ] Save-job login prompt and post-login completion tested end-to-end
