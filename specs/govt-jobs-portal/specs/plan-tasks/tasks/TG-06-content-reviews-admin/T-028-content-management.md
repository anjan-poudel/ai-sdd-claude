# T-028: Content management API and CMS (preparation resources)

## Metadata
- **Group:** [TG-06 — Content, Reviews & Admin CMS](index.md)
- **Component:** api ECS service — content routes
- **Agent:** dev
- **Effort:** L
- **Risk:** MEDIUM
- **Depends on:** [T-020](../TG-04-search-and-discovery/T-020-web-api-middleware-stack.md), [T-011](../TG-02-auth-and-user-accounts/T-011-user-profile-and-rbac.md)
- **Blocks:** T-031
- **Requirements:** [FR-004](../../../../define-requirements.md#fr-004-content-and-preparation-resources), [FR-008](../../../../define-requirements.md#fr-008-admin-cms-and-operations)

## Description
Implement the content CRUD API: `GET /api/content` (list published), `GET /api/content/:slug` (get by slug), and admin endpoints `POST /api/admin/content`, `PATCH /api/admin/content/:id`, `DELETE /api/admin/content/:id`. Content is associated with agencies for contextual surfacing in job detail (L2 §9.2 `preparationResources`). Published content is publicly accessible; draft/unpublished is admin-only. HTML body must be sanitised on save.

## Acceptance criteria

```gherkin
Feature: Content management

  Scenario: Administrator publishes a content article
    Given a logged-in admin
    When POST /api/admin/content is called with { title, category, body, associatedAgencies: ["ATO"], status: "published" }
    Then HTTP 201 must be returned
    And the article must appear in GET /api/content results
    And GET /api/content/:slug must return the full article to any visitor

  Scenario: Content is surfaced contextually alongside job listing
    Given an article is published with associatedAgencies: ["Department of Home Affairs"]
    When GET /api/jobs/:id is called for a job at "Department of Home Affairs"
    Then the response must include the article in preparationResources

  Scenario: Unpublished article is not accessible to public
    Given an article has status: "unpublished"
    When GET /api/content/:slug is called by an unauthenticated visitor
    Then HTTP 404 must be returned

  Scenario: Admin unpublishes an article without deleting it
    Given a published article exists
    When PATCH /api/admin/content/:id is called with { status: "unpublished" }
    Then the article must no longer appear in public GET /api/content results
    And GET /api/admin/content/:id must still return the article (retained in draft state)

  Scenario: Content update requires no code deployment
    Given an admin has access to the CMS API
    When PATCH /api/admin/content/:id is called to update the body
    Then the updated content must be live on the portal immediately
    And no application restart must be required
```

## Implementation notes
- HTML sanitisation: use `dompurify` or `sanitize-html` with a whitelist of allowed tags (`p`, `h2`, `h3`, `ul`, `li`, `a`, `strong`, `em`, `blockquote`). Strip script, iframe, onclick.
- Slug generation: `slugify(title, { lower: true, strict: true })`. Enforce uniqueness; append `-2`, `-3` on collision.
- `preparationResources` in job detail: query `content.find({ associatedAgencies: job.agency, status: "published" })` and project id, title, slug, category, excerpt.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] No PII in logs (if task touches observability)
- [ ] HTML sanitisation tested against XSS payload fixtures
- [ ] Contextual surfacing tested with a job and matching agency content
