# T-014: Confluence Comment Support

## Metadata
- **Group:** [TG-04 -- Confluence Integration](index.md)
- **Component:** ConfluenceDocumentAdapter (comment subsystem)
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** [T-012](T-012-confluence-document-adapter.md)
- **Blocks:** --
- **Requirements:** [FR-007](../../../define-requirements/FR/FR-007-confluence-review-comments.md)

## Description
Add getComments and postComment methods to the ConfluenceDocumentAdapter. Uses the Confluence v2 footer-comments API. Supports retrieving comments since a timestamp, posting new comments, and replying to existing comments (in_reply_to). Comments are used in the document review cycle for stakeholder feedback.

## Acceptance criteria

```gherkin
Feature: Confluence comment support

  Scenario: Retrieve comments since a timestamp
    Given a Confluence page with 5 comments, 2 posted after the given timestamp
    When getComments is called with since = "2026-03-10T00:00:00Z"
    Then 2 Comment objects are returned
    And each has author, body, created_at, and resolved fields

  Scenario: Post a reply to an existing comment
    Given an existing comment ID
    When postComment is called with inReplyTo = that comment ID
    Then the reply is posted via the footer-comments API
    And a CommentRef is returned
```

## Implementation notes
- Endpoints: `GET /wiki/api/v2/pages/{id}/footer-comments`, `POST /wiki/api/v2/footer-comments`
- `since` filtering is client-side (API does not support server-side date filtering)
- Comment body is plain text (no Markdown conversion needed for comments)

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Tests use captured Confluence comment API fixtures
