# FR-004: Content and Preparation Resources

## Metadata
- **Area:** Content & Preparation
- **Priority:** SHOULD
- **Source:** constitution.md — Functional Requirements / Preparation Content

## Description

The system must provide a content section hosting preparation resources for government job seekers. Content types include: blog posts, department-specific hiring guides, selection criteria writing guides, and interview preparation articles. Content must be associated with specific government departments and/or job classification levels so that it can be surfaced contextually alongside relevant job listings. Insider hiring process information (e.g. assessment centre formats, interview panel composition, typical timeline) must be manually curated per department by administrators. The content management system must allow authorised administrators to create, edit, publish, and unpublish content without engineering intervention.

## Acceptance criteria

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

## Related
- NFR: NFR-001 (page load), NFR-004 (no PII stored in content)
- Depends on: FR-008 (Admin CMS provides the authoring interface)
