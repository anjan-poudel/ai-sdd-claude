# FR-005: Agency Reviews and Ratings

## Metadata
- **Area:** Reviews & Ratings
- **Priority:** SHOULD
- **Source:** constitution.md — Functional Requirements / Reviews & Ratings

## Description

The system must display employer reviews and ratings for government agencies to help job seekers evaluate potential employers. In the first phase, the system must attempt to surface Glassdoor review data for government agencies where permitted by Glassdoor's terms of service and robots.txt. Where Glassdoor data is unavailable or access is not permitted, the system must fall back to an internal review and rating system that allows authenticated users to submit reviews for agencies they have worked at. Internal reviews must be moderated before publication. Each agency profile page must aggregate and display ratings and selected review excerpts.

## Acceptance criteria

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

## Related
- NFR: NFR-004 (user PII in reviews must be handled per Privacy Act), NFR-005 (Glassdoor scraping must comply with robots.txt)
- Depends on: FR-007 (authenticated users required for internal review submission), FR-008 (Admin CMS for moderation)
