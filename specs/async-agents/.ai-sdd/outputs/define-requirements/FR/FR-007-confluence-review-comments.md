# FR-007: Confluence Review Comment Support

## Metadata
- **Area:** Confluence Integration
- **Priority:** MUST
- **Source:** requirements.md "PE/PO reviews the doc and provide feedback in inline and standard comments" / constitution.md "inline/standard commenting, review feedback"

## Description
The system must support reading and writing both inline comments and standard (page-level) comments on Confluence pages. When a reviewer provides feedback via inline or standard comments, the adapter must retrieve those comments and make them available to the agent for processing. When an agent responds to feedback, it must be able to post reply comments on the same thread. The adapter must track which comments have been processed to avoid re-processing the same feedback in subsequent polling cycles.

## Acceptance criteria

```gherkin
Feature: Confluence review comments

  Scenario: Agent retrieves inline comments from a reviewed page
    Given a Confluence page for task "define-requirements" with 3 inline comments from a reviewer
    When the agent polls for new review feedback
    Then all 3 inline comments are retrieved
    And each comment includes the highlighted text range, author, and comment body

  Scenario: Agent retrieves standard page-level comments
    Given a Confluence page with 2 standard comments
    When the agent polls for new review feedback
    Then both standard comments are retrieved with author and body

  Scenario: Agent posts a reply to an inline comment
    Given an inline comment from reviewer "PE-Lead" on a Confluence page
    When the agent processes the feedback and generates a response
    Then a reply comment is posted under the original inline comment thread

  Scenario: Already-processed comments are not re-retrieved
    Given the agent has already processed 3 comments from a previous cycle
    When the agent polls for new feedback
    Then only comments posted after the last poll timestamp are returned
```

## Related
- NFR: NFR-005 (External API Retry)
- Depends on: FR-006
