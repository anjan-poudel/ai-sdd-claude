# FR-018: [MVP2] GitHub-as-Code Sync

## Metadata
- **Area:** GitHub Integration
- **Priority:** SHOULD
- **Source:** requirements.md "Same model applies to GitHub Issues/Projects in MVP 2 -- code drives ticket state, not the UI" / constitution.md "Jira-as-Code" applied to GitHub

## Description
The system must implement the same code-as-source-of-truth sync model for GitHub Issues and Projects as FR-010 implements for Jira. Workflow YAML task definitions must drive creation, update, and state of GitHub Issues. The sync must: (1) create issues for new tasks, (2) update issue metadata when code changes, (3) flag orphaned issues when tasks are removed from code, (4) resolve conflicts with code winning. The sync must store a mapping file tracking workflow task IDs to GitHub Issue numbers. The implementation must share the same sync engine as FR-010, differing only in the adapter layer.

## Acceptance criteria

```gherkin
Feature: GitHub-as-Code sync

  Scenario: New task in code creates GitHub Issue
    Given a workflow YAML with task "implement-auth" that has no corresponding GitHub Issue
    When the sync runs
    Then a GitHub Issue is created for "implement-auth"
    And the mapping file records the task ID to GitHub Issue number

  Scenario: Code change overwrites GitHub Issue on conflict
    Given task "implement-auth" has title "Auth module" in code
    And the corresponding GitHub Issue has title "Authentication" (manually changed)
    When the sync runs
    Then the GitHub Issue title is updated to "Auth module"

  Scenario: Removed task is flagged not deleted
    Given a GitHub Issue corresponds to task "old-task" removed from workflow YAML
    When the sync runs
    Then the issue is labelled "orphaned-from-code"
    And the issue is NOT closed or deleted
    And a warning is logged

  Scenario: Sync shares engine with Jira-as-Code
    Given the sync engine used for Jira-as-Code (FR-010)
    When configured with a GitHub adapter
    Then the same sync logic (create, update, flag orphans, conflict resolution) executes
    And only the API adapter layer differs
```

## Related
- NFR: NFR-001 (Adapter Pluggability), NFR-006 (Adapter Interface Portability)
- Depends on: FR-010 (shares sync engine), FR-015
