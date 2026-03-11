# FR-006: Confluence Document Authoring Adapter

## Metadata
- **Area:** Confluence Integration
- **Priority:** MUST
- **Source:** requirements.md "BA produces doc in Confluence under a configured space/folder" / constitution.md "Confluence integration: document authoring"

## Description
The system must provide a Confluence adapter that creates and updates pages within a configured Confluence space and parent page (folder). When an agent produces a spec document (e.g., requirements, architecture), the adapter must create a new Confluence page with the document content rendered in Confluence storage format. If a page for that task already exists, the adapter must update it in place rather than creating a duplicate. The adapter must support setting page titles, labels, and parent page hierarchy. Authentication must use Confluence API tokens provided via environment variables.

## Acceptance criteria

```gherkin
Feature: Confluence document authoring

  Scenario: Agent creates a new Confluence page for a task
    Given a configured Confluence space "PROJ" and parent page "Specifications"
    And valid Confluence API credentials in environment variables
    When the BA agent produces the requirements document for task "define-requirements"
    Then a new Confluence page is created under "Specifications"
    And the page title includes the task identifier
    And the page body contains the document content in Confluence storage format

  Scenario: Existing page is updated rather than duplicated
    Given a Confluence page already exists for task "define-requirements"
    When the agent produces an updated version of the document
    Then the existing page is updated with the new content
    And no duplicate page is created

  Scenario: Missing Confluence credentials produce a clear error
    Given the Confluence API token environment variable is not set
    When the adapter attempts to create a page
    Then a configuration error is raised identifying the missing credential
```

## Related
- NFR: NFR-002 (Credential Security), NFR-001 (Adapter Pluggability)
- Depends on: none
