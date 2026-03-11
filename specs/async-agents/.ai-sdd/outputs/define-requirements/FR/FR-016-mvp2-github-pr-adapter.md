# FR-016: [MVP2] GitHub PR Adapter

## Metadata
- **Area:** GitHub Integration
- **Priority:** SHOULD
- **Source:** requirements.md scenario 2 "Github" / constitution.md "GitHub PRs and code review"

## Description
The system must provide a GitHub Pull Request adapter that implements the same adapter interface as the Bitbucket PR adapter (FR-011). The adapter must support: PR creation from a source branch to a target branch, retrieval of review comments (file-level and general), posting reply comments, approving/requesting changes, and merging the PR. After merge, the adapter must be capable of triggering a GitHub Actions workflow (see FR-017). The adapter must authenticate via a GitHub personal access token or GitHub App installation token provided through environment variables.

## Acceptance criteria

```gherkin
Feature: GitHub PR adapter

  Scenario: Agent creates a GitHub PR after implementation
    Given a coder agent has completed task "implement-auth" on branch "feature/auth"
    And valid GitHub credentials are configured
    When the adapter creates a PR
    Then a GitHub PR is created from "feature/auth" to the configured target branch
    And the PR title and description are derived from the task metadata

  Scenario: Review comments are retrieved
    Given a GitHub PR with 4 review comments
    When the agent polls for review feedback
    Then all 4 comments are retrieved with file path, line number, author, and body

  Scenario: PR is merged and Actions workflow is triggered
    Given a GitHub PR has received the required approvals
    When the merge is triggered
    Then the PR is merged to the target branch
    And a GitHub Actions workflow run is triggered for the target branch
```

## Related
- NFR: NFR-001 (Adapter Pluggability), NFR-006 (Adapter Interface Portability)
- Depends on: FR-011 (shares interface contract)
