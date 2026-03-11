# FR-010: Jira-as-Code Sync

## Metadata
- **Area:** Jira Integration
- **Priority:** MUST
- **Source:** requirements.md "Jira is maintained via code, NOT via the Jira UI. Code is the source of truth" / constitution.md "Jira-as-Code"

## Description
The system must implement bidirectional sync between workflow YAML task definitions and Jira issues, with code as the authoritative source of truth. On each sync cycle: (1) tasks defined in code but missing in Jira must be created, (2) tasks present in code and Jira must have their Jira metadata updated to match code if there is a drift, (3) tasks removed from code must be flagged (but not automatically deleted from Jira to prevent data loss). A conflict resolution policy must be enforced: when code and Jira disagree on a field value, code wins. The sync must store a mapping file that tracks the correspondence between workflow task IDs and Jira issue keys.

## Acceptance criteria

```gherkin
Feature: Jira-as-Code sync

  Scenario: New task in code creates Jira issue
    Given a workflow YAML with task "implement-auth" that has no corresponding Jira issue
    When the sync runs
    Then a Jira issue is created for "implement-auth"
    And the mapping file records the task ID to Jira issue key

  Scenario: Code change overwrites Jira on conflict
    Given task "implement-auth" has summary "Auth module" in code
    And the corresponding Jira issue has summary "Authentication" (manually changed)
    When the sync runs
    Then the Jira issue summary is updated to "Auth module"

  Scenario: Task removed from code is flagged but not deleted
    Given a Jira issue PROJ-55 corresponds to task "old-task" which has been removed from workflow YAML
    When the sync runs
    Then the Jira issue is labelled "orphaned-from-code"
    And the issue is NOT deleted from Jira
    And a warning is logged identifying the orphaned issue

  Scenario: Sync is idempotent
    Given the workflow YAML has not changed since the last sync
    When the sync runs again
    Then no Jira API write calls are made
    And the mapping file remains unchanged
```

## Related
- NFR: NFR-003 (State Transition Auditability), NFR-005 (External API Retry)
- Depends on: FR-001
