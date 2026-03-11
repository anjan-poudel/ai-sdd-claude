# T-012: ConfluenceDocumentAdapter -- Page CRUD

## Metadata
- **Group:** [TG-04 -- Confluence Integration](index.md)
- **Component:** ConfluenceDocumentAdapter
- **Agent:** dev
- **Effort:** M
- **Risk:** MEDIUM
- **Depends on:** [T-005](../TG-02-adapter-framework/T-005-adapter-interfaces.md), [T-006](../TG-02-adapter-framework/T-006-retry-middleware.md)
- **Blocks:** T-014
- **Requirements:** [FR-006](../../../define-requirements/FR/FR-006-confluence-document-authoring.md)

## Description
Implement the ConfluenceDocumentAdapter for page CRUD operations using the Confluence v2 REST API. Handles Markdown-to-XHTML conversion (delegating to the renderer in T-013), version tracking for optimistic concurrency on updates, and page dedup via a mapping file. Health check via spaces endpoint.

## Acceptance criteria

```gherkin
Feature: ConfluenceDocumentAdapter page CRUD

  Scenario: Create a new Confluence page from Markdown
    Given valid Confluence credentials and a target space
    When createPage is called with Markdown content
    Then a page is created via POST /wiki/api/v2/pages
    And the content is converted to Confluence storage format (XHTML)
    And a PageRef with provider = "confluence" is returned

  Scenario: Update page with version increment
    Given an existing PageRef with version 3
    When updatePage is called with new content
    Then PUT is called with version = 4
    And the updated PageRef is returned
```

## Implementation notes
- File: `src/collaboration/adapters/confluence/document-adapter.ts`
- Confluence v2 API endpoints from L2 design
- Version tracking: read current version via getPage, increment by 1 on update
- 409 Conflict: re-read version and retry once (optimistic concurrency)
- Page dedup mapping: `.ai-sdd/sync-mappings/confluence.json` maps task_id to page_id
- Auth: Basic auth with `CONFLUENCE_USER_EMAIL:CONFLUENCE_API_TOKEN`

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Tests use captured Confluence API fixtures (dev standard #4)
- [ ] No credentials in log output
